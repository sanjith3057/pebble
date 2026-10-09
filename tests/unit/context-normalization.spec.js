/**
 * Unit Tests - Context Gateway: permission, sensitivity, redaction, relevance (System Design §8, §19)
 */
const { processContextEvent, redact } = require('../../core/context/gateway');
const { PermissionStore } = require('../../security/permissions/permissions');

function permissionsWith(...granted) {
  const store = new PermissionStore();
  granted.forEach((p) => store.grant(p));
  return store;
}

const clipboard = (text, extra = {}) => ({
  type: 'clipboard',
  source: 'desktop',
  timestamp: '2026-10-09T12:00:00Z',
  data: { text, ...extra },
});

describe('processContextEvent', () => {
  test('blocks context the user has not granted', () => {
    const result = processContextEvent(clipboard('hello'), { permissions: permissionsWith() });
    expect(result).toEqual({ allowed: false, reason: 'context.clipboard not granted' });
  });

  test('blocks unknown context types', () => {
    const result = processContextEvent({ type: 'keylogger', data: {} }, { permissions: permissionsWith('context.screen') });
    expect(result.allowed).toBe(false);
  });

  test('blocks content copied from password managers', () => {
    const event = clipboard('correct horse battery staple', { sourceApp: '1Password' });
    const result = processContextEvent(event, { permissions: permissionsWith('context.clipboard') });
    expect(result).toEqual({ allowed: false, reason: 'Content from a sensitive application' });
  });

  test('passes normal content through, marked as untrusted', () => {
    const result = processContextEvent(clipboard('TypeError: x is undefined'), { permissions: permissionsWith('context.clipboard') });
    expect(result.allowed).toBe(true);
    expect(result.package).toMatchObject({
      type: 'clipboard',
      sensitivity: 'medium',
      redactions: 0,
      trust: 'untrusted',
      data: { text: 'TypeError: x is undefined' },
    });
  });

  test('redacts secrets and marks the package high sensitivity', () => {
    const text = 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";';
    const result = processContextEvent(clipboard(text), { permissions: permissionsWith('context.clipboard') });
    expect(result.package.data.text).not.toContain('sk-abcdefghij');
    expect(result.package.data.text).toContain('[REDACTED:API_KEY]');
    expect(result.package.sensitivity).toBe('high');
  });

  test('trims long content to the relevance limit', () => {
    const result = processContextEvent(clipboard('a'.repeat(5000)), { permissions: permissionsWith('context.clipboard'), maxChars: 100 });
    expect(result.package.data.text.length).toBeLessThan(120);
    expect(result.package.data.text).toMatch(/\[truncated\]$/);
  });

  test('drops non-text fields such as raw buffers or nested objects', () => {
    const event = { type: 'active_application', data: { application: 'code_editor', screenshot: Buffer.from('png'), meta: { a: 1 } } };
    const result = processContextEvent(event, { permissions: permissionsWith('context.screen') });
    expect(Object.keys(result.package.data)).toEqual(['application']);
    expect(result.package.sensitivity).toBe('low');
  });
});

describe('redact', () => {
  test.each([
    ['AWS key', 'AKIAIOSFODNN7EXAMPLE', 'AWS_KEY'],
    ['GitHub token', 'ghp_' + 'a'.repeat(36), 'GITHUB_TOKEN'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig_nature-x', 'JWT'],
    ['bearer token', 'Authorization: Bearer abcdefghijklmnopqrstu', 'BEARER_TOKEN'],
    ['password assignment', 'password=hunter2', 'PASSWORD'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----', 'PRIVATE_KEY'],
    ['card number', 'card: 4111 1111 1111 1111', 'CARD_NUMBER'],
  ])('redacts %s', (_label, secret, marker) => {
    const { text, count } = redact(`before ${secret} after`);
    expect(text).toContain(`[REDACTED:${marker}]`);
    expect(count).toBeGreaterThan(0);
  });

  test('leaves ordinary numbers alone (fails Luhn check)', () => {
    expect(redact('order 1234 5678 9012 3456').count).toBe(0);
  });
});
