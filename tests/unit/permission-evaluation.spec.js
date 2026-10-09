/**
 * Unit Tests - Permission evaluation (System Design §14)
 */
const path = require('path');
const { PermissionStore, PERMISSIONS } = require('../../security/permissions/permissions');

describe('PermissionStore', () => {
  const root = path.resolve('/projects/app');

  test('denies everything by default', () => {
    const store = new PermissionStore();
    for (const permission of PERMISSIONS) {
      expect(store.has(permission, { path: path.join(root, 'a.txt') })).toBe(false);
    }
  });

  test('grants and revokes a capability', () => {
    const store = new PermissionStore();
    store.grant('context.clipboard');
    expect(store.has('context.clipboard')).toBe(true);
    store.revoke('context.clipboard');
    expect(store.has('context.clipboard')).toBe(false);
  });

  test('granting one capability does not grant others', () => {
    const store = new PermissionStore();
    store.grant('filesystem.read', { roots: [root] });
    expect(store.has('filesystem.write', { path: path.join(root, 'a.txt') })).toBe(false);
    expect(store.has('filesystem.delete', { path: path.join(root, 'a.txt') })).toBe(false);
  });

  test('filesystem permissions must be scoped to a folder', () => {
    const store = new PermissionStore();
    expect(() => store.grant('filesystem.read')).toThrow(/scoped/);
    expect(() => store.grant('filesystem.read', { roots: [] })).toThrow(/scoped/);
  });

  test('filesystem permission only applies inside granted folders', () => {
    const store = new PermissionStore();
    store.grant('filesystem.read', { roots: [root] });
    expect(store.has('filesystem.read', { path: path.join(root, 'src', 'a.js') })).toBe(true);
    expect(store.has('filesystem.read', { path: path.resolve('/projects/other/a.js') })).toBe(false);
    expect(store.has('filesystem.read', { path: path.resolve('/projects/app-evil/a.js') })).toBe(false);
    expect(store.has('filesystem.read')).toBe(false); // no path given
  });

  test('rejects unknown permission names', () => {
    const store = new PermissionStore();
    expect(() => store.grant('filesystem.everything')).toThrow(/Unknown permission/);
    expect(() => store.has('admin')).toThrow(/Unknown permission/);
  });

  test('lists granted permissions for the settings UI', () => {
    const store = new PermissionStore();
    store.grant('context.selection');
    store.grant('filesystem.read', { roots: [root] });
    const listed = store.list().map((g) => g.permission).sort();
    expect(listed).toEqual(['context.selection', 'filesystem.read']);
  });

  test('logs every grant and revoke', () => {
    const events = [];
    const store = new PermissionStore({ audit: (e) => events.push(e) });
    store.grant('context.clipboard');
    store.revoke('context.clipboard');
    expect(events).toEqual([
      { type: 'PermissionChanged', permission: 'context.clipboard', granted: true },
      { type: 'PermissionChanged', permission: 'context.clipboard', granted: false },
    ]);
  });
});
