/**
 * IntentMemory — Persistent memory engine with semantic retrieval.
 * Stores user intents, sessions, behavioral patterns, and activity timeline.
 * Uses TF-IDF keyword matching for fast local semantic search.
 */
import messageBus from './MessageBus.js';

class IntentMemory {
  constructor() {
    this.intents = [];
    this.sessions = [];
    this.timeline = [];
    this.preferences = {};
    this.activeIntentId = null;
    this.tabIntentMap = new Map(); // tabId -> intentId
    this.loaded = false;
  }

  // ─── TF-IDF Semantic Search ───
  _tokenize(text) {
    return (text || '').toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  }

  _tfidf(query, documents) {
    const queryTokens = this._tokenize(query);
    const N = documents.length;
    const df = {};

    // Document frequency
    for (const doc of documents) {
      const docTokens = new Set(this._tokenize(doc.text || doc.goal || ''));
      for (const token of docTokens) {
        df[token] = (df[token] || 0) + 1;
      }
    }

    // Score each document
    return documents.map(doc => {
      const docTokens = this._tokenize(doc.text || doc.goal || '');
      const tf = {};
      for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;

      let score = 0;
      for (const qt of queryTokens) {
        if (tf[qt]) {
          const idf = Math.log(N / (df[qt] || 1));
          score += (tf[qt] / docTokens.length) * idf;
        }
      }
      return { ...doc, score };
    }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);
  }

  // ─── Intent Management ───
  async storeIntent(intent) {
    const entry = {
      id: intent.id || `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      goal: intent.goal,
      context: intent.context || {},
      status: 'active', // active, paused, completed, failed
      steps: intent.steps || [],
      completedSteps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: intent.tags || [],
      priority: intent.priority || 'normal',
      summary: intent.summary || '',
      linkedTabs: intent.linkedTabs || []
    };
    
    // If an intent with the same ID exists, update it instead of pushing
    const idx = this.intents.findIndex(i => i.id === entry.id);
    if (idx >= 0) {
      this.intents[idx] = { ...this.intents[idx], ...entry };
    } else {
      this.intents.push(entry);
    }
    
    this.activeIntentId = entry.id;
    messageBus.publish('memory.intent.stored', entry);
    return entry;
  }

  async setTabIntent(tabId, intentId) {
    if (intentId) {
      this.tabIntentMap.set(tabId, intentId);
      const intentCheck = this.intents.find(i => i.id === intentId);
      if (intentCheck && !intentCheck.linkedTabs.includes(tabId)) {
        intentCheck.linkedTabs.push(tabId);
        intentCheck.updatedAt = Date.now();
      }
    } else {
      this.tabIntentMap.delete(tabId);
    }
    messageBus.publish('memory.tab_intent.mapped', { tabId, intentId });
  }

  getTabIntent(tabId) {
    return this.tabIntentMap.get(tabId) || this.activeIntentId;
  }

  getActiveIntent() {
    return this.intents.find(i => i.id === this.activeIntentId) || this.getActiveIntents()[0];
  }

  async updateIntent(intentId, updates) {
    const idx = this.intents.findIndex(i => i.id === intentId);
    if (idx >= 0) {
      this.intents[idx] = { ...this.intents[idx], ...updates, updatedAt: Date.now() };
      messageBus.publish('memory.intent.updated', this.intents[idx]);
      return this.intents[idx];
    }
    return null;
  }

  async completeIntent(intentId) {
    return this.updateIntent(intentId, { status: 'completed' });
  }

  getActiveIntents() {
    return this.intents.filter(i => i.status === 'active' || i.status === 'paused');
  }

  getResumableIntents() {
    return this.intents.filter(i => i.status === 'paused' && i.steps.length > i.completedSteps.length);
  }

  // ─── Semantic Search ───
  searchIntents(query, limit = 5) {
    return this._tfidf(query, this.intents).slice(0, limit);
  }

  searchTimeline(query, limit = 10) {
    return this._tfidf(query, this.timeline).slice(0, limit);
  }

  // ─── Timeline / Activity ───
  logActivity(activity) {
    const entry = {
      id: `act_${Date.now()}`,
      text: activity.text || activity.action,
      action: activity.action,
      url: activity.url || '',
      tabId: activity.tabId || null,
      mode: activity.mode || 'unknown',
      timestamp: Date.now()
    };
    this.timeline.push(entry);
    if (this.timeline.length > 500) this.timeline.shift();
    messageBus.publish('memory.activity.logged', entry);
    return entry;
  }

  getTimeline(limit = 50) {
    return this.timeline.slice(-limit);
  }

  // ─── Sessions (Enhanced Smart Capture) ───
  async captureSession(sessionData) {
    const { tabs, snapshot, intentId } = sessionData;
    const session = {
      id: `session_${Date.now()}`,
      timestamp: Date.now(),
      intentId: intentId || this.activeIntentId,
      tabs: tabs.map(t => ({ url: t.url, title: t.title, id: t.id })),
      snapshot: snapshot || null, // Optional screenshot or DOM summary
      summary: '' // To be filled by AI
    };
    
    this.sessions.push(session);
    messageBus.publish('memory.session.captured', session);
    return session;
  }

  getCurrentSession() {
    return this.sessions[this.sessions.length - 1];
  }

  // ─── Preferences ───
  setPreference(key, value) {
    this.preferences[key] = value;
    messageBus.publish('memory.preference.updated', { key, value });
  }

  getPreference(key, defaultVal = null) {
    return this.preferences[key] ?? defaultVal;
  }

  // ─── Serialization (for IndexedDB) ───
  serialize() {
    return {
      intents: this.intents,
      sessions: this.sessions,
      timeline: this.timeline.slice(-200),
      preferences: this.preferences,
      activeIntentId: this.activeIntentId
    };
  }

  hydrate(data) {
    if (data.intents) this.intents = data.intents;
    if (data.sessions) this.sessions = data.sessions;
    if (data.timeline) this.timeline = data.timeline;
    if (data.preferences) this.preferences = data.preferences;
    if (data.activeIntentId) this.activeIntentId = data.activeIntentId;
    this.loaded = true;
  }
}

const intentMemory = new IntentMemory();
export default intentMemory;
