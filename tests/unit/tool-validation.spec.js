/**
 * Unit Tests - Tool contract validation (System Design §16)
 */
const { validateToolContract, validateArgs, ToolRegistry } = require('../../tools/registry');

const readFile = {
  name: 'read_file',
  description: 'Read a permitted text file',
  risk: 'low',
  permission: 'filesystem.read',
  input_schema: { path: 'string' },
};

describe('validateToolContract', () => {
  test('accepts the contract from the design doc', () => {
    expect(validateToolContract(readFile)).toEqual({ valid: true, errors: [] });
  });

  test.each([
    ['missing name', { ...readFile, name: undefined }, /name/],
    ['bad name', { ...readFile, name: 'Read File!' }, /name/],
    ['missing description', { ...readFile, description: ' ' }, /description/],
    ['invalid risk', { ...readFile, risk: 'none' }, /risk/],
    ['unknown permission', { ...readFile, permission: 'root.everything' }, /permission/],
    ['missing schema', { ...readFile, input_schema: undefined }, /input_schema/],
    ['unsupported arg type', { ...readFile, input_schema: { path: 'function' } }, /unsupported type/],
  ])('rejects %s', (_label, contract, message) => {
    const result = validateToolContract(contract);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(message);
  });
});

describe('validateArgs', () => {
  const schema = { path: 'string', limit: 'number' };

  test('accepts matching arguments', () => {
    expect(validateArgs(schema, { path: 'a.txt', limit: 5 }).valid).toBe(true);
  });

  test('rejects missing, wrong-typed and extra arguments', () => {
    expect(validateArgs(schema, { path: 'a.txt' }).errors).toContain('missing argument: limit');
    expect(validateArgs(schema, { path: 42, limit: 5 }).errors).toContain('path must be a string');
    expect(validateArgs(schema, { path: 'a', limit: 1, sudo: true }).errors).toContain('unexpected argument: sudo');
  });

  test('rejects non-object arguments', () => {
    expect(validateArgs(schema, null).valid).toBe(false);
    expect(validateArgs(schema, ['a.txt']).valid).toBe(false);
    expect(validateArgs(schema, 'a.txt').valid).toBe(false);
  });

  test('rejects oversized strings', () => {
    expect(validateArgs({ path: 'string' }, { path: 'a'.repeat(10001) }).valid).toBe(false);
  });
});

describe('ToolRegistry', () => {
  test('refuses invalid contracts, missing run functions and duplicates', () => {
    const registry = new ToolRegistry();
    expect(() => registry.register({ ...readFile, risk: 'x' }, () => {})).toThrow(/Invalid tool contract/);
    expect(() => registry.register(readFile)).toThrow(/run function/);
    registry.register(readFile, () => {});
    expect(() => registry.register(readFile, () => {})).toThrow(/already registered/);
  });

  test('registered contracts cannot be modified afterwards', () => {
    const registry = new ToolRegistry();
    registry.register(readFile, () => {});
    const { contract } = registry.get('read_file');
    expect(Object.isFrozen(contract)).toBe(true);
    try {
      contract.permission = 'context.ide';
    } catch {
      // Throws in strict mode, silently ignored otherwise; either way it must not change.
    }
    expect(registry.get('read_file').contract.permission).toBe('filesystem.read');
  });
});
