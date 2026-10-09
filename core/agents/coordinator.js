const { BUILTIN_AGENTS } = require('./reminder-agents');
const { decideIntervention } = require('../intervention/engine');

const HOUR = 60 * 60 * 1000;
const DEFAULT_SNOOZE_MIN = 10;

/**
 * Runs the reminder agents and decides which (if any) may speak right now.
 *
 * Every candidate goes through the Intervention Engine (System Design §10), so
 * reminders obey the same rules as everything else: quiet mode, focus, the
 * per-hour interruption limit. Only one reminder is shown at a time.
 *
 * Custom reminders ("Meeting at 3pm") were set by the user, so they count as
 * user-requested and are shown even in quiet mode.
 */
class AgentCoordinator {
  /**
   * @param {object} deps
   * @param {() => number} [deps.now]
   * @param {() => { reminders: object, customReminders: Array<{ id: string, text: string, at: number }> }} deps.getConfig
   * @param {() => { quietMode?: boolean, focused?: boolean }} [deps.getState]
   */
  constructor({ now = () => Date.now(), getConfig, getState = () => ({}) }) {
    this.now = now;
    this.getConfig = getConfig;
    this.getState = getState;
    this.startedAt = now();
    this.lastShown = {};    // agentId -> time it last finished
    this.snoozedUntil = {}; // agentId -> time
    this.shownTimes = [];   // for the per-hour limit
    this.active = null;     // reminder currently on screen
    this.doneCustom = new Set();
  }

  /** Call periodically. Returns a reminder to show, or null. */
  tick() {
    return this.pick(this.dueCandidates(this.now()));
  }

  /**
   * Offer a one-off suggestion from another source (e.g. activity awareness).
   * It obeys the same rules as reminders. Returns the reminder to show, or null.
   */
  offer(candidate) {
    return this.pick([candidate]);
  }

  pick(candidates) {
    if (this.active) return null;
    const now = this.now();
    this.shownTimes = this.shownTimes.filter((t) => now - t < HOUR);
    const state = this.getState();

    let best = null;
    for (const candidate of candidates) {
      const decision = decideIntervention(candidate, {
        quietMode: state.quietMode,
        focused: state.focused,
        userRequested: candidate.userRequested,
        interruptionsLastHour: this.shownTimes.length,
      });
      if (decision.decision === 'offer_help' && (!best || decision.score > best.decision.score)) {
        best = { candidate, decision };
      }
    }
    if (!best) return null;

    const { candidate } = best;
    this.active = {
      id: `${candidate.agentId}:${now}`,
      agentId: candidate.agentId,
      type: candidate.reminderType,
      text: candidate.text,
      shownAt: now,
      ...(candidate.labels ? { labels: candidate.labels } : {}),
    };
    this.shownTimes.push(now);
    return { ...this.active };
  }

  /**
   * The user's answer to the reminder on screen.
   * @param {string} id
   * @param {'done'|'snooze'|'dismiss'} action
   */
  respond(id, action, snoozeMin = DEFAULT_SNOOZE_MIN) {
    if (!this.active || this.active.id !== id) return false;
    const { agentId } = this.active;
    const now = this.now();
    if (action === 'snooze') {
      this.snoozedUntil[agentId] = now + snoozeMin * 60000;
    } else {
      this.lastShown[agentId] = now;
      if (agentId.startsWith('custom:')) this.doneCustom.add(agentId);
    }
    this.active = null;
    return true;
  }

  /** Show an agent's reminder right away (for the "Test" button). Ignores timing, not quiet mode. */
  trigger(agentId) {
    if (this.active) return null;
    const agent = BUILTIN_AGENTS.find((a) => a.id === agentId);
    if (!agent) return null;
    const now = this.now();
    this.active = { id: `${agent.id}:${now}`, agentId: agent.id, type: agent.reminderType, text: agent.text, shownAt: now };
    return { ...this.active };
  }

  /** When each enabled agent will next want to speak, for the settings UI. */
  status() {
    const { reminders } = this.getConfig();
    return BUILTIN_AGENTS.map((agent) => {
      const config = reminders[agent.id] || {};
      const enabled = reminders.enabled !== false && config.enabled === true;
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        enabled,
        everyMin: config.everyMin,
        nextAt: enabled ? this.nextDue(agent.id, config.everyMin) : null,
      };
    });
  }

  // --- internals ---

  /** Interval after the last reminder (or app start), pushed back by any snooze. */
  nextDue(agentId, everyMin) {
    const fromInterval = (this.lastShown[agentId] || this.startedAt) + everyMin * 60000;
    return Math.max(fromInterval, this.snoozedUntil[agentId] || 0);
  }

  dueCandidates(now) {
    const { reminders, customReminders = [] } = this.getConfig();
    const candidates = [];

    if (reminders.enabled !== false) {
      for (const agent of BUILTIN_AGENTS) {
        const config = reminders[agent.id];
        if (!config || config.enabled !== true) continue;
        if (now < this.nextDue(agent.id, config.everyMin)) continue;
        candidates.push({ agentId: agent.id, reminderType: agent.reminderType, text: agent.text, reason: agent.name, ...agent.scores });
      }
    }

    for (const reminder of customReminders) {
      const agentId = `custom:${reminder.id}`;
      if (this.doneCustom.has(agentId) || reminder.at > now) continue;
      if ((this.snoozedUntil[agentId] || 0) > now) continue;
      candidates.push({
        agentId,
        reminderType: 'meeting',
        text: reminder.text,
        reason: 'Your reminder',
        userRequested: true,
        helpfulness: 1,
        confidence: 1,
        urgency: 0.9,
        interruptionCost: 0.1,
      });
    }
    return candidates;
  }
}

module.exports = { AgentCoordinator, DEFAULT_SNOOZE_MIN };
