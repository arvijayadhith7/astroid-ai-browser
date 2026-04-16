/**
 * ActionAgent — Executes atomic browser actions (click, type, navigate, media control).
 * Migrates all [GOTO], [CLICK], [SEARCH], [MEDIA] logic from App.jsx into a reusable agent.
 */
import messageBus from '../MessageBus.js';

class ActionAgent {
  constructor() {
    this.name = 'ActionAgent';
  }

  /**
   * Execute a single action step.
   * @param {Object} step - { action, params, retries }
   * @param {Object} ctx - { webviewRef, navigate, goBack, goForward, refresh, activeTabIdRef, iframeRefs }
   */
  async execute(step, ctx) {
    const { action, params } = step;
    const retries = step.retries || 0;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this._dispatch(action, params, ctx);
        if (!ctx.isIncognito) {
          messageBus.publish('agent.action.completed', { step, result, attempt });
        }
        return { success: true, result, attempt };
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await this._wait(500 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    messageBus.publish('agent.action.failed', { step, error: lastError?.message });
    return { success: false, error: lastError?.message, attempts: retries + 1 };
  }

  async _dispatch(action, params, ctx) {
    switch (action) {
      case 'GOTO':     return this._goto(params, ctx);
      case 'BACK':     return this._back(ctx);
      case 'FORWARD':  return this._forward(ctx);
      case 'RELOAD':   return this._reload(ctx);
      case 'SEARCH':   return this._search(params, ctx);
      case 'MEDIA':    return this._media(params, ctx);
      case 'CLICK':    return this._click(params, ctx);
      case 'TYPE':     return this._type(params, ctx);
      case 'SCROLL':   return this._scroll(params, ctx);
      case 'EXTRACT':  return this._extract(params, ctx);
      case 'WAIT':     return this._wait(params?.ms || 1000);
      default:         return { skipped: true, action };
    }
  }

  _getWebview(ctx) {
    const wv = ctx.iframeRefs?.current?.[ctx.activeTabIdRef?.current];
    if (wv && wv.executeJavaScript) return wv;
    // Permanent Fix: Look for the truly visible webview in the new visibility-based layout
    return document.querySelector('webview[style*="visibility: visible"]') || document.querySelector('webview:not([style*="display: none"])');
  }

  async _waitForPageLoad(webview, timeout = 8000) {
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try {
          webview.removeEventListener('did-stop-loading', done);
          webview.removeEventListener('dom-ready', done);
        } catch(e) {}
        resolve();
      };
      const timer = setTimeout(done, timeout);
      webview.addEventListener('did-stop-loading', done);
      webview.addEventListener('dom-ready', done);
    });
  }

  async _goto(params, ctx) {
    let url = params.url?.trim();
    if (!url) throw new Error('No URL provided');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = url.includes('.') ? `https://${url}` : `https://www.${url}.com`;
    }
    ctx.navigate(url);
    const webview = this._getWebview(ctx);
    if (webview) {
      // Security & Privacy Pre-check
      const maliciousPatterns = ['g0ogle.com', 'googIe.com', 'paypaI.com', 'phish', 'malware'];
      if (maliciousPatterns.some(p => url.toLowerCase().includes(p))) {
        throw new Error(`Security Alert: The URL "${url}" has been flagged as a potential threat. Navigation aborted for safety.`);
      }
      
      // Privacy Threshold Warning
      const score = ctx.privacyScore || 100;
      if (score < 40 && !ctx.isIncognito) {
          console.warn(`[ActionAgent] Low Privacy Score (${score}) for ${url}`);
          // In a real app, this might trigger a UI modal. Here we just log and proceed for the agent.
      }

      await this._waitForPageLoad(webview);
      // Wait for SPAs (YouTube/Google) to finish internal routing
      const isYT = url.includes('youtube.com');
      await this._wait(isYT || url.includes('google.com') ? 1000 : 400);

      // YouTube Specific: Persistent Shield & Playback Enforcement
      if (isYT) {
        webview.focus();
        // Run shield immediately
        await webview.executeJavaScript(`if (window.runYouTubeShield) window.runYouTubeShield();`);
        
        // SMART WAIT: Only wait long enough for player or results to appear
        await this._waitUntil(webview, `(!!document.querySelector('video') || !!document.querySelector('ytd-searchbox') || !!document.querySelector('#search-input'))`, 4000);
        await webview.executeJavaScript(`if (window.enforcePlayback) window.enforcePlayback();`);
        
        // Final verification for watch pages
        if (url.includes('watch?v=')) {
          await this._waitUntil(webview, `!!document.querySelector('video')`, 3000);
          await this._media({ action: 'play' }, ctx).catch(() => {});
        }
      }
    } else {
      await this._wait(3000);
    }
    return { navigated: url };
  }

  async _back(ctx) { 
    // If params has smart: true, pass to handler
    ctx.goBack(true); 
    const wv = this._getWebview(ctx); 
    if (wv) await this._waitForPageLoad(wv); 
    else await this._wait(1000); 
    return { action: 'back', smart: true }; 
  }
  async _forward(ctx) { ctx.goForward(); const wv = this._getWebview(ctx); if (wv) await this._waitForPageLoad(wv); else await this._wait(1000); return { action: 'forward' }; }
  async _reload(ctx) { ctx.refresh(); const wv = this._getWebview(ctx); if (wv) await this._waitForPageLoad(wv); else await this._wait(1000); return { action: 'reload' }; }

  async _search(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    let query = params.query;
    
    // CONTEXT-AWARE REFINEMENT:
    // If in work/study mode, proactively suggest "documentation" or "example"
    const currentMode = ctx.mode || 'unknown';
    if ((currentMode === 'work' || currentMode === 'study') && !query.includes('documentation') && !query.includes('wiki')) {
        if (query.length > 3 && !query.includes('.')) {
            query += " documentation";
        }
    }
    
    // Fallback logic: If we are on a blank page or a non-search page, navigate directly
    let currentUrl = "";
    try { currentUrl = await webview.getURL(); } catch(e) {}
    
    if (!currentUrl || currentUrl.includes('newtab') || !currentUrl.startsWith('http')) {
      return this._goto({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` }, ctx);
    }

    try {
      webview.focus();
      // Step 1: Ensure search input is visible (handle mobile/narrow UI)
      const setupScript = `(function() {
        const searchButtons = [
          'button[aria-label="Search"]', 
          'button#search-button', 
          '.ytd-searchbox #search-icon-legacy', 
          '.search-icon',
          'ytd-searchbox button'
        ];
        for (const s of searchButtons) {
          const btn = document.querySelector(s);
          if (btn && btn.offsetWidth > 0) { btn.click(); return true; }
        }
        return false;
      })()`;
      await webview.executeJavaScript(setupScript);
      await this._wait(400);

      const script = `(function() {
        const q = "${query.replace(/"/g, '\\"').replace(/\n/g, ' ')}";
        const selectors = [
          'input[name="search_query"]', 'input[name="q"]', 'input[type="search"]',
          '#search', '#search-input', '.search-input', 'input[aria-label*="search" i]',
          'ytd-searchbox input', 'input#search'
        ];
        let el = selectors.map(s => document.querySelector(s)).find(e => e && e.offsetWidth > 0);
        if (!el) {
          // Force click the mobile/compact search icon if present
          const searchBtn = document.querySelector('button[aria-label*="Search" i]') || document.querySelector('.search-button') || document.querySelector('#search-icon-legacy');
          if (searchBtn) searchBtn.click();
          
          el = Array.from(document.querySelectorAll('input')).find(i =>
            (i.placeholder || i.ariaLabel || i.name || "").toLowerCase().includes('search') && i.offsetWidth > 0
          );
        }
        if (el) {
          el.focus(); 
          el.value = ''; // Clear first
          el.value = q;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Try Enter key
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          
          // Try clicking associated button
          const btn = document.querySelector('button#search-icon-legacy') || el.closest('form')?.querySelector('button') || document.querySelector('button[aria-label="Search"]');
          if (btn) btn.click();

          return true;
        }
        return false;
      })()`;
      const result = await this._execWithTimeout(webview, script);
      if (!result) throw new Error('In-page search failed');
      
      // SMART WAIT: Resolve as soon as results appear (or timeout)
      await this._waitUntil(webview, `(!!document.querySelector('ytd-video-renderer') || !!document.querySelector('.g') || !!document.querySelector('.result'))`, 3500);
      return { searched: query, success: true };
    } catch (err) {
      // FINAL FALLBACK: If in-page search fails, navigate to Google directly
      return this._goto({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` }, ctx);
    }
  }

  async _media(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    webview.focus();
    const act = params.action?.toLowerCase() || 'toggle';
    const value = params.value; 

    // SMART CONTEXT: If on results page and trying to play, click first result first
    let url = "";
    try { url = await webview.getURL(); } catch(e) {}
    if (act === 'play' && (url.includes('/results') || url.includes('/search'))) {
      await this._click({ selector: 'ytd-video-renderer a#video-title, #video-title, .ytd-thumbnail, a.result__a' }, ctx);
      // Wait is now handled inside _click for these selectors
    }

    // Optimization: First try the high-level bridge message
    await webview.executeJavaScript(`window.postMessage({ type: 'MEDIA_CONTROL', action: '${act}', value: '${value || ''}' }, '*')`);
    
    const script = `(function() {
      const v = document.querySelector('video') || document.querySelector('audio');
      
      const playPause = (play) => {
        if (v) {
          if (play === true) { v.muted = false; v.play().catch(() => {}); }
          else if (play === false) v.pause();
          else { if (v.paused) { v.muted = false; v.play(); } else v.pause(); }
          return true;
        }

        // Secondary: Try clicking the visual play button if it exists
        const btn = document.querySelector('.ytp-play-button') || document.querySelector('button[aria-label*="Play" i]');
        if (btn) {
           btn.click();
           return true;
        }

        // Fallback: Dispatched key shortcut
        const target = document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75, which: 75, bubbles: true }));
        return true; 
      };

      if ("${act}" === "play") return playPause(true);
      if ("${act}" === "pause") return playPause(false);
      if ("${act}" === "toggle") return playPause();
      if ("${act}" === "mute" && v) { v.muted = !v.muted; return true; }
      if ("${act}" === "seek" && v) { v.currentTime += parseFloat("${value || 0}"); return true; }
      if ("${act}" === "volume" && v) { v.volume = Math.max(0, Math.min(1, parseFloat("${value || 1}"))); return true; }
      
      return false; // No media or play button found
    })()`;
    const result = await this._execWithTimeout(webview, script);
    await this._wait(50);
    if (!result && act === 'play') throw new Error("Could not find a video or play button to activate.");
    return { media: act, success: !!result };
  }

  async _click(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    const selector = params.selector;
    const script = `(function() {
      try {
        const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Visual Feedback: Pulse effect
          const pulse = document.createElement('div');
          pulse.style.position = 'fixed';
          const rect = el.getBoundingClientRect();
          pulse.style.left = rect.left + 'px';
          pulse.style.top = rect.top + 'px';
          pulse.style.width = rect.width + 'px';
          pulse.style.height = rect.height + 'px';
          pulse.style.border = '4px solid #ff4e00';
          pulse.style.borderRadius = '8px';
          pulse.style.zIndex = '999999';
          pulse.style.pointerEvents = 'none';
          pulse.style.boxShadow = '0 0 15px rgba(255, 78, 0, 0.5)';
          pulse.style.transition = 'all 0.5s ease-out';
          document.body.appendChild(pulse);
          setTimeout(() => {
            pulse.style.transform = 'scale(1.5)';
            pulse.style.opacity = '0';
            setTimeout(() => pulse.remove(), 500);
          }, 50);

          el.click();
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          return true;
        }
      } catch(e) {}
      return false;
    })()`;
    const result = await this._execWithTimeout(webview, script);
    if (!result) throw new Error(`Could not find or click element: ${selector}`);
    
    // If it's a YouTube video click, wait for player
    if (selector.includes('video-title') || selector.includes('thumbnail') || selector.includes('ytd-video-renderer')) {
      await this._waitUntil(webview, `!!document.querySelector('video')`, 4000);
      // Immediately enforce play
      await webview.executeJavaScript(`const v = document.querySelector('video'); if (v) { v.muted = false; v.play().catch(() => {}); }`);
    } else {
      await this._wait(40); // Optimized for speed
    }
    return { clicked: selector, success: true };
  }

  async _type(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    const { selector, text } = params;
    const script = `(function() {
      try {
        const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Visual Feedback: Pulse effect
          const pulse = document.createElement('div');
          pulse.style.position = 'fixed';
          const rect = el.getBoundingClientRect();
          pulse.style.left = rect.left + 'px';
          pulse.style.top = rect.top + 'px';
          pulse.style.width = rect.width + 'px';
          pulse.style.height = rect.height + 'px';
          pulse.style.border = '4px solid #00f2fe';
          pulse.style.borderRadius = '4px';
          pulse.style.zIndex = '999999';
          pulse.style.pointerEvents = 'none';
          pulse.style.boxShadow = '0 0 15px rgba(0, 242, 254, 0.5)';
          pulse.style.transition = 'all 0.5s ease-out';
          document.body.appendChild(pulse);
          setTimeout(() => {
            pulse.style.transform = 'scale(1.1)';
            pulse.style.opacity = '0';
            setTimeout(() => pulse.remove(), 500);
          }, 200);

          el.focus(); el.select();
          document.execCommand('insertText', false, "${text.replace(/"/g, '\\"').replace(/\n/g, ' ')}");
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      } catch (e) { return false; }
    })()`;
    const result = await this._execWithTimeout(webview, script);
    await this._wait(250);
    return { typed: text, success: result };
  }

  async _scroll(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    const amount = params.pixels || 500;
    await this._execWithTimeout(webview, `window.scrollBy({ top: ${amount}, behavior: 'smooth' })`);
    await this._wait(500);
    return { scrolled: amount };
  }

  async _extract(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    const selector = params.selector || 'body';
    const result = await this._execWithTimeout(webview,
      `Array.from(document.querySelectorAll('${selector}')).map(el => el.innerText).join('\\n').slice(0, 3000)`
    );
    return { extracted: result };
  }

  async _goBack(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    
    if (params.smart) {
      // Smart Back: Look for last 'meaningful' entry in history
      // (Simplified: last entry with a different domain or significantly different title)
      // This requires accessing the tabs state. In this architecture, 
      // we can trigger a 'smart-back' event that App.jsx listens to, 
      // or we can just call webview.goBack() multiple times.
      // For now, we'll just go back once but with verification.
      webview.goBack();
    } else {
      webview.goBack();
    }
    await this._wait(1000);
    return { action: 'goBack', success: true };
  }

  async _goForward(params, ctx) {
    const webview = this._getWebview(ctx);
    if (!webview) throw new Error('No active webview');
    webview.goForward();
    await this._wait(1000);
    return { action: 'goForward', success: true };
  }

  async _execWithTimeout(webview, script, timeoutMs = 4000) {
    return Promise.race([
      webview.executeJavaScript(script),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
    ]);
  }

  async _waitUntil(webview, checkScript, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await webview.executeJavaScript(checkScript).catch(() => false);
      if (ok) return true;
      await this._wait(250);
    }
    return false;
  }

  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export default ActionAgent;
