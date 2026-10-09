/**
 * Built-in reminder agents (System Design §33 Automation).
 *
 * Each agent is small and independent: it only knows when it would like to
 * speak and what it would say. It never shows anything itself. The
 * AgentCoordinator decides whether a suggestion is actually shown.
 *
 * reminderType picks the character pose: water | break | work | meeting
 *
 * Scores are tuned so each reminder clears the Intervention Engine threshold
 * (50) normally, but is held back while the user is focused (-20).
 */
const BUILTIN_AGENTS = Object.freeze([
  {
    id: 'hydration',
    name: 'Hydration buddy',
    description: 'Reminds you to drink water.',
    reminderType: 'water',
    text: 'Time for a glass of water 💧',
    defaultEveryMin: 60,
    defaultEnabled: true,
    scores: { helpfulness: 0.9, confidence: 0.95, urgency: 0.4, interruptionCost: 0.2 },
  },
  {
    id: 'stretch',
    name: 'Stretch coach',
    description: 'Gets you up from the chair now and then.',
    reminderType: 'break',
    text: 'Stand up and stretch for a minute 🙆',
    defaultEveryMin: 50,
    defaultEnabled: true,
    scores: { helpfulness: 0.9, confidence: 0.9, urgency: 0.4, interruptionCost: 0.25 },
  },
  {
    id: 'eyes',
    name: 'Eye saver',
    description: '20-20-20 rule against screen strain.',
    reminderType: 'break',
    text: 'Look at something 20 feet away for 20 seconds 👀',
    defaultEveryMin: 20,
    defaultEnabled: false,
    scores: { helpfulness: 0.85, confidence: 0.9, urgency: 0.4, interruptionCost: 0.2 },
  },
  {
    id: 'focus',
    name: 'Focus check-in',
    description: 'Asks if you are still on track.',
    reminderType: 'work',
    text: 'Quick check-in: still working on what you planned?',
    defaultEveryMin: 90,
    defaultEnabled: false,
    scores: { helpfulness: 0.85, confidence: 0.85, urgency: 0.3, interruptionCost: 0.25 },
  },
]);

const MIN_EVERY = 5;
const MAX_EVERY = 240;

module.exports = { BUILTIN_AGENTS, MIN_EVERY, MAX_EVERY };
