const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BUILTIN_AGENTS, MIN_EVERY, MAX_EVERY } = require('../../core/agents/reminder-agents');
const { PROVIDERS } = require('../../security/secrets/key-store');

const ANIMATION_LEVELS = ['full', 'reduced', 'off'];
const MAX_CUSTOM_REMINDERS = 50;
const MAX_REMINDER_TEXT = 140;

function defaultSettings() {
  return {
    characterId: 'chibi',
    quietMode: false,
    animation: { level: 'full', fidgets: true },
    reminders: {
      enabled: true,
      ...Object.fromEntries(BUILTIN_AGENTS.map((a) => [a.id, { enabled: a.defaultEnabled, everyMin: a.defaultEveryMin }])),
    },
    customReminders: [],
    ai: { provider: 'anthropic' },
    // Off until the user explicitly agrees in Settings > Privacy.
    activity: { enabled: false, consentedAt: null, signals: { search: true, music: true, unsaved: true, appClose: true, away: true } },
    privacy: { offlineMode: false },
    firstRunDone: false,
  };
}

const DEFAULTS = Object.freeze(defaultSettings());

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

function clampMinutes(v, fallback) {
  return Number.isFinite(v) ? Math.min(MAX_EVERY, Math.max(MIN_EVERY, Math.round(v))) : fallback;
}

/**
 * Turn any input (file contents, a patch from the settings window) into valid
 * settings. Unknown keys are dropped and bad values fall back to defaults, so
 * neither a corrupted file nor a malicious renderer can inject odd state.
 */
function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!isObject(raw)) return d;

  const animation = isObject(raw.animation) ? raw.animation : {};
  const reminders = isObject(raw.reminders) ? raw.reminders : {};
  const ai = isObject(raw.ai) ? raw.ai : {};
  const activity = isObject(raw.activity) ? raw.activity : {};
  const signals = isObject(activity.signals) ? activity.signals : {};
  const privacy = isObject(raw.privacy) ? raw.privacy : {};
  const consentedAt = Number.isFinite(activity.consentedAt) ? activity.consentedAt : null;

  return {
    characterId: typeof raw.characterId === 'string' && /^[a-z0-9_-]+$/.test(raw.characterId) ? raw.characterId : d.characterId,
    quietMode: bool(raw.quietMode, d.quietMode),
    animation: {
      level: ANIMATION_LEVELS.includes(animation.level) ? animation.level : d.animation.level,
      fidgets: bool(animation.fidgets, d.animation.fidgets),
    },
    reminders: {
      enabled: bool(reminders.enabled, d.reminders.enabled),
      ...Object.fromEntries(
        BUILTIN_AGENTS.map((agent) => {
          const r = isObject(reminders[agent.id]) ? reminders[agent.id] : {};
          return [agent.id, { enabled: bool(r.enabled, agent.defaultEnabled), everyMin: clampMinutes(r.everyMin, agent.defaultEveryMin) }];
        }),
      ),
    },
    customReminders: (Array.isArray(raw.customReminders) ? raw.customReminders : [])
      .filter((r) => isObject(r) && typeof r.id === 'string' && typeof r.text === 'string' && Number.isFinite(r.at))
      .slice(0, MAX_CUSTOM_REMINDERS)
      .map((r) => ({ id: r.id.slice(0, 64), text: r.text.trim().slice(0, MAX_REMINDER_TEXT), at: r.at })),
    ai: { provider: Object.hasOwn(PROVIDERS, ai.provider) ? ai.provider : d.ai.provider },
    activity: {
      // Can never be on without a recorded consent.
      enabled: bool(activity.enabled, false) && consentedAt !== null,
      consentedAt,
      signals: Object.fromEntries(Object.entries(d.activity.signals).map(([key, value]) => [key, bool(signals[key], value)])),
    },
    privacy: { offlineMode: bool(privacy.offlineMode, d.privacy.offlineMode) },
    firstRunDone: bool(raw.firstRunDone, false),
  };
}

/** Deep-merge a partial update (from the settings window) and re-validate. */
function applyPatch(settings, patch) {
  const merge = (base, update) => {
    if (!isObject(update)) return update === undefined ? base : update;
    const out = { ...(isObject(base) ? base : {}) };
    for (const [key, value] of Object.entries(update)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = merge(out[key], value);
    }
    return out;
  };
  return normalizeSettings(merge(settings, patch));
}

/**
 * Patches from the settings page may not grant activity consent, skip the
 * first-run greeting, or change things that have their own checked IPC
 * (character, custom reminders). Only main decides those.
 */
function sanitizeRendererPatch(patch) {
  if (!isObject(patch)) return {};
  const { activity, firstRunDone, customReminders, characterId, ...rest } = patch;
  return isObject(activity) && isObject(activity.signals) ? { ...rest, activity: { signals: activity.signals } } : rest;
}

function newCustomReminder(text, at) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('Reminder text is required');
  if (!Number.isFinite(at)) throw new Error('Reminder time is invalid');
  return { id: crypto.randomUUID(), text: text.trim().slice(0, MAX_REMINDER_TEXT), at };
}

/**
 * Small JSON settings file in the user's app-data folder.
 * Temporary until the SQLite store from System Design §21 exists.
 */
function loadSettings(file) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file); // atomic replace: no half-written file on crash
}

module.exports = { DEFAULTS, ANIMATION_LEVELS, defaultSettings, normalizeSettings, applyPatch, sanitizeRendererPatch, newCustomReminder, loadSettings, saveSettings };
