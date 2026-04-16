/**
 * MessageBus — Event-driven pub/sub system for inter-agent communication.
 * Channels: task.created, task.step.complete, agent.action, context.update, memory.store
 * Supports wildcard subscriptions and priority ordering.
 */
class MessageBus {
  constructor() {
    this.channels = new Map();
    this.history = [];
    this.maxHistory = 200;
  }

  subscribe(channel, handler, priority = 0) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, []);
    }
    const sub = { handler, priority, id: Date.now() + Math.random() };
    this.channels.get(channel).push(sub);
    this.channels.get(channel).sort((a, b) => b.priority - a.priority);
    return sub.id;
  }

  unsubscribe(channel, subId) {
    if (this.channels.has(channel)) {
      this.channels.set(channel, this.channels.get(channel).filter(s => s.id !== subId));
    }
  }

  publish(channel, payload) {
    const event = { channel, payload, timestamp: Date.now() };
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();

    const results = [];

    // Exact match
    if (this.channels.has(channel)) {
      for (const sub of this.channels.get(channel)) {
        try { results.push(sub.handler(payload, event)); } catch (e) { console.error(`[MessageBus] Error on ${channel}:`, e); }
      }
    }

    // Wildcard match: "task.*" matches "task.created", "task.step.complete"
    for (const [pattern, subs] of this.channels) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        if (regex.test(channel)) {
          for (const sub of subs) {
            try { results.push(sub.handler(payload, event)); } catch (e) { console.error(`[MessageBus] Wildcard error:`, e); }
          }
        }
      }
    }

    return results;
  }

  getHistory(channel = null, limit = 50) {
    const filtered = channel ? this.history.filter(e => e.channel === channel) : this.history;
    return filtered.slice(-limit);
  }

  clear() {
    this.channels.clear();
    this.history = [];
  }
}

// Singleton
const messageBus = new MessageBus();
export default messageBus;
