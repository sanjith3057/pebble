const crypto = require('crypto');

const DEFAULT_TEMP_TTL_MS = 30 * 60 * 1000; // Temporary context expires after 30 min.

/**
 * Three kinds of memory (System Design §13) plus conversation memory (§12).
 *
 * - preferences:  settings like "prefers concise answers"
 * - explicit:     things the user explicitly asked Pebble to remember
 * - temporary:    current-task context that expires on its own
 * - conversation: the current chat; NEVER promoted to persistent memory automatically
 */
class MemoryManager {
  constructor({ now = () => Date.now(), tempTtlMs = DEFAULT_TEMP_TTL_MS } = {}) {
    this.now = now;
    this.tempTtlMs = tempTtlMs;
    this.preferences = new Map();
    this.explicit = new Map();
    this.temporary = new Map();
    this.conversation = [];
  }

  setPreference(key, value) {
    if (typeof key !== 'string' || key.trim() === '') throw new Error('Preference key is required');
    this.preferences.set(key, value);
  }

  getPreference(key) {
    return this.preferences.has(key) ? this.preferences.get(key) : null;
  }

  /** Only call this when the USER asked to remember something, never on the AI's own initiative. */
  remember(text, { source } = {}) {
    if (source !== 'user') throw new Error('Persistent memories can only be created by an explicit user request');
    if (typeof text !== 'string' || text.trim() === '') throw new Error('Memory text is required');
    const id = crypto.randomUUID();
    this.explicit.set(id, { id, text: text.trim(), createdAt: this.now() });
    return id;
  }

  forget(id) {
    return this.explicit.delete(id) || this.temporary.delete(id);
  }

  addTemporary(text, ttlMs = this.tempTtlMs) {
    const id = crypto.randomUUID();
    this.temporary.set(id, { id, text, expiresAt: this.now() + ttlMs });
    return id;
  }

  getTemporary() {
    const now = this.now();
    for (const [id, item] of this.temporary) {
      if (item.expiresAt <= now) this.temporary.delete(id);
    }
    return [...this.temporary.values()];
  }

  addConversationMessage(role, content) {
    this.conversation.push({ role, content, at: this.now() });
  }

  endConversation() {
    this.conversation = [];
  }

  /** Everything stored, so the user can see it (§19 user-visible data controls). */
  exportAll() {
    return {
      preferences: Object.fromEntries(this.preferences),
      explicit: [...this.explicit.values()],
      temporary: this.getTemporary(),
    };
  }

  clearAll() {
    this.preferences.clear();
    this.explicit.clear();
    this.temporary.clear();
    this.conversation = [];
  }
}

module.exports = { MemoryManager, DEFAULT_TEMP_TTL_MS };
