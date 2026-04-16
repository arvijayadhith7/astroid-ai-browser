/**
 * ResearchAgent — Extracts, summarizes, and validates web content.
 * Handles DOM scraping, multi-source comparison, and confidence scoring.
 */
import messageBus from '../MessageBus.js';

const RESEARCH_SYSTEM_PROMPT = `You are the Research Agent of a self-driving browser. Your job is to analyze, summarize, and extract information from web page content.

When asked to analyze products:
1. Extract Name, Price, Rating, and Key Specs.
2. Compare features across different sources.
3. Provide a clear recommendation based on the user's focus (Value, Quality, etc.).

Keep responses factual and well-organized. Use bullet points for clarity.`;

class ResearchAgent {
  constructor() {
    this.name = 'ResearchAgent';
    this.extractionCache = new Map();
  }

  async extractPageContent(webview) {
    if (!webview) return null;
    try {
      const script = `(function() {
        function toMarkdown(node) {
          if (node.nodeType === 3) return node.textContent;
          if (node.nodeType !== 1) return "";
          let tag = node.tagName.toLowerCase();
          if (["script", "style", "noscript", "iframe"].includes(tag)) return "";
          let children = Array.from(node.childNodes).map(toMarkdown).join("");
          if (tag === "h1") return "\\n# " + children + "\\n";
          if (tag === "h2") return "\\n## " + children + "\\n";
          if (tag === "h3") return "\\n### " + children + "\\n";
          if (tag === "p") return "\\n" + children + "\\n";
          if (tag === "a") return "[" + children + "](" + node.href + ")";
          if (tag === "li") return "\\n- " + children;
          if (tag === "strong" || tag === "b") return "**" + children + "**";
          if (tag === "em" || tag === "i") return "*" + children + "*";
          return children;
        }
        return toMarkdown(document.body).replace(/\\n\\s*\\n/g, '\\n\\n').trim().slice(0, 5000);
      })()`;
      return await Promise.race([
        webview.executeJavaScript(script),
        new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT')), 5000))
      ]);
    } catch (e) {
      return '';
    }
  }

  async extractProductData(webview) {
    if (!webview) return null;
    try {
      const script = `(function() {
        const title = document.querySelector('h1, #productTitle, .product-title')?.innerText?.trim() || document.title;
        const price = document.querySelector('.a-price .a-offscreen, .price-characteristic, .value, [data-automation="product-price"]')?.innerText?.trim() || "Unknown";
        const rating = document.querySelector('.a-icon-alt, .rating-number, .rating-score')?.innerText?.trim() || "No rating";
        const description = document.querySelector('#feature-bullets, #productDescription, .product-description')?.innerText?.trim()?.slice(0, 1000) || "";
        return JSON.stringify({ title, price, rating, description, url: window.location.href });
      })()`;
      const result = await Promise.race([
        webview.executeJavaScript(script),
        new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT')), 5000))
      ]);
      return JSON.parse(result);
    } catch (e) {
      return null;
    }
  }

  async summarize(content, settings) {
    if (!content || !settings.apiKey) return 'No content or API key available.';
    if (typeof window.electronAPI !== 'object') {
      return 'I can only summarize page content when running inside the desktop app.';
    }

    return new Promise((resolve, reject) => {
      let fullText = '';
      const onChunk = (event, c) => {
        if (c && !c.includes('data: ') && !c.includes('"choices":') && !c.includes('"delta":') && !c.includes('"content":')) {
          fullText += c;
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
              { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
              { role: 'user', content: `Summarize this page content:\n\n${content.slice(0, 3000)}` }
            ]
          })
        }
      });
    });
  }

  async extractLinks(webview) {
    if (!webview) return [];
    try {
      const result = await Promise.race([
        webview.executeJavaScript(`
          Array.from(document.querySelectorAll('a[href]'))
            .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
            .filter(l => l.text && l.href.startsWith('http'))
            .slice(0, 30)
        `),
        new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT')), 3000))
      ]);
      return result || [];
    } catch (e) {
      return [];
    }
  }

  async compareResults(results) {
    // Basic cross-source comparison with confidence scoring
    const facts = {};
    for (const source of results) {
      const text = typeof source === 'string' ? source : (source.text || source.description || '');
      const keywords = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const kw of keywords) {
        if (!facts[kw]) facts[kw] = { count: 0, sources: [] };
        facts[kw].count++;
        facts[kw].sources.push(source.url || 'unknown');
      }
    }
    // Higher count = higher confidence
    const maxCount = Math.max(...Object.values(facts).map(f => f.count), 1);
    for (const [kw, data] of Object.entries(facts)) {
      data.confidence = data.count / maxCount;
    }
    return facts;
  }

  async recommend(products, goal, settings) {
    if (!products || products.length === 0) return "I couldn't find enough product data to make a recommendation.";
    
    if (!window.electronAPI) return "I can only recommend products inside the desktop app.";
    return new Promise((resolve) => {
      let fullText = '';
      const messages = [
        { 
          role: 'system', 
          content: `You are an expert shopping assistant. Compare the provided products and recommend the best one for the user's goal: "${goal}". 
          Formatting: Use a Markdown table for comparison. Highlight the winner at the end.` 
        },
        { role: 'user', content: `Products Data:\n${JSON.stringify(products, null, 2)}` }
      ];

      const onChunk = (event, c) => { if (c) fullText += c; };
      const onDone = () => {
        window.electronAPI.removeListener('ai-stream-chunk', onChunk);
        resolve(fullText);
      };

      window.electronAPI.on('ai-stream-chunk', onChunk);
      window.electronAPI.on('ai-stream-done', onDone);
      window.electronAPI.send('ai-stream-request', {
        url: settings.apiEndpoint,
        options: {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: settings.model, stream: true, messages })
        }
      });
    });
  }

  async diagnoseFailure(context, step, error, settings) {
    if (!window.electronAPI) return "Troubleshooting is only available in the desktop app.";
    return new Promise((resolve) => {
      let fullText = '';
      const messages = [
        { 
          role: 'system', 
          content: `You are an Autonomous Browser Troubleshooter. A step failed during automation. 
          Analyze the current page context and the error to determine WHY it failed and suggest a HUMAN-LIKE strategy to fix it.` 
        },
        { 
          role: 'user', 
          content: `Error: ${error}\nFailed Step: ${JSON.stringify(step)}\n\nCurrent Page Context:\nURL: ${context.activeTab?.url}\nInteractive Elements: ${JSON.stringify(context.activeTab?.interactive?.slice(0, 40))}` 
        }
      ];

      const onChunk = (event, c) => { if (c) fullText += c; };
      const onDone = () => {
        window.electronAPI.removeListener('ai-stream-chunk', onChunk);
        resolve(fullText);
      };

      window.electronAPI.on('ai-stream-chunk', onChunk);
      window.electronAPI.on('ai-stream-done', onDone);
      window.electronAPI.send('ai-stream-request', {
        url: settings.apiEndpoint,
        options: {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: settings.model, stream: true, messages })
        }
      });
    });
  }

  async findAlternativeSelector(interactiveElements, targetLabel) {
    if (!interactiveElements || !targetLabel) return null;
    // Basic human-like heuristic: look for text similarity in interactive elements
    const label = targetLabel.toLowerCase();
    for (const el of interactiveElements) {
      if (el.text && (el.text.toLowerCase().includes(label) || label.includes(el.text.toLowerCase()))) {
        return el.tag + (el.id ? "#" + el.id : "") + (el.name ? "[name='" + el.name + "']" : "");
      }
    }
    return null;
  }
}

export default ResearchAgent;
