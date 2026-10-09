# API Key Security Guide

How Pebble protects the API keys users give it, what you must keep doing as the app grows, and what to study next.

---

## 1. How a key flows through the app

```text
 Settings window (sandboxed page)          Main process (Node)                 Disk
 ───────────────────────────────          ───────────────────                 ────
 [password field] ──setApiKey──────────▶  ApiKeyStore.set()
                   (one way only)          ├─ validate format
                                           └─ EncryptedJsonStore.write() ──▶ secrets.bin
                                                 safeStorage (Windows DPAPI)    (encrypted)

 [Saved …wxyz]   ◀──status()────────────  only { configured, hint: last 4 }

 [Test] ─────────testApiKey(provider)──▶  key read here, used here ───────▶ provider API (HTTPS)
 [Key works.]    ◀──{ ok, message }──────  fixed message, never the key
```

**The key never comes back to any web page.** The renderer can save a key, remove it, or ask for a test, but no IPC call returns it.

| File | Job |
|---|---|
| [security/secrets/encrypted-store.js](../security/secrets/encrypted-store.js) | Encrypts the whole file with the OS keychain. Refuses to fall back to plain text. |
| [security/secrets/key-store.js](../security/secrets/key-store.js) | Per-provider keys, format checks, the safe `status()` summary. |
| [security/secrets/key-tester.js](../security/secrets/key-tester.js) | Checks a key with the provider's free "list models" endpoint. |
| [apps/desktop/preload-settings.js](../apps/desktop/preload-settings.js) | The only functions the settings page can call. There is no "get key" function. |
| [tests/security/api-keys.spec.js](../tests/security/api-keys.spec.js) | Proves the rules below. |

---

## 2. The rules (do not break these)

1. **Keys live only in the main process.** Never send a key over IPC, never put one in `localStorage`, a cookie, a URL or a renderer variable.
2. **Encrypt at rest with `safeStorage`.** On Windows this is DPAPI: the file can only be decrypted by the same Windows user on the same PC. If encryption is unavailable, refuse to save (we do).
3. **Never log keys.** No `console.log(key)`, no key inside an `Error` message, no key in crash reports or analytics. Error messages shown to users are fixed strings chosen by status code.
4. **Keys go in headers, not URLs.** URLs end up in logs and proxies. (Google accepts `?key=`; we use the `x-goog-api-key` header instead.)
5. **HTTPS only**, to the provider's official host only.
6. **Validate the format** before saving, so users don't paste a password by mistake.
7. **The settings page has no network access.** Its CSP has no `connect-src`, so even injected script could not send a key anywhere.
8. **Never ship your own key inside the app.** Anyone can unpack an Electron app (`npx asar extract app.asar out`) and read it in minutes. Users bring their own key. If you ever want to pay for users' AI, run your own server that holds the key and rate-limits users.
9. **Let users delete their key** (Remove button), and delete `secrets.bin` on uninstall.

---

## 3. What this protects against, and what it doesn't

| Threat | Protected? | How |
|---|---|---|
| Someone copies `secrets.bin` to another PC | ✅ | DPAPI ties it to this Windows user |
| Prompt-injected text runs script in a page | ✅ | Pages can't read keys; settings page can't reach the network |
| Key leaks via logs or error messages | ✅ | Fixed messages, no logging |
| Key leaks via a malicious "Get a key" link | ✅ | Main only opens the 3 hard-coded provider URLs |
| Malware running **as the same Windows user** | ❌ | It can ask DPAPI too. No desktop app can fully stop this. |
| A cracked copy of your app that sends keys home | ❌ | Code signing + only distributing from official sources |
| Memory dump while the app runs | ⚠️ | JavaScript strings can't be wiped; keep keys in memory only as long as needed |

Be honest about the ❌ rows in your privacy policy. No local app can promise more than that.

---

## 4. Before you publish: checklist

- [ ] `npm test` passes, including `tests/security/`
- [ ] Search the code for `console.log` near anything named `key`, `token`, `secret`
- [ ] `npm audit --omit=dev` shows 0 vulnerabilities
- [ ] Electron is on a supported major version (latest 3)
- [ ] App is **code signed** (Windows: Azure Trusted Signing or an OV/EV certificate), so users can tell it's really yours
- [ ] Auto-updates are signed (`electron-updater`), so attackers can't push a fake update
- [ ] Electron Fuses set: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on
- [ ] Privacy policy explains: keys stay on the device, which providers receive which data, how to delete everything
- [ ] Uninstaller removes `%APPDATA%\Pebble\secrets.bin` and `memory.bin` (or offers to)

---

## 5. Guide for your users (put this on your website)

> **Is my API key safe in Pebble?**
> Your key is encrypted with Windows' built-in protection and stored only on your computer. Pebble never sends it anywhere except directly to the AI provider you chose, and it never shows it again after you save it, only the last 4 characters.
>
> **Good habits:**
> - Create a separate key just for Pebble, so you can revoke it without affecting other apps.
> - Set a monthly spending limit in your provider's console.
> - If you think a key leaked, revoke it in the provider's console first, then press **Remove** in Pebble.
>
> Where to get or revoke keys: [Anthropic](https://console.anthropic.com/settings/keys) · [OpenAI](https://platform.openai.com/api-keys) · [Google AI Studio](https://aistudio.google.com/apikey)

---

## 6. What to study next

In order of importance for this project:

1. **[Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security):** every item, especially context isolation, sandbox, CSP and IPC sender validation.
2. **[Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage):** what it protects and what it doesn't on each OS.
3. **[OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html):** rotation, revocation, least privilege.
4. **[OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/):** prompt injection, sensitive information disclosure, excessive agency.
5. **[Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)** and **[code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing):** needed before publishing.
6. **Windows DPAPI basics:** why "same user" malware is the limit of local protection.
