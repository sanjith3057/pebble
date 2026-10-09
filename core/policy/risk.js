// Risk levels from System Design §15, ordered from least to most dangerous.
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

// Command patterns that are destructive no matter which tool runs them.
const DESTRUCTIVE_COMMANDS = [
  /\brm\s+(-\w*\s+)*-\w*[rf]/i,     // rm -rf, rm -f
  /\b(del|erase)\b/i,
  /\b(rmdir|rd)\b\s+\/s/i,
  /\bremove-item\b/i,
  /\bformat(-volume)?\b/i,
  /\b(diskpart|mkfs|dd)\b/i,
  /\bshutdown\b|\brestart-computer\b/i,
  /\bgit\s+(push\s+.*--force|reset\s+--hard|clean\s+-\w*f)/i,
  /\breg\s+delete\b/i,
  /\b(curl|wget|iwr|invoke-webrequest)\b.*\|\s*(sh|bash|iex|invoke-expression)\b/i,
];

function maxRisk(a, b) {
  return RISK_LEVELS.indexOf(a) >= RISK_LEVELS.indexOf(b) ? a : b;
}

/**
 * Classify a tool call. Starts at the risk declared by the tool's contract and
 * can only go UP based on the arguments, never down. The AI cannot lower risk.
 */
function classifyRisk(tool, args = {}) {
  if (!RISK_LEVELS.includes(tool.risk)) {
    throw new Error(`Tool ${tool.name} has invalid risk: ${tool.risk}`);
  }
  let risk = tool.risk;

  if (tool.permission === 'filesystem.delete') risk = maxRisk(risk, 'high');
  if (['messaging.send', 'email.send'].includes(tool.permission)) risk = maxRisk(risk, 'high');

  const command = typeof args.command === 'string' ? args.command : '';
  if (command && DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(command))) {
    risk = maxRisk(risk, 'high');
  }

  return risk;
}

/** Medium and high risk actions always need the user's explicit approval. */
function requiresConfirmation(risk) {
  if (!RISK_LEVELS.includes(risk)) return true; // Unknown risk: fail safe.
  return risk !== 'low';
}

module.exports = { RISK_LEVELS, classifyRisk, requiresConfirmation };
