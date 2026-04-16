/**
 * ContextEngine — Real-time context awareness layer.
 * Reads DOM semantically, maintains cross-tab awareness,
 * classifies mode (work/study/entertainment/shopping), adapts behavior.
 */
import messageBus from './MessageBus.js';

const MODE_RULES = [
  { mode: 'entertainment', patterns: ['youtube.com', 'netflix.com', 'twitch.tv', 'spotify.com', 'reddit.com', 'tiktok.com', 'instagram.com'] },
  { mode: 'work',          patterns: ['docs.google.com', 'notion.so', 'slack.com', 'teams.microsoft.com', 'github.com', 'gitlab.com', 'jira.', 'trello.com', 'figma.com', 'localhost'] },
  { mode: 'study',         patterns: ['wikipedia.org', 'stackoverflow.com', 'medium.com', 'arxiv.org', 'coursera.org', 'udemy.com', 'khanacademy.org', 'scholar.google'] },
  { mode: 'shopping',      patterns: ['amazon.com', 'ebay.com', 'flipkart.com', 'walmart.com', 'aliexpress.com', 'etsy.com'] },
  { mode: 'social',        patterns: ['twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'threads.net', 'mastodon.'] },
  { mode: 'email',         patterns: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'protonmail.com'] }
];

class ContextEngine {
  constructor() {
    this.tabContexts = new Map(); // tabId -> { url, title, mode, media, interactive, lastActive }
    this.currentMode = 'unknown';
    this.focusHistory = [];
    this.crossTabState = { totalTabs: 0, activeTabId: null, modes: {} };
    this.sessionStats = {}; // mode -> totalMs
    this.lastModeSwitch = Date.now();
  }

  classifyMode(url) {
    if (!url) return 'unknown';
    const lower = url.toLowerCase();
    for (const rule of MODE_RULES) {
      if (rule.patterns.some(p => lower.includes(p))) return rule.mode;
    }
    return 'browsing';
  }

  evaluatePrivacyScore(url, interactive = []) {
    if (!url || url.startsWith('internal:')) return 100;
    let score = 100;

    // 1. Connection Security
    if (url.startsWith('http://')) score -= 50;

    // 2. Link/Tracker Density
    const trackerPatterns = ['fbq', 'ads', 'tracker', 'telemetry', 'pixel', 'analytics', 'pixel.cgi'];
    const trackerCount = trackerPatterns.filter(p => url.toLowerCase().includes(p)).length;
    score -= trackerCount * 10;

    // 3. User Interaction Surface (Heuristic)
    // High interactive count on non-work sites can imply spammy/heavy tracking
    if (interactive.length > 50 && !url.includes('github') && !url.includes('notion')) {
        score -= 15;
    }

    return Math.max(0, score);
  }

  updateTabContext(tabId, data) {
    const mode = this.classifyMode(data.url);
    const interactive = data.interactive || [];
    const privacyScore = this.evaluatePrivacyScore(data.url, interactive);
    
    const ctx = {
      url: data.url || '',
      title: data.title || '',
      mode,
      privacyScore,
      media: data.media || { hasVideo: false, hasAudio: false, isPlaying: false },
      interactive,
      hasSearch: data.hasSearch || false,
      lastActive: Date.now()
    };
    this.tabContexts.set(tabId, ctx);

    // Update cross-tab awareness
    this._updateCrossTabState(tabId);

    messageBus.publish('context.tab.updated', { tabId, ...ctx });
    return ctx;
  }

  removeTabContext(tabId) {
    this.tabContexts.delete(tabId);
    this._updateCrossTabState();
  }

  setActiveTab(tabId) {
    const prev = this.crossTabState.activeTabId;
    this.crossTabState.activeTabId = tabId;

    const ctx = this.tabContexts.get(tabId);
    if (ctx) {
      // Record time for previous mode
      const now = Date.now();
      const duration = now - this.lastModeSwitch;
      if (this.currentMode !== 'unknown') {
        this.sessionStats[this.currentMode] = (this.sessionStats[this.currentMode] || 0) + duration;
      }
      
      this.currentMode = ctx.mode;
      this.lastModeSwitch = now;
      this.focusHistory.push({ tabId, mode: ctx.mode, timestamp: now });
      if (this.focusHistory.length > 100) this.focusHistory.shift();

      messageBus.publish('context.mode.changed', {
        previousMode: this.tabContexts.get(prev)?.mode || 'unknown',
        currentMode: ctx.mode,
        tabId
      });
    }
  }

  getModeTimeSummary() {
    // Add current pending time
    const now = Date.now();
    const duration = now - this.lastModeSwitch;
    const finalStats = { ...this.sessionStats };
    if (this.currentMode !== 'unknown') {
      finalStats[this.currentMode] = (finalStats[this.currentMode] || 0) + duration;
    }
    return finalStats;
  }

  _updateCrossTabState(activeTabId) {
    const modes = {};
    for (const [, ctx] of this.tabContexts) {
      modes[ctx.mode] = (modes[ctx.mode] || 0) + 1;
    }
    this.crossTabState = {
      totalTabs: this.tabContexts.size,
      activeTabId: activeTabId || this.crossTabState.activeTabId,
      modes,
      dominantMode: Object.entries(modes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
    };
    messageBus.publish('context.crossTab.updated', this.crossTabState);
  }

  getTabContext(tabId) {
    return this.tabContexts.get(tabId) || null;
  }

  getAllTabContexts() {
    const result = [];
    for (const [tabId, ctx] of this.tabContexts) {
      result.push({ tabId, ...ctx });
    }
    return result;
  }

  getCurrentMode() {
    return this.currentMode;
  }

  getCrossTabState() {
    return this.crossTabState;
  }

  // Generate a context summary for LLM prompts
  getContextSummary() {
    const active = this.tabContexts.get(this.crossTabState.activeTabId);
    return {
      currentMode: this.currentMode,
      activeTab: active ? { 
        url: active.url, 
        title: active.title, 
        mode: active.mode, 
        privacyScore: active.privacyScore 
      } : null,
      totalTabs: this.crossTabState.totalTabs,
      modeBreakdown: this.crossTabState.modes,
      recentFocus: this.focusHistory.slice(-5).map(f => f.mode),
      privacyWarning: active?.privacyScore < 50
    };
  }

  // Get the DOM analysis script to inject into webviews
  static getAnalysisScript() {
    return `(function() {
      try {
        const hasVideo = !!document.querySelector('video, audio');
        const isPlaying = Array.from(document.querySelectorAll('video, audio')).some(m => !m.paused);
        const mediaElements = Array.from(document.querySelectorAll('video, audio')).map(m => ({
          tag: m.tagName.toLowerCase(), paused: m.paused, muted: m.muted,
          duration: m.duration, currentTime: m.currentTime
        })).slice(0, 5);
        const hasArticle = !!document.querySelector('article, main, .content, .post, .article');
        const hasSearch = !!document.querySelector('input[type="search"], input[name="q"], input[name="search_query"], [role="searchbox"]');
        const hasInputs = !!document.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
        const linksCount = document.querySelectorAll('a[href]').length;
        const title = document.title;
        const interactive = Array.from(document.querySelectorAll('input, button, a[href], [role="button"], select, textarea'))
          .map(el => ({
            tag: el.tagName.toLowerCase(), id: el.id,
            text: (el.innerText || el.value || el.placeholder || el.ariaLabel || "").trim().slice(0, 80),
            type: el.type, name: el.name, role: el.getAttribute('role') || ""
          })).slice(0, 60);
        return { hasVideo, isPlaying, mediaElements, hasArticle, hasSearch, hasInputs, linksCount, title, interactive };
      } catch(e) { return null; }
    })()`;
  }
}

const contextEngine = new ContextEngine();
export default contextEngine;
