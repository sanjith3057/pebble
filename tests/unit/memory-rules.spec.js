/**
 * Unit Tests - Memory rules (System Design §12, §13)
 */
const { MemoryManager } = require('../../core/memory/memory-manager');

function withClock(start = 1_000_000) {
  let now = start;
  const memory = new MemoryManager({ now: () => now, tempTtlMs: 1000 });
  return { memory, advance: (ms) => (now += ms) };
}

describe('MemoryManager', () => {
  test('stores and reads preferences', () => {
    const { memory } = withClock();
    memory.setPreference('style', 'concise');
    expect(memory.getPreference('style')).toBe('concise');
    expect(memory.getPreference('missing')).toBeNull();
  });

  test('only the user can create persistent memories', () => {
    const { memory } = withClock();
    expect(() => memory.remember('User password is hunter2', { source: 'ai' })).toThrow(/explicit user request/);
    expect(() => memory.remember('Use tabs')).toThrow(/explicit user request/);
    const id = memory.remember('Use tabs in this project', { source: 'user' });
    expect(memory.exportAll().explicit).toEqual([expect.objectContaining({ id, text: 'Use tabs in this project' })]);
  });

  test('a conversation never becomes persistent memory by itself', () => {
    const { memory } = withClock();
    memory.addConversationMessage('user', 'I am debugging main.py');
    memory.addConversationMessage('assistant', 'Sure');
    memory.endConversation();
    const stored = memory.exportAll();
    expect(stored.explicit).toEqual([]);
    expect(stored.preferences).toEqual({});
    expect(memory.conversation).toEqual([]);
  });

  test('temporary context expires', () => {
    const { memory, advance } = withClock();
    memory.addTemporary('User is debugging main.py');
    expect(memory.getTemporary()).toHaveLength(1);
    advance(999);
    expect(memory.getTemporary()).toHaveLength(1);
    advance(1);
    expect(memory.getTemporary()).toHaveLength(0);
  });

  test('the user can forget a single memory', () => {
    const { memory } = withClock();
    const id = memory.remember('Project uses pnpm', { source: 'user' });
    expect(memory.forget(id)).toBe(true);
    expect(memory.exportAll().explicit).toEqual([]);
    expect(memory.forget('does-not-exist')).toBe(false);
  });

  test('the user can delete everything', () => {
    const { memory } = withClock();
    memory.setPreference('style', 'concise');
    memory.remember('x', { source: 'user' });
    memory.addTemporary('y');
    memory.clearAll();
    expect(memory.exportAll()).toEqual({ preferences: {}, explicit: [], temporary: [] });
  });
});
