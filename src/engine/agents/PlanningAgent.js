/**
 * PlanningAgent — Decomposes user commands into structured task graphs (DAGs).
 * Uses LLM to break complex requests into atomic steps.
 */
import messageBus from '../MessageBus.js';

const PLANNING_SYSTEM_PROMPT = `You are the Planning Agent. 
GOAL: Create the SHORTEST plan possible (1-3 steps), but ALWAYS end with a synthesis or verification step.
OUTPUT: Valid JSON ONLY.
SCHEMA: { "goal": "str", "steps": [ { "id": int, "action": "CMD", "params": {}, "description": "str" } ] }
ACTIONS: GOTO, SEARCH, MEDIA, CLICK, TYPE, EXTRACT, SUMMARIZE, WAIT.
RULES: 
1. NO CODE generation.
2. Favor ONE-SHOT discovery: [SEARCH] -> [EXTRACT] or [SUMMARIZE].
3. For information requests, ALWAYS include a SUMMARIZE or final CHAT step to process findings.
4. Minimize multi-domain hopping unless research is deep.`;

class PlanningAgent {
  constructor() {
    this.name = 'PlanningAgent';
  }

  async plan(userInput, context, settings, agentMode = 'link') {
    messageBus.publish('agent.planning.started', { input: userInput });

    try {
      if (typeof window.electronAPI !== 'object') {
        return this._fallbackPlan(userInput);
      }

      const response = await new Promise((resolve, reject) => {
        let fullText = '';

        const onChunk = (event, content) => {
          if (content) {
            fullText += content;
          }
        };
        const onDone = () => {
        window.electronAPI.removeListener('ai-stream-chunk', onChunk);
        window.electronAPI.removeListener('ai-stream-error', onError);
        resolve(fullText);
      };
      const onError = (event, msg) => {
        window.electronAPI.removeListener('ai-stream-chunk', onChunk);
        window.electronAPI.removeListener('ai-stream-done', onDone);
        reject(new Error(msg));
      };

        window.electronAPI.on('ai-stream-chunk', onChunk);
        window.electronAPI.on('ai-stream-done', onDone);
        window.electronAPI.on('ai-stream-error', onError);

        window.electronAPI.send('ai-stream-request', {
          url: settings.apiEndpoint,
          options: {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${settings.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: settings.model,
              stream: true,
              messages: [
                { role: 'system', content: PLANNING_SYSTEM_PROMPT + (agentMode === 'research' ? "\nMODE: Deep Research. Generate an EXHAUSTIVE, multi-step plan. Verify every finding. Use multi-site research if necessary." : "") },
                { role: 'user', content: `Context: ${JSON.stringify(context || {})}\n\nUser request: ${userInput}` }
              ]
            })
          }
        });
      });

      // Parse JSON from LLM response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Fallback: simple single-step plan
        return this._fallbackPlan(userInput);
      }

      const plan = JSON.parse(jsonMatch[0]);

      // Check for clarification request
      if (plan.clarification) {
        const options = [...plan.clarification.matchAll(/\[OPTION:\s*(.+?),\s*(.+?)\]/g)].map(m => ({
          label: m[1].trim(),
          input: m[2].trim()
        }));
        const text = plan.clarification.replace(/\[.*?\]/g, '').trim();
        
        return { clarification: text, options };
      }

      messageBus.publish('agent.planning.completed', plan);
      return plan;

    } catch (err) {
      console.error('[PlanningAgent] Error:', err);
      return this._fallbackPlan(userInput);
    }
  }

  _fallbackPlan(input) {
    // Simple heuristic fallback when LLM fails
    const lower = input.toLowerCase();
    const steps = [];

    if (lower.includes('open') || lower.includes('go to') || lower.includes('navigate')) {
      const urlMatch = input.match(/(?:open|go to|navigate to?)\s+(.+)/i);
      const target = urlMatch?.[1]?.trim() || 'google.com';
      let url = target;
      if (!url.startsWith('http')) {
        url = url.includes('.') ? `https://${url}` : `https://www.${url}.com`;
      }
      steps.push({ id: 1, action: 'GOTO', params: { url }, description: `Navigate to ${url}`, dependsOn: [], retries: 2 });
    }

    if (lower.includes('search')) {
      const queryMatch = input.match(/search\s+(?:for\s+)?(.+)/i);
      const query = queryMatch?.[1]?.trim() || input;
      if (!steps.length) {
        steps.push({ id: 1, action: 'GOTO', params: { url: 'https://www.google.com' }, description: 'Open Google', dependsOn: [], retries: 2 });
      }
      steps.push({ id: steps.length + 1, action: 'SEARCH', params: { query }, description: `Search for: ${query}`, dependsOn: [steps.length], retries: 2 });
    }

    if (lower.includes('play') || lower.includes('youtube')) {
      const onYoutube = context?.activeTab?.url?.includes('youtube.com');
      if (!onYoutube) {
        steps.push({ id: 1, action: 'GOTO', params: { url: 'https://www.youtube.com' }, description: 'Open YouTube', dependsOn: [], retries: 2 });
      }
      if (lower.includes('search') || lower.match(/(?:play|find|watch)\s+(.+)/i)) {
        const queryMatch = input.match(/(?:play|find|watch|search)\s+(?:for\s+)?(.+)/i);
        const query = queryMatch?.[1]?.trim() || 'trending music';
        steps.push({ id: steps.length + 1, action: 'SEARCH', params: { query }, description: `Search YouTube: ${query}`, dependsOn: steps.length ? [steps.length] : [], retries: 2 });
        steps.push({ 
          id: steps.length + 1, 
          action: 'CLICK', 
          params: { selector: 'ytd-video-renderer a#video-title, #video-title, .ytd-thumbnail' }, 
          description: 'Click first video', 
          dependsOn: [steps.length], 
          retries: 2 
        });
        steps.push({ 
          id: steps.length + 1, 
          action: 'WAIT', 
          params: { ms: 4500 }, 
          description: 'Wait for player and ads to stabilize', 
          dependsOn: [steps.length], 
          retries: 1 
        });
        steps.push({ 
          id: steps.length + 1, 
          action: 'MEDIA', 
          params: { action: 'play' }, 
          description: 'Play video', 
          dependsOn: [steps.length], 
          retries: 2 
        });
      } else if (lower.includes('play') || lower.includes('pause') || lower.includes('media')) {
        const act = lower.includes('pause') ? 'pause' : 'play';
        const isResultsPage = context?.activeTab?.url?.includes('/results') || context?.activeTab?.url?.includes('search');
        
        if (act === 'play' && (isResultsPage || !context?.activeTab?.url?.includes('watch'))) {
          steps.push({ 
            id: steps.length + 1, 
            action: 'CLICK', 
            params: { selector: 'ytd-video-renderer a#video-title, #video-title, .ytd-thumbnail' }, 
            description: 'Click first video to play', 
            dependsOn: [], 
            retries: 2 
          });
        }
        
        steps.push({ 
          id: steps.length + 1, 
          action: 'MEDIA', 
          params: { action: act }, 
          description: `Media: ${act}`, 
          dependsOn: steps.length ? [steps.length] : [], 
          retries: 1 
        });
      } else if (lower.includes('seek') || lower.includes('skip') || lower.includes('forward')) {
        const seconds = parseInt(lower.match(/(\d+)/)?.[1]) || 10;
        steps.push({ id: steps.length + 1, action: 'MEDIA', params: { action: 'seek', value: seconds }, description: `Seek ${seconds}s`, dependsOn: [], retries: 1 });
      } else if (lower.includes('volume') || lower.includes('loud') || lower.includes('quiet')) {
        const vol = lower.includes('quiet') || lower.includes('down') ? 0.3 : 0.8;
        steps.push({ id: steps.length + 1, action: 'MEDIA', params: { action: 'volume', value: vol }, description: `Set volume to ${vol}`, dependsOn: [], retries: 1 });
      }
    }


    if (lower.includes('summarize') || lower.includes('summary')) {
      steps.push({ id: steps.length + 1, action: 'SUMMARIZE', params: {}, description: 'Summarize page', dependsOn: steps.length ? [steps.length] : [], retries: 1 });
    }

    if (!steps.length && lower.match(/^[a-z0-9-]+(\.[a-z]{2,})?$/i)) {
      let url = lower;
      if (!url.startsWith('http')) {
        url = url.includes('.') ? `https://${url}` : `https://www.${url}.com`;
      }
      steps.push({ id: 1, action: 'GOTO', params: { url }, description: `Navigate to ${url}`, dependsOn: [], retries: 2 });
    }

    if (!steps.length) {
      // Generic - treat as a conversation
      steps.push({ id: 1, action: 'CHAT', params: { message: input }, description: 'Respond to user', dependsOn: [], retries: 0 });
    }

    return { goal: input, steps };
  }
}

export default PlanningAgent;
