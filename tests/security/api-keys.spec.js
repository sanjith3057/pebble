/**
 * Security Tests - API key storage and testing (docs/api-key-security.md)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');
const { EncryptedJsonStore } = require('../../security/secrets/encrypted-store');
const { ApiKeyStore, PROVIDERS } = require('../../security/secrets/key-store');
const { testApiKey } = require('../../security/secrets/key-tester');

const ANTHROPIC_KEY = 'sk-ant-api03-' + 'A'.repeat(40) + 'wxyz';
const OPENAI_KEY = 'sk-proj-' + 'B'.repeat(40);
const GOOGLE_KEY = 'AIza' + 'C'.repeat(35);

/** Stand-in for Electron safeStorage: reversible, but the output never contains the plain text. */
function fakeEncryption({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
  };
}

describe('ApiKeyStore', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-keys-'));
    file = path.join(dir, 'secrets.bin');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const makeStore = (opts) => new ApiKeyStore({ store: new EncryptedJsonStore({ file, encryption: fakeEncryption(opts) }) });

  test('stores keys encrypted: the key never appears in the file', () => {
    const store = makeStore();
    store.set('anthropic', ANTHROPIC_KEY);
    const onDisk = fs.readFileSync(file);
    expect(onDisk.toString('utf8')).not.toContain(ANTHROPIC_KEY);
    expect(onDisk.toString('latin1')).not.toContain('sk-ant');
    expect(store.get('anthropic')).toBe(ANTHROPIC_KEY);
  });

  test('status shows only whether a key is set and its last 4 characters', () => {
    const store = makeStore();
    store.set('anthropic', ANTHROPIC_KEY);
    const status = store.status();
    expect(JSON.stringify(status)).not.toContain(ANTHROPIC_KEY.slice(0, -4));
    expect(status.find((p) => p.id === 'anthropic')).toMatchObject({ configured: true, hint: '…wxyz' });
    expect(status.find((p) => p.id === 'openai')).toMatchObject({ configured: false, hint: null });
  });

  test('supports one key per provider', () => {
    const store = makeStore();
    store.set('anthropic', ANTHROPIC_KEY);
    store.set('openai', OPENAI_KEY);
    store.set('google', GOOGLE_KEY);
    expect([store.get('anthropic'), store.get('openai'), store.get('google')]).toEqual([ANTHROPIC_KEY, OPENAI_KEY, GOOGLE_KEY]);
    store.remove('openai');
    expect(store.get('openai')).toBeNull();
    expect(store.get('anthropic')).toBe(ANTHROPIC_KEY);
  });

  test.each([
    ['anthropic', OPENAI_KEY],
    ['anthropic', 'my password'],
    ['google', ANTHROPIC_KEY],
    ['openai', ''],
    ['openai', 'sk-short'],
  ])('rejects a malformed %s key', (provider, key) => {
    expect(() => makeStore().set(provider, key)).toThrow(/doesn't look like/);
  });

  test('error messages never echo the key back', () => {
    try {
      makeStore().set('google', ANTHROPIC_KEY);
    } catch (error) {
      expect(error.message).not.toContain(ANTHROPIC_KEY);
    }
  });

  test('trims whitespace from pasted keys', () => {
    const store = makeStore();
    store.set('openai', `  ${OPENAI_KEY}\n`);
    expect(store.get('openai')).toBe(OPENAI_KEY);
  });

  test('rejects unknown providers, including prototype names', () => {
    const store = makeStore();
    for (const provider of ['azure', '__proto__', 'constructor', '']) {
      expect(() => store.set(provider, OPENAI_KEY)).toThrow(/Unknown provider/);
    }
  });

  test('refuses to save in plain text when OS encryption is unavailable', () => {
    const store = makeStore({ available: false });
    expect(() => store.set('anthropic', ANTHROPIC_KEY)).toThrow(/refusing to store secrets in plain text/);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('a file encrypted by another user/machine reads as empty instead of crashing', () => {
    fs.writeFileSync(file, Buffer.from('garbage that will not decrypt'));
    expect(makeStore().get('anthropic')).toBeNull();
  });

  test('removeAll deletes the file', () => {
    const store = makeStore();
    store.set('anthropic', ANTHROPIC_KEY);
    store.removeAll();
    expect(fs.existsSync(file)).toBe(false);
  });

  test('every provider has an https key page', () => {
    for (const provider of Object.values(PROVIDERS)) expect(provider.keysUrl).toMatch(/^https:\/\//);
  });
});

describe('testApiKey', () => {
  const response = (status) => ({ ok: status >= 200 && status < 300, status });

  test('Anthropic: success via the SDK models.list (no tokens used)', async () => {
    const calls = [];
    const createAnthropic = (key) => ({ models: { list: async (params) => calls.push({ key, params }) } });
    expect(await testApiKey('anthropic', ANTHROPIC_KEY, { createAnthropic })).toEqual({ ok: true, message: 'Key works.' });
    expect(calls).toEqual([{ key: ANTHROPIC_KEY, params: { limit: 1 } }]);
  });

  test('Anthropic: a rejected key gives a fixed message without the key', async () => {
    const createAnthropic = () => ({
      models: {
        list: async () => {
          throw new Anthropic.AuthenticationError(401, { error: { message: `bad key ${ANTHROPIC_KEY}` } }, 'bad', new Headers());
        },
      },
    });
    const result = await testApiKey('anthropic', ANTHROPIC_KEY, { createAnthropic });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rejected/);
    expect(result.message).not.toContain(ANTHROPIC_KEY);
  });

  test('OpenAI: sends the key as a Bearer header', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return response(200);
    };
    expect((await testApiKey('openai', OPENAI_KEY, { fetchImpl })).ok).toBe(true);
    expect(seen[0].url).toBe('https://api.openai.com/v1/models');
    expect(seen[0].init.headers.Authorization).toBe(`Bearer ${OPENAI_KEY}`);
  });

  test('Google: sends the key in a header, never in the URL', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return response(200);
    };
    await testApiKey('google', GOOGLE_KEY, { fetchImpl });
    expect(seen[0].url).not.toContain(GOOGLE_KEY);
    expect(seen[0].init.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
  });

  test.each([
    [401, false, /rejected/],
    [403, false, /not allowed/],
    [429, true, /rate limited/],
    [503, false, /server error/],
  ])('HTTP %i -> ok=%s', async (status, ok, message) => {
    const result = await testApiKey('openai', OPENAI_KEY, { fetchImpl: async () => response(status) });
    expect(result.ok).toBe(ok);
    expect(result.message).toMatch(message);
  });

  test('network failure gives a friendly message', async () => {
    const result = await testApiKey('openai', OPENAI_KEY, {
      fetchImpl: async () => {
        throw new TypeError(`fetch failed for ${OPENAI_KEY}`);
      },
    });
    expect(result).toEqual({ ok: false, message: 'Could not reach the provider. Check your internet connection.' });
  });
});
