/**
 * Security Tests - Malicious tool arguments and path traversal (System Design §16, §20)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveSafePath, isPathInside } = require('../../security/sandbox/paths');
const { makeGateway, makeWorkspace } = require('../helpers');

describe('resolveSafePath', () => {
  let ws;
  beforeEach(() => (ws = makeWorkspace()));
  afterEach(() => ws.cleanup());

  test('allows normal paths inside the root', () => {
    expect(resolveSafePath(ws.root, 'src/index.js')).toBe(path.join(ws.root, 'src', 'index.js'));
    expect(resolveSafePath(ws.root, 'src/new-file.js')).toBe(path.join(ws.root, 'src', 'new-file.js'));
    expect(resolveSafePath(ws.root, path.join(ws.root, 'src', 'index.js'))).toBe(path.join(ws.root, 'src', 'index.js'));
  });

  test('allows file names that merely start with two dots', () => {
    expect(resolveSafePath(ws.root, '..notes.txt')).toBe(path.join(ws.root, '..notes.txt'));
  });

  test.each([
    '../../../etc/passwd',
    '..\\..\\windows\\system32\\config\\SAM',
    'src/../../outside.txt',
    '..',
  ])('rejects traversal "%s"', (attack) => {
    expect(resolveSafePath(ws.root, attack)).toBeNull();
  });

  test('rejects absolute paths outside the root', () => {
    expect(resolveSafePath(ws.root, os.homedir())).toBeNull();
    expect(resolveSafePath(ws.root, path.resolve('/'))).toBeNull();
  });

  test('rejects a sibling folder that shares the root name as a prefix', () => {
    expect(resolveSafePath(ws.root, `${ws.root}-evil/x.txt`)).toBeNull();
  });

  test.each(['\\\\server\\share\\file', '//server/share/file', '\\\\?\\C:\\Windows\\win.ini'])('rejects UNC/device path "%s"', (attack) => {
    expect(resolveSafePath(ws.root, attack)).toBeNull();
  });

  test.each(['src/NUL', 'CON', 'src/com1.txt', 'lpt1'])('rejects reserved Windows name "%s"', (attack) => {
    expect(resolveSafePath(ws.root, attack)).toBeNull();
  });

  test('rejects null bytes, empty strings and non-strings', () => {
    expect(resolveSafePath(ws.root, 'src/index.js\0.png')).toBeNull();
    expect(resolveSafePath(ws.root, '   ')).toBeNull();
    expect(resolveSafePath(ws.root, 42)).toBeNull();
    expect(resolveSafePath(ws.root, { path: 'x' })).toBeNull();
  });

  test('rejects a root folder that does not exist', () => {
    expect(resolveSafePath(path.join(ws.root, 'missing'), 'a.txt')).toBeNull();
  });

  test('rejects symlinks/junctions that point outside the root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      // 'junction' works on Windows without admin rights; ignored on other platforms.
      fs.symlinkSync(outside, path.join(ws.root, 'link'), 'junction');
      expect(resolveSafePath(ws.root, 'link/secret.txt')).toBeNull();
      expect(resolveSafePath(ws.root, 'link/new-file.txt')).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('isPathInside', () => {
  test('is case-insensitive on Windows only', () => {
    const root = path.resolve('/Projects/App');
    const lower = path.resolve('/projects/app/a.txt');
    expect(isPathInside(root, lower)).toBe(process.platform === 'win32');
  });
});

describe('Tool Gateway with malicious arguments', () => {
  let ws;
  beforeEach(() => (ws = makeWorkspace()));
  afterEach(() => ws.cleanup());

  test('path traversal through a tool call is denied and nothing runs', async () => {
    const { gateway, permissions, executed } = makeGateway();
    permissions.grant('filesystem.read', { roots: [ws.root] });
    const result = await gateway.execute({ name: 'read_file', args: { path: '../../../../Windows/win.ini' } });
    expect(result.status).toBe('denied');
    expect(executed).toEqual([]);
  });

  test('the tool receives the resolved safe path, not the raw AI string', async () => {
    const { gateway, permissions, executed } = makeGateway();
    permissions.grant('filesystem.read', { roots: [ws.root] });
    const result = await gateway.execute({ name: 'read_file', args: { path: 'src/./index.js' } });
    expect(result).toMatchObject({ status: 'executed', result: 'console.log("hi");' });
    expect(executed[0].path).toBe(path.join(ws.root, 'src', 'index.js'));
  });

  test.each([
    [{ path: 123 }, /must be a string/],
    [{}, /missing argument/],
    [{ path: 'a', recursive: true }, /unexpected argument/],
    ['src/index.js', /must be an object/],
  ])('rejects malformed arguments %j', async (args, reason) => {
    const { gateway, permissions, executed } = makeGateway();
    permissions.grant('filesystem.read', { roots: [ws.root] });
    const result = await gateway.execute({ name: 'read_file', args });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(reason);
    expect(executed).toEqual([]);
  });
});
