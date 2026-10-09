/**
 * Security Tests - Privacy guarantees: consent, no tracking, no hidden network use
 */
const fs = require('fs');
const path = require('path');
const { applyPatch, sanitizeRendererPatch, defaultSettings } = require('../../apps/desktop/settings');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_DIRS = ['apps', 'core', 'security', 'tools', 'adapters'];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'assets' ? [] : sourceFiles(full);
    return /\.(js|html)$/.test(entry.name) ? [full] : [];
  });
}

describe('Activity consent', () => {
  test('activity awareness is off by default', () => {
    expect(defaultSettings().activity).toMatchObject({ enabled: false, consentedAt: null });
  });

  test('it cannot be turned on without a recorded consent', () => {
    expect(applyPatch(defaultSettings(), { activity: { enabled: true } }).activity.enabled).toBe(false);
  });

  test('the settings page cannot grant consent or skip first-run itself', () => {
    const patch = sanitizeRendererPatch({
      activity: { enabled: true, consentedAt: Date.now(), signals: { music: false } },
      firstRunDone: true,
      characterId: 'evil',
      customReminders: [{ id: 'x', text: 'y', at: 1 }],
      quietMode: true,
    });
    expect(patch).toEqual({ activity: { signals: { music: false } }, quietMode: true });
  });

  test('revoking consent turns it off', () => {
    const on = applyPatch(defaultSettings(), { activity: { enabled: true, consentedAt: 1 } });
    expect(on.activity.enabled).toBe(true);
    expect(applyPatch(on, { activity: { enabled: false, consentedAt: null } }).activity.enabled).toBe(false);
  });
});

describe('No tracking, no hidden network use', () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

  test('no analytics or telemetry libraries anywhere', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const dep of deps) expect(dep).not.toMatch(/analytics|telemetry|sentry|mixpanel|segment|amplitude|posthog|datadog|bugsnag|google-analytics/i);
  });

  test('only the key tester may make network requests', () => {
    const NETWORK = /\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon|require\(['"](https?|net|dgram|tls|undici|axios|node-fetch|@anthropic-ai\/sdk|openai|@google\/genai)['"]\)/;
    const offenders = files
      .filter((file) => NETWORK.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
    expect(offenders).toEqual(['security/secrets/key-tester.js']);
  });

  test('every page has a CSP that blocks network access', () => {
    const pages = files.filter((file) => file.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const html = fs.readFileSync(page, 'utf8');
      expect(html).toMatch(/Content-Security-Policy" content="default-src 'none';/);
      expect(html).not.toMatch(/connect-src/);
    }
  });

  test('activity code never writes to disk or logs', () => {
    for (const file of ['core/activity/classifier.js', 'core/activity/activity-monitor.js', 'adapters/operating_system/windows-activity.js']) {
      const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(code).not.toMatch(/require\(['"]fs['"]\)|console\.|writeFile|appendFile/);
    }
  });
});
