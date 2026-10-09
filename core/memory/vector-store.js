const crypto = require('crypto');
const { embed: defaultEmbed, cosine } = require('./hash-embedder');
const { redact } = require('../context/gateway');

const MAX_TEXT = 2000;
const MAX_ITEMS = 5000;

/**
 * Small in-memory vector database for Pebble's long-term memory (System Design §13).
 *
 * - Only stores what the USER explicitly asks to remember (source must be 'user').
 * - Secrets (API keys, passwords, card numbers...) are redacted before storing.
 * - Persisted through `persistence` (an EncryptedJsonStore in the app): only the
 *   text and metadata are saved; vectors are rebuilt on load, so the embedder
 *   can be upgraded without migrating data.
 */
class VectorStore {
  /**
   * @param {object} [options]
   * @param {(text: string) => number[]} [options.embed]
   * @param {{ read(fallback: any): any, write(data: any): void }} [options.persistence]
   * @param {() => number} [options.now]
   */
  constructor({ embed = defaultEmbed, persistence = null, now = () => Date.now() } = {}) {
    this.embed = embed;
    this.persistence = persistence;
    this.now = now;
    this.items = new Map(); // id -> { id, text, metadata, createdAt, vector }
    if (persistence) {
      const saved = persistence.read({ items: [] });
      for (const item of Array.isArray(saved.items) ? saved.items : []) {
        if (item && typeof item.id === 'string' && typeof item.text === 'string') {
          this.items.set(item.id, { ...item, vector: this.embed(item.text) });
        }
      }
    }
  }

  get size() {
    return this.items.size;
  }

  /**
   * @returns {{ id: string, redactions: number }}
   */
  add(text, { source, metadata = {} } = {}) {
    if (source !== 'user') throw new Error('Memories can only be added by an explicit user request');
    if (typeof text !== 'string' || text.trim() === '') throw new Error('Memory text is required');
    if (text.length > MAX_TEXT) throw new Error(`Memory is too long (max ${MAX_TEXT} characters)`);
    if (this.items.size >= MAX_ITEMS) throw new Error('Memory is full. Delete some memories first');

    const { text: clean, count } = redact(text.trim());
    const id = crypto.randomUUID();
    this.items.set(id, { id, text: clean, metadata: { ...metadata }, createdAt: this.now(), vector: this.embed(clean) });
    this.save();
    return { id, redactions: count };
  }

  /** Most similar memories first. */
  search(query, { k = 5, minScore = 0.15 } = {}) {
    if (typeof query !== 'string' || query.trim() === '') return [];
    const q = this.embed(query);
    return [...this.items.values()]
      .map((item) => ({ ...this.publicItem(item), score: cosine(q, item.vector) }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  list() {
    return [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt).map((item) => this.publicItem(item));
  }

  remove(id) {
    const removed = this.items.delete(id);
    if (removed) this.save();
    return removed;
  }

  clear() {
    this.items.clear();
    this.save();
  }

  publicItem({ id, text, metadata, createdAt }) {
    return { id, text, metadata, createdAt };
  }

  save() {
    if (this.persistence) this.persistence.write({ items: this.list() });
  }
}

module.exports = { VectorStore, MAX_TEXT, MAX_ITEMS };
