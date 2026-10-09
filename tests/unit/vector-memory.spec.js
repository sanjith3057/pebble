/**
 * Unit Tests - Vector memory (System Design §13)
 */
const { embed, cosine, tokenize, DIMENSIONS } = require('../../core/memory/hash-embedder');
const { VectorStore, MAX_TEXT } = require('../../core/memory/vector-store');

describe('hash embedder', () => {
  test('produces normalized fixed-size vectors', () => {
    const v = embed('My project uses pnpm');
    expect(v).toHaveLength(DIMENSIONS);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });

  test('is deterministic', () => {
    expect(embed('drink water')).toEqual(embed('drink water'));
  });

  test('similar texts score higher than unrelated ones', () => {
    const q = embed('remind me to drink water');
    expect(cosine(q, embed('drinking more water every hour'))).toBeGreaterThan(cosine(q, embed('the build uses webpack')));
  });

  test('stems and drops stopwords', () => {
    expect(tokenize('The reminders are drinking')).toEqual(['reminder', 'drink']);
  });

  test('empty text gives a zero vector, not NaN', () => {
    expect(embed('the a an').every((x) => x === 0)).toBe(true);
  });
});

describe('VectorStore', () => {
  function memoryPersistence() {
    let data;
    return { read: (fallback) => (data === undefined ? fallback : JSON.parse(JSON.stringify(data))), write: (d) => (data = d), peek: () => data };
  }

  test('finds the most relevant memory first', () => {
    const store = new VectorStore();
    store.add('My project uses pnpm, not npm', { source: 'user' });
    store.add('I prefer dark mode in every app', { source: 'user' });
    store.add('Team standup is at 10am on weekdays', { source: 'user' });
    const [top] = store.search('which package manager does my project use?');
    expect(top.text).toMatch(/pnpm/);
    expect(top.score).toBeGreaterThan(0);
  });

  test('returns nothing when nothing is relevant', () => {
    const store = new VectorStore();
    store.add('I like tea', { source: 'user' });
    expect(store.search('kubernetes deployment yaml')).toEqual([]);
  });

  test('only explicit user requests can add memories', () => {
    const store = new VectorStore();
    expect(() => store.add('the user seems sad', { source: 'ai' })).toThrow(/explicit user request/);
    expect(() => store.add('x')).toThrow(/explicit user request/);
  });

  test('secrets are redacted before storing', () => {
    const store = new VectorStore();
    const { redactions } = store.add('my openai key is sk-abcdefghijklmnopqrstuvwxyz123456', { source: 'user' });
    expect(redactions).toBe(1);
    expect(store.list()[0].text).not.toContain('sk-abcdef');
  });

  test('validates input size', () => {
    const store = new VectorStore();
    expect(() => store.add('   ', { source: 'user' })).toThrow();
    expect(() => store.add('a'.repeat(MAX_TEXT + 1), { source: 'user' })).toThrow(/too long/);
  });

  test('persists text only (no vectors) and rebuilds on load', () => {
    const persistence = memoryPersistence();
    const store = new VectorStore({ persistence });
    const { id } = store.add('Standup is at 10am', { source: 'user' });
    expect(JSON.stringify(persistence.peek())).not.toContain('vector');

    const reloaded = new VectorStore({ persistence });
    expect(reloaded.size).toBe(1);
    expect(reloaded.search('when is standup')[0].id).toBe(id);
  });

  test('ignores malformed saved items', () => {
    const persistence = { read: () => ({ items: [null, { id: 1 }, { id: 'ok', text: 'hello world', createdAt: 1 }] }), write: () => {} };
    expect(new VectorStore({ persistence }).size).toBe(1);
  });

  test('remove and clear', () => {
    const store = new VectorStore();
    const { id } = store.add('one', { source: 'user' });
    store.add('two', { source: 'user' });
    expect(store.remove(id)).toBe(true);
    expect(store.remove(id)).toBe(false);
    store.clear();
    expect(store.size).toBe(0);
  });

  test('search results do not expose internal vectors', () => {
    const store = new VectorStore();
    store.add('drink water', { source: 'user' });
    expect(store.search('water')[0]).not.toHaveProperty('vector');
    expect(store.list()[0]).not.toHaveProperty('vector');
  });
});
