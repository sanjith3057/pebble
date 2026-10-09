// Settings window UI. Everything user-provided is rendered with textContent,
// never innerHTML, so memory text or reminder names can't inject HTML.
const api = window.settingsApi;
let state = null;

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function toggle(checked, onChange, label) {
  const input = el('input', { type: 'checkbox', 'aria-label': label });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, [input, el('span')]);
}

function setStatus(node, text, ok) {
  node.textContent = text || '';
  node.className = `status ${ok ? 'ok' : 'err'}`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

// ---------- tabs ----------

document.querySelectorAll('nav [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('nav [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('section[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    });
  });
});

// ---------- rendering ----------

async function refresh() {
  const response = await api.getState();
  if (!response.ok) return;
  state = response;
  render();
}

async function update(patch) {
  const response = await api.update(patch);
  if (response.ok) {
    state.settings = response.settings;
    render();
  }
}

function render() {
  renderCharacters();
  renderFeatures();
  renderAgents();
  renderMemories(state.memories);
  renderKeys();
  renderPrivacy();
}

const SIGNALS = [
  ['search', 'Searching', 'Shows the magnifier pose while you search.'],
  ['music', 'Music', 'Grooves along while music plays.'],
  ['unsaved', 'Unsaved work', 'Asks if you want to save when you leave an app with unsaved changes.'],
  ['appClose', 'Closing apps', 'Waves goodbye when you close an app.'],
  ['away', 'Away / back', 'Naps while you are away and says welcome back.'],
];

function renderPrivacy() {
  const activity = state.settings.activity;
  $('activity-unsupported').hidden = state.activitySupported;
  $('activity-pill').textContent = activity.enabled ? 'On' : 'Off';
  $('activity-pill').className = `pill ${activity.enabled ? '' : 'off'}`;
  $('activity-toggle').textContent = activity.enabled ? 'Turn off' : 'Turn on…';
  $('activity-toggle').className = `btn small ${activity.enabled ? 'danger' : 'primary'}`;
  $('activity-signals').replaceChildren(
    ...(activity.enabled
      ? SIGNALS.map(([key, name, description]) =>
          el('div', { class: 'row' }, [
            el('div', { class: 'grow' }, [el('div', { text: name }), el('div', { class: 'muted', text: description })]),
            toggle(activity.signals[key], (on) => update({ activity: { signals: { [key]: on } } }), name),
          ]),
        )
      : []),
  );
  $('offline').checked = state.settings.privacy.offlineMode;
}

function renderCharacters() {
  $('characters').replaceChildren(
    ...state.characters.map((c) =>
      el(
        'button',
        {
          class: 'character',
          role: 'radio',
          'aria-checked': String(c.id === state.settings.characterId),
          onclick: async () => {
            const response = await api.setCharacter(c.id);
            if (response.ok) {
              state.settings = response.settings;
              renderCharacters();
            }
          },
        },
        [el('img', { src: c.preview, alt: '' }), el('div', { class: 'title', text: c.name })],
      ),
    ),
  );
}

function renderFeatures() {
  const s = state.settings;
  $('quiet').checked = s.quietMode;
  $('fidgets').checked = s.animation.fidgets;
  document.querySelectorAll('#anim-level button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === s.animation.level)));
}

function renderAgents() {
  const s = state.settings;
  $('agents-enabled').checked = s.reminders.enabled;
  $('agents').replaceChildren(
    ...state.agents.map((agent) => {
      const config = s.reminders[agent.id];
      const every = el('input', { type: 'number', min: '5', max: '240', 'aria-label': `${agent.name} interval in minutes` });
      every.value = config.everyMin;
      every.addEventListener('change', () => update({ reminders: { [agent.id]: { everyMin: Number(every.value) } } }));
      const next = agent.enabled && agent.nextAt ? `Next around ${shortTime.format(agent.nextAt)}` : 'Off';
      return el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [
          el('div', { class: 'grow' }, [el('div', { class: 'title', text: agent.name }), el('div', { class: 'muted', text: agent.description })]),
          toggle(config.enabled, (on) => update({ reminders: { [agent.id]: { enabled: on } } }), agent.name),
        ]),
        el('div', { class: 'row' }, [
          el('span', { class: 'muted', text: 'Every' }),
          every,
          el('span', { class: 'muted', text: 'min' }),
          el('span', { class: `pill ${agent.enabled ? '' : 'off'}`, text: next }),
          el('div', { class: 'grow' }),
          el('button', { class: 'btn small', text: 'Test', onclick: () => api.testAgent(agent.id) }),
        ]),
      ]);
    }),
  );

  $('reminders').replaceChildren(
    ...s.customReminders
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((r) =>
        el('div', { class: 'list-item' }, [
          el('div', { class: 'grow' }, [el('div', { class: 'title', text: r.text }), el('div', { class: 'muted', text: timeFmt.format(r.at) })]),
          el('button', {
            class: 'btn small danger',
            text: 'Delete',
            'aria-label': `Delete reminder ${r.text}`,
            onclick: async () => {
              const response = await api.removeReminder(r.id);
              if (response.ok) {
                state.settings = response.settings;
                renderAgents();
              }
            },
          }),
        ]),
      ),
  );
}

function memoryRow(memory, score) {
  return el('div', { class: 'list-item' }, [
    el('div', { class: 'grow' }, [
      el('div', { text: memory.text }),
      el('div', { class: 'muted', text: score !== undefined ? `match ${Math.round(score * 100)}%` : timeFmt.format(memory.createdAt) }),
    ]),
    el('button', {
      class: 'btn small danger',
      text: 'Forget',
      'aria-label': 'Forget this memory',
      onclick: async () => {
        const response = await api.removeMemory(memory.id);
        if (response.ok) {
          state.memories = response.memories;
          renderMemories(state.memories);
          $('memory-results').replaceChildren();
        }
      },
    }),
  ]);
}

function renderMemories(memories) {
  $('memory-count').textContent = `(${memories.length})`;
  $('memories').replaceChildren(...(memories.length ? memories.map((m) => memoryRow(m)) : [el('div', { class: 'muted', text: 'Nothing remembered yet.' })]));
}

function renderKeys() {
  if (!state.encryptionAvailable) {
    $('key-notice').className = 'notice warn';
    $('key-notice').textContent = 'Secure storage is not available on this system, so keys cannot be saved.';
  }

  const select = $('provider');
  select.replaceChildren(...state.providers.map((p) => el('option', { value: p.id, text: p.label })));
  select.value = state.settings.ai.provider;

  $('providers').replaceChildren(
    ...state.providers.map((p) => {
      const input = el('input', { type: 'password', class: 'grow', autocomplete: 'off', spellcheck: 'false', placeholder: p.configured ? 'Paste a new key to replace' : 'Paste API key', 'aria-label': `${p.label} API key` });
      const status = el('div', { class: 'status' });
      const save = el('button', {
        class: 'btn primary small',
        text: 'Save',
        onclick: async () => {
          const response = await api.setApiKey(p.id, input.value);
          input.value = ''; // never keep the key in the page longer than needed
          if (!response.ok) return setStatus(status, response.error, false);
          state.providers = response.providers;
          renderKeys();
        },
      });
      const actions = [save];
      if (p.configured) {
        actions.push(
          el('button', {
            class: 'btn small',
            text: 'Test',
            onclick: async () => {
              setStatus(status, 'Testing…', true);
              const response = await api.testApiKey(p.id);
              setStatus(status, response.ok ? response.result.message : response.error, response.ok && response.result.ok);
            },
          }),
          el('button', {
            class: 'btn small danger',
            text: 'Remove',
            onclick: async () => {
              const response = await api.removeApiKey(p.id);
              if (response.ok) {
                state.providers = response.providers;
                renderKeys();
              }
            },
          }),
        );
      }
      return el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [
          el('div', { class: 'grow title', text: p.label }),
          el('span', { class: `pill ${p.configured ? '' : 'off'}`, text: p.configured ? `Saved ${p.hint}` : 'Not set' }),
        ]),
        el('div', { class: 'row' }, [input, ...actions]),
        el('div', { class: 'row' }, [el('button', { class: 'link', text: 'Get a key ↗', onclick: () => api.openKeysPage(p.id) })]),
        status,
      ]);
    }),
  );
}

// ---------- static controls ----------

$('preview').addEventListener('click', () => api.previewAnimations());
$('quiet').addEventListener('change', (e) => update({ quietMode: e.target.checked }));
$('fidgets').addEventListener('change', (e) => update({ animation: { fidgets: e.target.checked } }));
document.querySelectorAll('#anim-level button').forEach((b) => b.addEventListener('click', () => update({ animation: { level: b.dataset.level } })));
$('agents-enabled').addEventListener('change', (e) => update({ reminders: { enabled: e.target.checked } }));
$('provider').addEventListener('change', (e) => update({ ai: { provider: e.target.value } }));
$('offline').addEventListener('change', (e) => update({ privacy: { offlineMode: e.target.checked } }));

$('activity-toggle').addEventListener('click', async () => {
  // Consent is a native Windows dialog shown by the main process, not a web page button.
  const response = state.settings.activity.enabled ? await api.revokeActivity() : await api.requestActivityConsent();
  if (response.ok) {
    state.settings = response.settings;
    renderPrivacy();
  }
});

$('delete-all').addEventListener('click', async () => {
  const response = await api.deleteAllData();
  if (response.ok && response.deleted) {
    state = response;
    render();
  }
});

$('reminder-add').addEventListener('click', async () => {
  const at = new Date($('reminder-at').value).getTime();
  const response = await api.addReminder($('reminder-text').value, at);
  if (!response.ok) return setStatus($('reminder-status'), response.error, false);
  state.settings = response.settings;
  $('reminder-text').value = '';
  setStatus($('reminder-status'), 'Reminder added.', true);
  renderAgents();
});

$('memory-add').addEventListener('click', async () => {
  const response = await api.addMemory($('memory-text').value);
  if (!response.ok) return setStatus($('memory-status'), response.error, false);
  $('memory-text').value = '';
  state.memories = response.memories;
  renderMemories(state.memories);
  setStatus($('memory-status'), response.redactions ? 'Saved. A password or key was removed for safety.' : 'Saved.', true);
});

let searchTimer = null;
$('memory-query').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const query = e.target.value.trim();
    if (!query) return $('memory-results').replaceChildren();
    const response = await api.searchMemory(query);
    if (!response.ok) return;
    $('memory-results').replaceChildren(
      ...(response.results.length ? response.results.map((r) => memoryRow(r, r.score)) : [el('div', { class: 'muted', text: 'No matching memories.' })]),
    );
  }, 200);
});

$('memory-clear').addEventListener('click', async () => {
  if (!window.confirm('Delete ALL memories? This cannot be undone.')) return;
  const response = await api.clearMemory();
  if (response.ok) {
    state.memories = [];
    renderMemories(state.memories);
    $('memory-results').replaceChildren();
  }
});

// Default reminder time: one hour from now.
const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
inAnHour.setSeconds(0, 0);
$('reminder-at').value = new Date(inAnHour.getTime() - inAnHour.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

refresh();
