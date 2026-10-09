const path = require('path');
const fs = require('fs');

// Windows device names that refer to hardware, not files (e.g. "C:\\work\\NUL").
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function normalizeForCompare(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when `target` is `root` itself or somewhere beneath it. Purely lexical. */
function isPathInside(root, target) {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(target));
  if (rel === '') return true;
  const escapes = rel === '..' || rel.startsWith(`..${path.sep}`);
  return !escapes && !path.isAbsolute(rel);
}

/**
 * Resolve a path requested by the AI against an allowed root folder.
 * Returns the absolute path, or null if the request is unsafe.
 *
 * Rejects: non-strings, empty, null bytes, UNC/device paths, reserved Windows
 * names, anything that escapes `root` (../, absolute paths elsewhere), and
 * symlinks/junctions that point outside `root`.
 */
function resolveSafePath(root, requested) {
  if (typeof root !== 'string' || typeof requested !== 'string') return null;
  if (requested.trim() === '' || requested.includes('\0')) return null;
  if (/^[\\/]{2}/.test(requested)) return null; // \\server\share, \\?\C:\, //host
  if (!fs.existsSync(root)) return null;

  const absolute = path.resolve(root, requested);
  if (!isPathInside(root, absolute)) return null;
  if (absolute.split(/[\\/]/).some((part) => RESERVED_NAMES.test(part))) return null;

  // If the path (or a parent) exists, make sure its real location is still inside root.
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (fs.existsSync(existing)) {
    const realRoot = fs.realpathSync.native(path.resolve(root));
    if (!isPathInside(realRoot, fs.realpathSync.native(existing))) return null;
  }

  return absolute;
}

module.exports = { isPathInside, resolveSafePath };
