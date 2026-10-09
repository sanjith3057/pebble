const fs = require('fs');
const path = require('path');

// Animation states every character must provide (System Design §6.2, §46.3).
const REQUIRED_STATES = ['idle', 'greet', 'curious', 'thinking', 'talking', 'success', 'warning', 'error', 'sleep'];

const REMINDER_TYPES = ['water', 'break', 'work', 'meeting', 'save'];
const OPTIONAL_STATES = ['enter', 'search', 'music'];

const ID_PATTERN = /^[a-z0-9_-]+$/;
const POSE_FILE_PATTERN = /^poses\/[a-z0-9_]+\.(png|webp)$/;

/** Character folders under `baseDir` that contain a manifest.json. */
function listCharacters(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
    .filter((entry) => fs.existsSync(path.join(baseDir, entry.name, 'manifest.json')))
    .map((entry) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(baseDir, entry.name, 'manifest.json'), 'utf8'));
      return { id: entry.name, name: typeof manifest.name === 'string' ? manifest.name : entry.name };
    });
}

/**
 * Load and validate a character for the renderer (System Design §46.1).
 * Character packs are treated as untrusted input: ids and pose files are
 * whitelisted so a manifest can't point outside its own folder.
 *
 * @param {string} baseDir    Absolute path to the characters folder.
 * @param {string} id         Character folder name.
 * @param {string} urlPrefix  How the renderer reaches baseDir, relative to index.html.
 * @returns {{ id: string, name: string, poses: Record<string,string>, states: Record<string,string[]>, fidgets: string[] }}
 */
function loadCharacter(baseDir, id, urlPrefix = 'assets/characters') {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`Invalid character id: ${id}`);
  const dir = path.join(baseDir, id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Character not found: ${id}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.poses || typeof manifest.poses !== 'object') throw new Error(`${id}: manifest has no poses`);

  const poses = Object.create(null); // no prototype: pose names like "constructor" are just names
  for (const [pose, file] of Object.entries(manifest.poses)) {
    if (!ID_PATTERN.test(pose)) throw new Error(`${id}: invalid pose name ${pose}`);
    if (typeof file !== 'string' || !POSE_FILE_PATTERN.test(file)) throw new Error(`${id}: invalid pose file for ${pose}`);
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`${id}: missing file ${file}`);
    poses[pose] = `${urlPrefix}/${id}/${file}`;
  }

  const usesKnownPoses = (list) => Array.isArray(list) && list.length > 0 && list.every((pose) => Object.hasOwn(poses, pose));
  const states = {};
  for (const state of REQUIRED_STATES) {
    const list = manifest.states && manifest.states[state];
    if (!usesKnownPoses(list)) throw new Error(`${id}: state "${state}" must list existing poses`);
    states[state] = [...list];
  }

  // Optional states: entrance animation, and activity moods (searching, music).
  // Missing moods fall back to similar required states.
  for (const state of OPTIONAL_STATES) {
    if (manifest.states && manifest.states[state] !== undefined) {
      if (!usesKnownPoses(manifest.states[state])) throw new Error(`${id}: state "${state}" must list existing poses`);
      states[state] = [...manifest.states[state]];
    }
  }
  if (!states.search) states.search = [...states.thinking];
  if (!states.music) states.music = [...states.idle];

  const fidgets = manifest.fidgets === undefined ? [] : manifest.fidgets;
  if (!Array.isArray(fidgets) || !fidgets.every((pose) => Object.hasOwn(poses, pose))) throw new Error(`${id}: fidgets must list existing poses`);

  // Poses per reminder type; missing types fall back to the warning poses.
  const reminders = {};
  const manifestReminders = manifest.reminders || {};
  for (const type of REMINDER_TYPES) {
    if (manifestReminders[type] === undefined) {
      reminders[type] = [...states.warning];
    } else if (usesKnownPoses(manifestReminders[type])) {
      reminders[type] = [...manifestReminders[type]];
    } else {
      throw new Error(`${id}: reminder "${type}" must list existing poses`);
    }
  }

  return { id, name: typeof manifest.name === 'string' ? manifest.name : id, poses: { ...poses }, states, fidgets: [...fidgets], reminders };
}

module.exports = { REQUIRED_STATES, REMINDER_TYPES, listCharacters, loadCharacter };
