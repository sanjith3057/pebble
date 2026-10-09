const { Anthropic } = require('@anthropic-ai/sdk');

const TIMEOUT_MS = 10000;

// Results are fixed messages chosen by status code, so a key can never leak
// into the UI or logs through an error message.
function messageForStatus(status) {
  if (status === 401) return { ok: false, message: 'The key was rejected. Check that it is correct and not revoked.' };
  if (status === 403) return { ok: false, message: 'The key is valid but not allowed to use this API.' };
  if (status === 429) return { ok: true, message: 'Key works, but you are being rate limited right now.' };
  if (status >= 500) return { ok: false, message: 'The provider had a server error. Try again later.' };
  return { ok: false, message: `Unexpected response (${status}).` };
}

/**
 * Check a key with the provider's free "list models" endpoint (no tokens used).
 * Runs in the main process; the renderer only receives { ok, message }.
 *
 * @param {'anthropic'|'openai'|'google'} provider
 * @param {string} key
 * @param {{ fetchImpl?: typeof fetch, createAnthropic?: (key: string) => { models: { list: Function } } }} [deps]
 */
async function testApiKey(provider, key, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const createAnthropic = deps.createAnthropic || ((apiKey) => new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 }));

  try {
    if (provider === 'anthropic') {
      await createAnthropic(key).models.list({ limit: 1 });
      return { ok: true, message: 'Key works.' };
    }

    let response;
    if (provider === 'openai') {
      response = await fetchImpl('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } else if (provider === 'google') {
      response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': key }, // header, not ?key=, so it never lands in URL logs
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } else {
      return { ok: false, message: 'Unknown provider.' };
    }
    return response.ok ? { ok: true, message: 'Key works.' } : messageForStatus(response.status);
  } catch (error) {
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') return messageForStatus(error.status);
    return { ok: false, message: 'Could not reach the provider. Check your internet connection.' };
  }
}

module.exports = { testApiKey };
