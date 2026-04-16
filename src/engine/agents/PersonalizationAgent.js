/**
 * PersonalizationAgent — Learns user preferences over time.
 * Tracks frequently visited sites, preferred actions, time-of-day patterns.
 */
import messageBus from '../MessageBus.js';
import intentMemory from '../IntentMemory.js';

class PersonalizationAgent {
  constructor() {
    this.name = 'PersonalizationAgent';
    this.siteFrequency = {};
    this.actionPatterns = {};
    this.timePatterns = { morning: [], afternoon: [], evening: [], night: [] };
  }

  trackNavigation(url) {
    if (!url || url === 'internal://newtab') return;
    try {
      const domain = new URL(url).hostname;
      this.siteFrequency[domain] = (this.siteFrequency[domain] || 0) + 1;

      const hour = new Date().getHours();
      let period;
      if (hour < 6) period = 'night';
      else if (hour < 12) period = 'morning';
      else if (hour < 18) period = 'afternoon';
      else period = 'evening';

      this.timePatterns[period].push(domain);
      if (this.timePatterns[period].length > 50) this.timePatterns[period].shift();

      messageBus.publish('personalization.navigation', { domain, period });
    } catch (e) { /* ignore invalid URLs */ }
  }

  trackAction(action, context) {
    const key = `${action}:${context.mode || 'unknown'}`;
    this.actionPatterns[key] = (this.actionPatterns[key] || 0) + 1;
    
    // Track success rate if provided in context
    if (context.success !== undefined) {
      if (!this.successRates) this.successRates = {};
      const rateKey = `${action}`;
      if (!this.successRates[rateKey]) this.successRates[rateKey] = { success: 0, total: 0 };
      this.successRates[rateKey].total++;
      if (context.success) this.successRates[rateKey].success++;
    }
  }

  getTopSites(limit = 5) {
    return Object.entries(this.siteFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([domain, count]) => ({ domain, count }));
  }

  getSuggestedSites() {
    const period = this._getCurrentPeriod();
    const recent = this.timePatterns[period] || [];
    const freq = {};
    for (const domain of recent) {
      freq[domain] = (freq[domain] || 0) + 1;
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([domain]) => domain);
  }

  /**
   * getDailyIntelligence — Returns proactive suggestions based on user habits.
   */
  getDailyIntelligence() {
    const period = this._getCurrentPeriod();
    const suggestions = this.getSuggestedSites();
    const topSites = this.getTopSites(3);
    
    let focus = "browsing";
    if (topSites.length > 0) {
      const top = topSites[0].domain;
      if (top.includes('github') || top.includes('docs')) focus = "productivity";
      else if (top.includes('youtube') || top.includes('netflix')) focus = "media";
    }

    return {
      period,
      focus,
      suggestions,
      greeting: this._getGreeting(period),
      proactivePrompt: this._getProactivePrompt(period, focus)
    };
  }

  _getCurrentPeriod() {
    const hour = new Date().getHours();
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  _getGreeting(period) {
    const greetings = {
      morning: "Good morning! Ready for a productive session?",
      afternoon: "Good afternoon. Continuing your research?",
      evening: "Good evening. Catching up on the news?",
      night: "Burning the midnight oil? Stay focused."
    };
    return greetings[period] || "Welcome back.";
  }

  _getProactivePrompt(period, focus) {
    if (focus === 'productivity') return "We've noticed you're in deep work. Want me to summarize your active documents?";
    if (focus === 'media') return "Ready for some entertainment? I can find your latest subscriptions.";
    return "What's on the agenda for today?";
  }

  getPreferenceSummary() {
    return {
      topSites: this.getTopSites(),
      suggestedNow: this.getSuggestedSites(),
      totalActions: Object.values(this.actionPatterns).reduce((a, b) => a + b, 0),
      favoriteActions: Object.entries(this.actionPatterns).sort((a, b) => b[1] - a[1]).slice(0, 5),
      intelligence: this.getDailyIntelligence()
    };
  }

  serialize() {
    return {
      siteFrequency: this.siteFrequency,
      actionPatterns: this.actionPatterns,
      timePatterns: this.timePatterns,
      successRates: this.successRates
    };
  }

  hydrate(data) {
    if (data?.siteFrequency) this.siteFrequency = data.siteFrequency;
    if (data?.actionPatterns) this.actionPatterns = data.actionPatterns;
    if (data?.timePatterns) this.timePatterns = data.timePatterns;
    if (data?.successRates) this.successRates = data.successRates;
  }
}

export default PersonalizationAgent;
