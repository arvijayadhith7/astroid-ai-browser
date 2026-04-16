/**
 * AgentOrchestrator — Central coordinator for all specialized agents.
 * Routes tasks, manages the task queue, and coordinates agent execution.
 *
 * Data Flow: User Input → Intent Parser → Planning Agent → Task Compiler → Action Agent → Feedback → Memory
 */
import messageBus from './MessageBus.js';
import intentMemory from './IntentMemory.js';
import contextEngine from './ContextEngine.js';
import TaskCompiler from './TaskCompiler.js';
import PlanningAgent from './agents/PlanningAgent.js';
import ActionAgent from './agents/ActionAgent.js';
import ResearchAgent from './agents/ResearchAgent.js';
import PersonalizationAgent from './agents/PersonalizationAgent.js';

import aiToolsKB from './data/ai_tools_kb.json';

const KB_SUMMARY = aiToolsKB.tools.map(t => t.name).slice(0, 8).join(', ');

const CHARLIE_CHAT_PROMPT = `You are Charlie, a minimalist browser companion. 
GOAL: Near-instant browser assistance. Prefer ONE-SHOT [COMMANDS].

KNOWLEDGE: Expert on verified tools like: ${KB_SUMMARY}. For AI news, use (aixploria.com/en/ai-news/).
PERSONALIZATION: Use current focus and recommendations to tailor responses.

COMMANDS:
- [GOTO: url] — Navigation.
- [SEARCH: query] — Search Google/Page.
- [MEDIA: play|pause|mute|toggle]
- [CLICK: selector], [TYPE: selector, text], [EXTRACT: selector]
- [OPTION: Label, "text"] — Clarification.

RULES:
1. NO CODE generation.
2. For ANY information request, lead with [SEARCH: query]. 
3. Be EXTREMELY concise. Respond with < 15 words if possible.`;

const MODE_PROMPTS = {
  link: "Focus: Quick browsing assistance and navigation. Be concise.",
  ai: "Focus: Intelligence and analysis. Proactively explain page content and suggest browser features.",
  research: "Focus: Deep research and autonomy. Conduct thorough investigations across multiple steps/sites."
};

class AgentOrchestrator {
  constructor() {
    this.planningAgent = new PlanningAgent();
    this.actionAgent = new ActionAgent();
    this.researchAgent = new ResearchAgent();
    this.personalizationAgent = new PersonalizationAgent();
    this.taskCompiler = new TaskCompiler();
    this.isRunning = false;
    this.currentTaskId = null;
    this.onUpdate = null; // callback for React state updates
    this._setupListeners();
  }

  _setupListeners() {
    messageBus.subscribe('task.completed', (task) => {
      intentMemory.logActivity({
        action: 'task_completed',
        text: `Completed: ${task.goal}`,
        mode: contextEngine.getCurrentMode()
      });
    });

    messageBus.subscribe('agent.action.completed', ({ step }) => {
      this.personalizationAgent.trackAction(step.action, {
        mode: contextEngine.getCurrentMode()
      });
    });
  }

  /**
   * Main entry point: process user input through the full pipeline.
   * @param {string} input - user's natural language input
   * @param {Object} settings - { apiKey, apiEndpoint, model }
   * @param {Object} browserCtx - { navigate, goBack, goForward, refresh, iframeRefs, activeTabIdRef }
   * @param {string} agentMode - 'link', 'ai', or 'research'
   * @param {Function} onStream - callback for streaming UI updates: (type, data) => void
   */
  async processInput(input, settings, browserCtx, agentMode = 'link', onStream) {
    this.isRunning = true;
    const context = contextEngine.getContextSummary();

    // Store user intent
    const intent = await intentMemory.storeIntent({
      goal: input,
      context,
      tags: this._classifyTags(input)
    });

    // Step 0: Quick Action Trigger & Proactive Refinement
    const isAmbiguous = this._isAmbiguous(input);
    if (!isAmbiguous) {
      const quickActionResult = await this._tryQuickAction(input, intent, browserCtx, onStream);
      if (quickActionResult?.handled) {
        if (quickActionResult.allDone) return quickActionResult;
        // If it handled the action but still needs a chat response, we continue to Step 1
      }
    }

    onStream?.('status', 'Analyzing your request...');

    try {
      // Step 1: Classify intent — simple vs complex
      // In Research mode, most tasks are treated as complex
      const isComplex = agentMode === 'research' || this._isComplexTask(input);

      if (isComplex) {
        return await this._executeComplexTask(input, intent, settings, browserCtx, context, agentMode, onStream);
      } else {
        return await this._executeSimpleTask(input, intent, settings, browserCtx, context, agentMode, onStream);
      }
    } catch (err) {
      console.error('[Orchestrator] Error:', err);
      await intentMemory.updateIntent(intent.id, { status: 'failed' });
      onStream?.('error', `Error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  async _executeSimpleTask(input, intent, settings, browserCtx, context, agentMode, onStream) {
    onStream?.('status', `Consulting AI [${settings.model}]...`);

    let iteration = 0;
    const maxIterations = 3;
    let currentInput = input;
    let accumulatedText = '';
    let lastResults = [];

    while (iteration < maxIterations) {
      iteration++;
      let fullText = '';
      const executedTags = new Set();
      const activeActions = [];

      // Add feedback if we have results from previous iteration
      const feedbackLine = lastResults.length > 0 
        ? `\n\n[ACTION RESULTS]:\n${lastResults.map(r => r.summary || JSON.stringify(r)).join('\n')}\n\nPlease analyze these results and provide the final answer or next steps.`
        : '';

      await new Promise((resolve, reject) => {
        const onChunk = (event, content) => {
          if (content) {
            fullText += content;
            onStream?.('chunk', accumulatedText + fullText);

            const matches = [...fullText.matchAll(/\[(.*?)\]/g)];
            for (const match of matches) {
              const rawTag = match[0];
              if (!executedTags.has(rawTag)) {
                executedTags.add(rawTag);
                const plan = this._commandsToPlan([rawTag], currentInput);
                const compiledTask = this.taskCompiler.compile(plan);
                onStream?.('taskCreated', compiledTask);
                activeActions.push(this._runTask(compiledTask.id, browserCtx, onStream).catch(e => ({ success: false, error: e.message })));
              }
            }
          }
        };
        
        const onDone = () => {
          window.electronAPI.removeListener('ai-stream-chunk', onChunk);
          window.electronAPI.removeListener('ai-stream-error', onError);
          resolve();
        };
        const onError = (event, msg) => {
          window.electronAPI.removeListener('ai-stream-chunk', onChunk);
          window.electronAPI.removeListener('ai-stream-done', onDone);
          reject(new Error(msg));
        };

        window.electronAPI.on('ai-stream-chunk', onChunk);
        window.electronAPI.on('ai-stream-done', onDone);
        window.electronAPI.on('ai-stream-error', onError);

        const pageCtx = context.activeTab ? `\nCurrent page: ${context.activeTab.url} (${context.activeTab.title})` : '';

        window.electronAPI.send('ai-stream-request', {
          url: settings.apiEndpoint,
          options: {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: settings.model,
              stream: true,
              messages: [
                { role: 'system', content: CHARLIE_CHAT_PROMPT + "\nMODE: " + (MODE_PROMPTS[agentMode] || MODE_PROMPTS.link) + pageCtx },
                { role: 'user', content: currentInput + feedbackLine }
              ]
            })
          }
        });
      });

      // Wait for actions to finish
      lastResults = [];
      if (activeActions.length > 0) {
        onStream?.('status', 'Processing browser actions...');
        const actionResults = await Promise.all(activeActions);
        lastResults = actionResults.filter(r => r && r.success);
      }

      accumulatedText += fullText.replace(/\[.*?\]/g, '').trim() + ' ';
      
      // If no new commands were issued, we are likely done
      if (executedTags.size === 0) break;
      
      onStream?.('status', 'Continuing reasoning...');
    }

    const displayText = accumulatedText.trim() || "Task completed successfully.";
    await intentMemory.completeIntent(intent.id);
    onStream?.('complete', { text: displayText, status: 'complete' });

    return { success: true, text: displayText };
  }

  async _executeComplexTask(input, intent, settings, browserCtx, context, agentMode, onStream) {
    // Step 1: Planning
    onStream?.('status', '🧠 Planning your task...');
    const plan = await this.planningAgent.plan(input, context, settings, agentMode);

    // Step 2: Check for clarification request
    if (plan.clarification) {
      onStream?.('complete', { 
        text: plan.clarification, 
        status: 'complete',
        options: plan.options
      });
      return { success: true, text: plan.clarification, options: plan.options };
    }

    // Step 3: Compile into executable DAG
    const compiledTask = this.taskCompiler.compile(plan);
    this.currentTaskId = compiledTask.id;
    onStream?.('taskCreated', compiledTask);

    // Update intent with steps
    await intentMemory.updateIntent(intent.id, {
      steps: plan.steps.map(s => s.description),
      status: 'active'
    });

    // Step 3: Execute
    onStream?.('status', '⚡ Executing task...');
    await this._runTask(compiledTask.id, browserCtx, onStream, settings);

    const task = this.taskCompiler.getTask(compiledTask.id);
    const success = task.status === 'complete';
    await intentMemory.updateIntent(intent.id, { status: success ? 'completed' : 'failed' });

    const summary = task.steps
      .map(s => `${s.status === 'complete' ? '✅' : s.status === 'failed' ? '❌' : '⏭️'} ${s.description}`)
      .join('\n');

    onStream?.('complete', { 
      text: `Task ${success ? 'completed' : 'finished with errors'}:\n${summary}`,
      status: success ? 'complete' : 'failed',
      task: task
    });
    return { success, task, summary };
  }

  async _runTask(taskId, browserCtx, onStream, settings) {
    while (true) {
      const readySteps = this.taskCompiler.getReadySteps(taskId);
      if (readySteps.length === 0) break;

      for (const step of readySteps) {
        this.taskCompiler.markStepRunning(taskId, step.id);
        onStream?.('stepRunning', { step, task: this.taskCompiler.getTask(taskId) });

        let result;
        try {
          if (step.action === 'SUMMARIZE') {
            const webview = this.actionAgent._getWebview(browserCtx);
            const content = await this.researchAgent.extractPageContent(webview);
            const summary = await this.researchAgent.summarize(content, settings);
            result = { success: true, summary };
          } else if (step.action === 'EXTRACT_PRODUCT') {
            const webview = this.actionAgent._getWebview(browserCtx);
            const data = await this.researchAgent.extractProductData(webview);
            result = { success: true, product: data };
          } else if (step.action === 'RECOMMEND') {
            const task = this.taskCompiler.getTask(taskId);
            const products = task.steps
              .filter(s => s.action === 'EXTRACT_PRODUCT' && s.result?.product)
              .map(s => s.result.product);
            const recommendation = await this.researchAgent.recommend(products, step.params.goal || task.goal, settings);
            result = { success: true, recommendation };
          } else {
            result = await this.actionAgent.execute(step, browserCtx);
          }

          if (result && result.success) {
            this.taskCompiler.markStepComplete(taskId, step.id, result);
          } else {
            throw new Error(result?.error || 'Unknown execution error');
          }
        } catch (e) {
          console.warn(`[Orchestrator] Step ${step.id} failed: ${e.message}. Attempting autonomous recovery...`);
          const context = contextEngine.getContextSummary();
          
          // FAST TRACK: Try fuzzy semantic alternative immediately BEFORE AI diagnosis
          if (step.action === 'CLICK' || step.action === 'TYPE') {
            const label = step.params.selector || step.description;
            const altSelector = await this.researchAgent.findAlternativeSelector(context.activeTab?.interactive, label);
            if (altSelector) {
              onStream?.('status', `💡 Quick recovery: swapping selector...`);
              step.params.selector = altSelector;
              const retryResult = await this.actionAgent.execute(step, browserCtx);
              if (retryResult.success) {
                this.taskCompiler.markStepComplete(taskId, step.id, retryResult);
                onStream?.('stepDone', { step, task: this.taskCompiler.getTask(taskId) });
                continue;
              }
            }
          }

          // FALLBACK: Heavy AI Diagnosis only if fast track fails
          onStream?.('status', `🧩 Thinking deeper: Analyzing page...`);
          const diagnosis = await this.researchAgent.diagnoseFailure(context, step, e.message, settings);
          this.taskCompiler.markStepFailed(taskId, step.id, `${e.message}\nDiagnosis: ${diagnosis}`);
        }

        onStream?.('stepDone', { step, task: this.taskCompiler.getTask(taskId) });
      }
    }
  }

  _commandsToPlan(commands, goal) {
    const steps = commands
      .filter(cmd => !cmd.startsWith('[OPTION:')) // Options are NOT executable commands
      .map((cmd, i) => {
      const step = { id: i + 1, dependsOn: i > 0 ? [i] : [], retries: 1 };

      if (cmd.startsWith('[GOTO:')) {
        let url = cmd.match(/\[GOTO:\s*(.+?)\]/)?.[1]?.trim();
        if (url && !url.startsWith('http')) url = url.includes('.') ? `https://${url}` : `https://www.${url}.com`;
        step.action = 'GOTO'; step.params = { url }; step.description = `Navigate to ${url}`;
      } else if (cmd === '[BACK]') { step.action = 'BACK'; step.params = {}; step.description = 'Go back'; }
      else if (cmd === '[FORWARD]') { step.action = 'FORWARD'; step.params = {}; step.description = 'Go forward'; }
      else if (cmd === '[RELOAD]') { step.action = 'RELOAD'; step.params = {}; step.description = 'Reload page'; }
      else if (cmd.startsWith('[SEARCH:')) {
        const q = cmd.match(/\[SEARCH:\s*(.+?)\]/)?.[1];
        step.action = 'SEARCH'; step.params = { query: q }; step.description = `Search: ${q}`;
      } else if (cmd.startsWith('[MEDIA:')) {
        const act = cmd.match(/\[MEDIA:\s*(play|pause|mute|toggle)\]/i)?.[1]?.toLowerCase();
        step.action = 'MEDIA'; step.params = { action: act }; step.description = `Media: ${act}`;
      } else if (cmd.startsWith('[SEEK:')) {
        const val = cmd.match(/\[SEEK:\s*(.+?)\]/)?.[1];
        step.action = 'MEDIA'; step.params = { action: 'seek', value: val }; step.description = `Seek: ${val}s`;
      } else if (cmd.startsWith('[VOLUME:')) {
        const val = cmd.match(/\[VOLUME:\s*(.+?)\]/)?.[1];
        step.action = 'MEDIA'; step.params = { action: 'volume', value: val }; step.description = `Volume: ${val}`;
      } else if (cmd.startsWith('[CLICK:')) {
        const sel = cmd.match(/\[CLICK:\s*(.+?)\]/)?.[1];
        step.action = 'CLICK'; step.params = { selector: sel }; step.description = `Click: ${sel}`;
      } else if (cmd.startsWith('[TYPE:')) {
        const m = cmd.match(/\[TYPE:\s*(.+?),\s*(.+?)\]/);
        step.action = 'TYPE'; step.params = { selector: m?.[1], text: m?.[2] }; step.description = `Type into ${m?.[1]}`;
      } else if (cmd.startsWith('[SCROLL:')) {
        const px = parseInt(cmd.match(/\[SCROLL:\s*(.+?)\]/)?.[1]) || 500;
        step.action = 'SCROLL'; step.params = { pixels: px }; step.description = `Scroll ${px}px`;
      } else if (cmd.startsWith('[EXTRACT:')) {
        const sel = cmd.match(/\[EXTRACT:\s*(.+?)\]/)?.[1];
        step.action = 'EXTRACT'; step.params = { selector: sel }; step.description = `Extract: ${sel}`;
      } else if (cmd.startsWith('[WAIT:')) {
        const ms = parseInt(cmd.match(/\[WAIT:\s*(\d+)\]/)?.[1]) || 1000;
        step.action = 'WAIT'; step.params = { ms }; step.description = `Wait ${ms}ms`;
      } else {
        step.action = 'CHAT'; step.params = { message: cmd }; step.description = cmd;
      }

      return step;
    });

    return { goal, steps };
  }

  _isComplexTask(input) {
    const complexPatterns = [
      /plan\s+a/i, /compare\s+/i, /research\s+/i,
      /book\s+/i, /schedule\s+/i, /analyze\s+/i, /monitor\s+/i,
      /step\s+by\s+step/i, /multi-step/i, /workflow/i,
      /check\s+all/i, /find\s+the\s+best/i
    ];
    return complexPatterns.some(p => p.test(input));
  }

  /**
   * Quick Action Trigger: Handles extremely obvious browser intents 
   * instantly without waiting for an LLM response.
   */
  async _tryQuickAction(input, intent, browserCtx, onStream) {
    const lower = input.toLowerCase().trim();
    
    // 1. Direct URL detection (e.g. "google.com")
    const urlPattern = /^[a-z0-9-]+(\.[a-z]{2,})+(\/[^\s]*)?$/i;
    if (urlPattern.test(lower)) {
      const url = lower.startsWith('http') ? lower : `https://${lower}`;
      onStream?.('status', `Directly navigating to ${url}...`);
      await this.actionAgent.execute({ action: 'GOTO', params: { url } }, browserCtx);
      return { handled: true, allDone: false }; // Continue to chat for friendly confirmation
    }

    // 5. Instant Search Heuristic (Turbo Speed)
    // If it looks like a question or general topic, start searching immediately
    const questionPatterns = /^(who|what|where|when|how|why|is|can|show|find|search|tell|meaning|price|latest|rank)\b/i;
    const isQuestion = questionPatterns.test(lower) || (lower.split(' ').length > 2 && !lower.includes('.'));
    
    if (isQuestion) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(input)}`;
      onStream?.('status', `Searching the web for "${input}"...`);
      // Use direct GOTO instead of SEARCH for maximum reliability and speed
      await this.actionAgent.execute({ action: 'GOTO', params: { url: searchUrl } }, browserCtx);
      return { handled: true, allDone: false };
    }

    // 2. "Open X" / "Go to X"
    const openMatch = lower.match(/^(?:open|go to|visit)\s+(.+)$/i);
    if (openMatch) {
      let target = openMatch[1].trim();
      if (!target.includes('.')) target = `www.${target}.com`;
      const url = target.startsWith('http') ? target : `https://${target}`;
      onStream?.('status', `Opening ${url}...`);
      await this.actionAgent.execute({ action: 'GOTO', params: { url } }, browserCtx);
      return { handled: true, allDone: false };
    }

    // 3. Simple media toggles
    if (lower === 'play' || lower === 'pause' || lower === 'stop') {
      const action = lower === 'stop' ? 'pause' : lower;
      onStream?.('status', `Media: ${action}`);
      await this.actionAgent.execute({ action: 'MEDIA', params: { action } }, browserCtx);
      return { handled: true, allDone: false };
    }

    // 4. AI News Shortcut (Aixploria)
    if (lower.includes('ai news') || (lower.includes('today') && lower.includes('ai'))) {
      const url = "https://www.aixploria.com/en/ai-news/";
      onStream?.('status', `Fetching the latest AI intelligence from AIxploria...`);
      await this.actionAgent.execute({ action: 'GOTO', params: { url } }, browserCtx);
      return { handled: true, allDone: false };
    }

    return null;
  }

  _isAmbiguous(input) {
    const lower = input.toLowerCase().trim();
    const ambiguousShorts = ['music', 'news', 'video', 'search', 'play', 'help', 'open', 'go', 'find', 'watch'];
    // If it's JUST one of these words, it's definitely ambiguous
    if (ambiguousShorts.includes(lower)) return true;
    
    // Broad 2-word intents
    if (lower === 'play music' || lower === 'open news' || lower === 'search video' || lower === 'show news') return true;
    
    return false;
  }

  _classifyTags(input) {
    const tags = [];
    const lower = input.toLowerCase();
    if (lower.includes('search') || lower.includes('find')) tags.push('search');
    if (lower.includes('play') || lower.includes('pause') || lower.includes('media')) tags.push('media');
    if (lower.includes('open') || lower.includes('go to') || lower.includes('navigate')) tags.push('navigation');
    if (lower.includes('summarize') || lower.includes('explain')) tags.push('research');
    if (lower.includes('plan') || lower.includes('book') || lower.includes('compare')) tags.push('complex');
    return tags;
  }

  // Getters for UI
  getActiveTasks() { return this.taskCompiler.getActiveTasks(); }
  getAllTasks() { return this.taskCompiler.getAllTasks(); }
  getCurrentTask() { return this.currentTaskId ? this.taskCompiler.getTask(this.currentTaskId) : null; }
  getPersonalizationSummary() { return this.personalizationAgent.getPreferenceSummary(); }

  // Serialization
  serialize() {
    return {
      personalization: this.personalizationAgent.serialize()
    };
  }

  hydrate(data) {
    if (data?.personalization) this.personalizationAgent.hydrate(data.personalization);
  }
}

export default AgentOrchestrator;
