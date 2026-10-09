// Which capability each context type needs (System Design §7, §14).
const CONTEXT_PERMISSIONS = Object.freeze({
  active_application: 'context.screen',
  window: 'context.screen',
  clipboard: 'context.clipboard',
  selection: 'context.selection',
  browser: 'context.browser',
  code: 'context.ide',
});

// Apps whose content must never leave the machine, even with permission.
const BLOCKED_APPS = /1password|bitwarden|keepass|lastpass|dashlane|keeper|credential manager/i;

const SECRET_PATTERNS = [
  { label: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'AWS_KEY', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'GITHUB_TOKEN', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { label: 'API_KEY', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { label: 'BEARER_TOKEN', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  { label: 'PASSWORD', pattern: /\b(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*\S+/gi },
];

const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

function passesLuhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Replace secrets in text with [REDACTED:TYPE] markers. */
function redact(text) {
  let count = 0;
  let output = text;
  for (const { label, pattern } of SECRET_PATTERNS) {
    output = output.replace(pattern, () => {
      count++;
      return `[REDACTED:${label}]`;
    });
  }
  output = output.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || !passesLuhn(digits)) return match;
    count++;
    return '[REDACTED:CARD_NUMBER]';
  });
  return { text: output, count };
}

function truncate(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…[truncated]` : text;
}

/**
 * Turn a raw context event into a minimal, redacted package that is safe to
 * give the AI. Raw context must never reach the AI any other way (§41 Decision 2).
 *
 * @returns {{ allowed: false, reason: string } |
 *           { allowed: true, package: object }}
 */
function processContextEvent(event, { permissions, maxChars = 2000 }) {
  const permission = CONTEXT_PERMISSIONS[event && event.type];
  if (!permission) return { allowed: false, reason: `Unsupported context type: ${event && event.type}` };
  if (!permissions.has(permission)) return { allowed: false, reason: `${permission} not granted` };

  const data = event.data || {};
  const appName = [data.application, data.window, data.sourceApp].filter(Boolean).join(' ');
  if (BLOCKED_APPS.test(appName)) return { allowed: false, reason: 'Content from a sensitive application' };

  let redactions = 0;
  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue; // Only plain text fields pass the gateway.
    const result = redact(value);
    redactions += result.count;
    cleaned[key] = truncate(result.text, maxChars);
  }

  const sensitivity = redactions > 0 ? 'high' : ['clipboard', 'selection', 'code'].includes(event.type) ? 'medium' : 'low';

  return {
    allowed: true,
    package: {
      type: event.type,
      source: event.source,
      timestamp: event.timestamp,
      sensitivity,
      redactions,
      // Everything gathered from the screen is data, never instructions (§31).
      trust: 'untrusted',
      data: cleaned,
    },
  };
}

module.exports = { CONTEXT_PERMISSIONS, processContextEvent, redact };
