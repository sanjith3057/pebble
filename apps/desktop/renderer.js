const stage = document.getElementById('stage');
const lean = document.getElementById('lean');
const squash = document.getElementById('squash');
const layers = [document.getElementById('layer-a'), document.getElementById('layer-b')];
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

// Movement (in px) below which a press counts as a click rather than a drag.
const CLICK_THRESHOLD = 4;
const PREVIEW_STEP_MS = 2200;
const REMINDER_TIMEOUT_MS = 2 * 60 * 1000;

const PREVIEW = [
  ['greet', 'Hello!'],
  ['curious', 'I have an idea…'],
  ['thinking', 'Thinking…'],
  ['talking', "Here's what I found."],
  ['success', 'Done!'],
  ['warning', 'Heads up!'],
  ['error', "Hmm, that didn't work."],
  ['sleep', 'Quiet mode… zzz'],
];

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let animationLevel = 'full';
let front = 0;
let pressStart = null;
let clickThrough = true;
let bubbleTimer = null;
let previewTimers = [];
let activeReminder = null;
let reminderTimer = null;
let lastAppWave = 0;
const moods = { search: false, music: false, away: false };

const APP_WAVE_COOLDOWN_MS = 30 * 1000;

const particles = window.Particles.create(document.getElementById('fx'), getAnchor);
const animator = new window.CharacterState.CharacterAnimator({ render: renderFrame });

/** Where effects come from: the character's center and roughly its head. */
function getAnchor() {
  const box = stage.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  return { cx, cy: box.top + box.height * 0.55, headX: cx + 10, headY: box.top + box.height * 0.18 };
}

function fullMotion() {
  return animationLevel === 'full' && !reducedMotionQuery.matches;
}

// ---------- Rendering ----------

function renderFrame({ state, pose, src }) {
  stage.dataset.state = state;
  particles.setState(state, pose);
  if (layers[front].getAttribute('src') === src) return;

  // Load into the hidden layer, then crossfade, so poses never flash blank.
  const next = new Image();
  next.onload = () => {
    const back = 1 - front;
    layers[back].src = src;
    layers[back].classList.add('front');
    layers[front].classList.remove('front');
    front = back;
    if (fullMotion()) {
      // Squash-and-stretch "pop" on every pose change.
      squash.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(1.07, 0.9)', offset: 0.3 },
          { transform: 'scale(0.97, 1.05)', offset: 0.65 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 340, easing: 'ease-out' },
      );
    }
  };
  next.src = src;
}

function preloadPoses(character) {
  for (const src of Object.values(character.poses)) new Image().src = src;
}

function say(text, ms = 3500, { interactive = false } = {}) {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text; // textContent, never innerHTML: AI text must not become HTML
  bubble.classList.toggle('interactive', interactive);
  bubble.classList.add('visible');
  if (ms) bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubble.classList.remove('visible', 'interactive');
}

function applyAnimationSettings(animation) {
  animationLevel = animation.level;
  document.body.dataset.anim = animation.level;
  particles.setEnabled(fullMotion());
  animator.setFidgets(animation.fidgets && animation.level !== 'off');
  if (!fullMotion()) lean.style.transform = '';
}

async function switchCharacter(character, greeting) {
  if (!character) {
    say('Could not load the character.', 6000);
    return;
  }
  preloadPoses(character);
  // Exit animation for the old character, if there is one.
  if (animator.character && fullMotion()) {
    await stage.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(30px) scale(0.8)', opacity: 0 }], {
      duration: 260,
      easing: 'ease-in',
    }).finished;
  }
  animator.setCharacter(character);
  if (greeting && !animator.quiet) setTimeout(() => say(greeting, 3000), character.states.enter ? 900 : 0);
}

// ---------- Reminders (from the agents in the main process) ----------

function showReminder(reminder) {
  stopPreview();
  activeReminder = reminder;
  const labels = reminder.labels || {};
  document.getElementById('btn-done').textContent = labels.done || 'Done ✓';
  document.getElementById('btn-snooze').textContent = labels.snooze || 'Snooze 10 min';
  animator.playReminder(reminder.type);
  say(reminder.text, 0, { interactive: true });
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => answerReminder('dismiss'), REMINDER_TIMEOUT_MS);
}

function answerReminder(action) {
  if (!activeReminder) return;
  const activeId = activeReminder.id;
  window.api.respondReminder(activeId, action);
  activeReminder = null;
  clearTimeout(reminderTimer);
  if (action === 'done' && !String(activeId).startsWith('unsaved:')) {
    animator.play('success');
    say('Nice! 🎉', 1800);
  } else {
    hideBubble();
    animator.rest();
  }
}

document.getElementById('btn-done').addEventListener('click', () => answerReminder('done'));
document.getElementById('btn-snooze').addEventListener('click', () => answerReminder('snooze'));

// ---------- Preview (tray / settings) ----------

function stopPreview() {
  previewTimers.forEach(clearTimeout);
  previewTimers = [];
}

function playPreview() {
  if (activeReminder) return;
  stopPreview();
  PREVIEW.forEach(([state, text], i) => {
    previewTimers.push(
      setTimeout(() => {
        animator.play(state, { duration: PREVIEW_STEP_MS + 500 });
        say(text, PREVIEW_STEP_MS - 200);
      }, i * PREVIEW_STEP_MS),
    );
  });
  previewTimers.push(setTimeout(() => animator.rest(), PREVIEW.length * PREVIEW_STEP_MS));
}

// ---------- Mouse: click-through, lean, drag, click, right-click ----------

// The window ignores the mouse except over the character or an interactive bubble.
function updateClickThrough(target) {
  const overUi = Boolean(target && target.closest && target.closest('[data-hit], .bubble.interactive'));
  const wanted = !overUi && !pressStart;
  if (wanted !== clickThrough) {
    clickThrough = wanted;
    window.api.setClickThrough(wanted);
  }
}

document.addEventListener('mousemove', (event) => {
  updateClickThrough(event.target);
  if (!fullMotion() || pressStart) return;
  // Lean a little toward the cursor.
  const box = stage.getBoundingClientRect();
  const dx = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / 160));
  lean.style.transform = `translateX(${dx * 6}px) rotate(${dx * 2.5}deg)`;
});

document.addEventListener('mouseleave', () => {
  lean.style.transform = '';
  updateClickThrough(null);
});

stage.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  pressStart = { x: event.screenX, y: event.screenY };
  window.api.dragStart(event.clientX, event.clientY);
});

window.addEventListener('mouseup', (event) => {
  if (!pressStart) return;
  window.api.dragEnd();
  const moved = Math.hypot(event.screenX - pressStart.x, event.screenY - pressStart.y);
  pressStart = null;
  if (moved < CLICK_THRESHOLD) onCharacterClick();
  updateClickThrough(document.elementFromPoint(event.clientX, event.clientY));
});

stage.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.api.openSettings();
});

function onCharacterClick() {
  if (activeReminder) return;
  stopPreview();
  // Placeholder until the chat panel exists (MVP step 3).
  animator.play('talking', { duration: 3000 });
  say('Hi! Chat is coming soon. Right-click me for settings.', 3000);
}

// ---------- Events from the main process ----------

window.api.onCharacterChanged((character) => {
  stopPreview();
  switchCharacter(character, `${character.name} here!`);
});

window.api.onQuietModeChanged((enabled) => {
  stopPreview();
  animator.setQuiet(enabled);
  say(enabled ? 'Going quiet. Wake me from the tray.' : "I'm back!", 2500);
});

window.api.onSettingsChanged((settings) => applyAnimationSettings(settings.animation));
window.api.onPreview(playPreview);
window.api.onReminder(showReminder);

// ---------- Activity awareness (only coarse labels arrive here) ----------

function applyMood() {
  animator.setMood(moods.away ? 'away' : moods.search ? 'search' : moods.music ? 'music' : null);
}

window.api.onActivity((activity) => {
  if (activity.type === 'reset') {
    moods.search = moods.music = moods.away = false;
    applyMood();
  } else if (activity.type === 'search' || activity.type === 'music') {
    moods[activity.type] = Boolean(activity.on);
    applyMood();
  } else if (activity.type === 'away') {
    moods.away = Boolean(activity.on);
    applyMood();
    if (!activity.on && !animator.quiet && !activeReminder) {
      animator.play('greet');
      say('Welcome back! 👋', 2500);
    }
  } else if (activity.type === 'app-closed') {
    const resting = ['idle', 'fidget', 'music', 'search'].includes(animator.state);
    if (animator.quiet || activeReminder || !resting || Date.now() - lastAppWave < APP_WAVE_COOLDOWN_MS) return;
    lastAppWave = Date.now();
    animator.play('greet', { duration: 1600 });
    say(`Bye, ${activity.app}! 👋`, 1600);
  }
});

// ---------- Closing animation ----------

window.api.onGoodbye(({ quit }) => {
  stopPreview();
  clearTimeout(reminderTimer);
  activeReminder = null;
  animator.play('greet', { duration: 60000 });
  say(quit ? 'Bye! See you soon 👋' : 'See you later! 👋', 0);
  const walkOut = () => {
    hideBubble();
    stage.animate(
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: 'translateX(260px)', opacity: 0 },
      ],
      { duration: quit ? 700 : 350, easing: 'ease-in', fill: 'forwards' },
    );
  };
  if (fullMotion()) setTimeout(walkOut, quit ? 900 : 250);
});

window.api.onShown(() => {
  stage.getAnimations().forEach((a) => a.cancel());
  if (!animator.character) return;
  animator.setCharacter(animator.character); // run back in, then wave
  if (!animator.quiet) setTimeout(() => say(startupGreeting(false), 3000), 900);
});

reducedMotionQuery.addEventListener('change', () => applyAnimationSettings({ level: animationLevel, fidgets: animator.fidgets }));

// ---------- Startup ----------

function startupGreeting(firstRun) {
  if (firstRun) return "Hi, I'm your desktop buddy! Right-click me any time for settings.";
  const hour = new Date().getHours();
  if (hour < 5) return "Working late? I'm here if you need me.";
  if (hour < 12) return 'Good morning! ☀️';
  if (hour < 17) return 'Good afternoon!';
  if (hour < 22) return 'Good evening!';
  return "Working late? I'm here if you need me.";
}

Promise.all([window.api.getCharacter(), window.api.getSettings()]).then(([character, settings]) => {
  animator.quiet = Boolean(settings && settings.quietMode);
  if (settings) applyAnimationSettings(settings.animation);
  switchCharacter(character, startupGreeting(!settings || !settings.firstRunDone));
  window.api.greeted();
});
