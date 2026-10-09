const { isPathInside } = require('../sandbox/paths');

// Capability list from System Design §14.
const PERMISSIONS = Object.freeze([
  'context.screen',
  'context.clipboard',
  'context.selection',
  'context.browser',
  'context.ide',
  'filesystem.read',
  'filesystem.write',
  'filesystem.delete',
  'terminal.execute',
  'os.launch',
  'messaging.send',
  'email.send',
  'calendar.write',
  'microphone.listen',
]);

// Permissions that act on files and must be scoped to specific folders.
const PATH_SCOPED = new Set(['filesystem.read', 'filesystem.write', 'filesystem.delete']);

function assertKnown(permission) {
  if (!PERMISSIONS.includes(permission)) {
    throw new Error(`Unknown permission: ${permission}`);
  }
}

/**
 * Holds the user's granted capabilities. Default is deny: nothing is allowed
 * until the user explicitly grants it (explicit, revocable, visible, scoped, logged).
 */
class PermissionStore {
  constructor({ audit = () => {} } = {}) {
    this.grants = new Map(); // permission -> { roots: string[] | null, grantedAt }
    this.audit = audit;
  }

  grant(permission, { roots } = {}) {
    assertKnown(permission);
    if (PATH_SCOPED.has(permission) && (!Array.isArray(roots) || roots.length === 0)) {
      throw new Error(`${permission} must be scoped to at least one folder`);
    }
    this.grants.set(permission, {
      roots: PATH_SCOPED.has(permission) ? [...roots] : null,
      grantedAt: new Date().toISOString(),
    });
    this.audit({ type: 'PermissionChanged', permission, granted: true });
  }

  revoke(permission) {
    assertKnown(permission);
    this.grants.delete(permission);
    this.audit({ type: 'PermissionChanged', permission, granted: false });
  }

  /**
   * @param {string} permission
   * @param {{ path?: string }} [target] Required for path-scoped permissions.
   */
  has(permission, target = {}) {
    assertKnown(permission);
    const grant = this.grants.get(permission);
    if (!grant) return false;
    if (!PATH_SCOPED.has(permission)) return true;
    if (typeof target.path !== 'string') return false;
    return grant.roots.some((root) => isPathInside(root, target.path));
  }

  /** Everything granted, for the settings UI. */
  list() {
    return [...this.grants.entries()].map(([permission, grant]) => ({ permission, ...grant }));
  }
}

module.exports = { PERMISSIONS, PATH_SCOPED, PermissionStore };
