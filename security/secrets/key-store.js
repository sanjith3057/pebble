// AI providers a user can bring their own key for.
const PROVIDERS = Object.freeze({
  anthropic: { label: 'Anthropic (Claude)', pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, keysUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', pattern: /^sk-[A-Za-z0-9_-]{20,}$/, keysUrl: 'https://platform.openai.com/api-keys' },
  google: { label: 'Google (Gemini)', pattern: /^AIza[0-9A-Za-z_-]{35}$/, keysUrl: 'https://aistudio.google.com/apikey' },
});

function assertProvider(provider) {
  if (typeof provider !== 'string' || !Object.hasOwn(PROVIDERS, provider)) throw new Error('Unknown provider');
}

/**
 * Stores users' API keys, encrypted, in the MAIN process only.
 *
 * Rules (see docs/api-key-security.md):
 * - Keys never go to the renderer. The UI only ever sees `status()`: whether a
 *   key is set and its last 4 characters.
 * - Keys are never logged or included in error messages.
 * - Only well-formed keys are accepted (stops pasting the wrong thing, e.g. a password).
 */
class ApiKeyStore {
  /** @param {{ store: import('./encrypted-store').EncryptedJsonStore, now?: () => number }} deps */
  constructor({ store, now = () => Date.now() }) {
    this.store = store;
    this.now = now;
  }

  load() {
    const data = this.store.read({});
    return data && typeof data === 'object' ? data : {};
  }

  set(provider, key) {
    assertProvider(provider);
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!PROVIDERS[provider].pattern.test(trimmed)) {
      throw new Error(`That doesn't look like a valid ${PROVIDERS[provider].label} API key`);
    }
    const data = this.load();
    data[provider] = { key: trimmed, savedAt: this.now() };
    this.store.write(data);
  }

  /** The raw key. Main process only: never send this over IPC. */
  get(provider) {
    assertProvider(provider);
    const entry = this.load()[provider];
    return entry && typeof entry.key === 'string' ? entry.key : null;
  }

  remove(provider) {
    assertProvider(provider);
    const data = this.load();
    delete data[provider];
    this.store.write(data);
  }

  removeAll() {
    this.store.delete();
  }

  /** Safe summary for the UI: no key material beyond the last 4 characters. */
  status() {
    const data = this.load();
    return Object.entries(PROVIDERS).map(([id, provider]) => {
      const entry = data[id];
      const configured = Boolean(entry && typeof entry.key === 'string');
      return {
        id,
        label: provider.label,
        keysUrl: provider.keysUrl,
        configured,
        hint: configured ? `…${entry.key.slice(-4)}` : null,
        savedAt: configured ? entry.savedAt : null,
      };
    });
  }
}

module.exports = { PROVIDERS, ApiKeyStore };
