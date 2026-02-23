/**
 * popup/popup.js
 * Full popup UI: progress, streak, daily challenge, inline settings panel.
 * All writes go through chrome.storage.local; then SETTINGS_UPDATED is sent
 * to the service worker so it can re-evaluate blocking immediately.
 */

// ── Element refs ──────────────────────────────────────────────────────────────
const viewSetup   = document.getElementById('view-setup');
const viewLogin   = document.getElementById('view-login');
const viewMain    = document.getElementById('view-main');

// Setup view
const setupUsername  = document.getElementById('setup-username');
const btnSetupSave   = document.getElementById('btn-setup-save');

// Main view
const bannerDone     = document.getElementById('banner-done');
const bannerBypass   = document.getElementById('banner-bypass');
const bypassCountdown = document.getElementById('bypass-countdown');
const progressFraction = document.getElementById('progress-fraction');
const progressBar    = document.getElementById('progress-bar');
const streakCurrent  = document.getElementById('streak-current');
const streakLongest  = document.getElementById('streak-longest');
const dailyCard      = document.getElementById('daily-card');
const dailyLink      = document.getElementById('daily-link');
const dailyBadge     = document.getElementById('daily-badge');
const btnBypass      = document.getElementById('btn-bypass');
const btnSettings    = document.getElementById('btn-settings');

// Settings panel
const settingsPanel  = document.getElementById('settings-panel');
const btnSettingsClose = document.getElementById('btn-settings-close');
const sUsername      = document.getElementById('s-username');
const sGoal          = document.getElementById('s-goal');
const sRequireDaily  = document.getElementById('s-require-daily');
const sNotify        = document.getElementById('s-notify');
const btnSettingsSave = document.getElementById('btn-settings-save');
const settingsSaved  = document.getElementById('settings-saved');

let countdownInterval = null;

// ── View helpers ──────────────────────────────────────────────────────────────
function showView(id) {
  viewSetup.classList.add('hidden');
  viewLogin.classList.add('hidden');
  viewMain.classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function openSettings(state) {
  // Pre-fill settings panel with current values
  sUsername.value       = state.leetcodeUsername || '';
  sGoal.value           = state.dailyGoal ?? 1;
  sRequireDaily.checked = !!state.requireDaily;
  sNotify.checked       = !!state.notifyOnComplete;
  settingsSaved.classList.add('hidden');
  settingsPanel.classList.remove('hidden');
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
}

// ── Formatting ────────────────────────────────────────────────────────────────
function formatCountdown(expiresAt) {
  const remaining = Math.max(0, expiresAt - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function render(state) {
  // 1. No username — show setup
  if (!state.leetcodeUsername) {
    showView('view-setup');
    return;
  }

  // 2. Not logged in
  if (state.loggedIn === false) {
    showView('view-login');
    return;
  }

  // 3. Main view
  showView('view-main');

  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  const bypassActive =
    state.bypassExpiresAt !== null && Date.now() < state.bypassExpiresAt;

  // Banners
  bannerDone.classList.toggle('hidden', !goalMet);
  bannerBypass.classList.toggle('hidden', !bypassActive);

  // Bypass countdown ticker
  clearInterval(countdownInterval);
  if (bypassActive) {
    const tick = () => {
      if (Date.now() >= state.bypassExpiresAt) {
        clearInterval(countdownInterval);
        bypassCountdown.textContent = 'expired';
        return;
      }
      bypassCountdown.textContent = formatCountdown(state.bypassExpiresAt);
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // Progress
  const pct = state.dailyGoal > 0
    ? Math.min(100, Math.round((state.solvesToday / state.dailyGoal) * 100))
    : 0;
  progressBar.style.width = `${pct}%`;
  progressFraction.textContent = `${state.solvesToday} / ${state.dailyGoal}`;

  // Streak
  streakCurrent.textContent = state.currentStreak ?? 0;
  streakLongest.textContent = state.longestStreak ?? 0;

  // Daily challenge card
  if (state.dailyTitle) {
    dailyCard.classList.remove('hidden');
    dailyLink.textContent = state.dailyTitle;
    dailyLink.href = state.dailyLink || 'https://leetcode.com';

    if (state.requireDaily) {
      if (state.dailySolved) {
        dailyBadge.textContent = '✓ Solved';
        dailyBadge.className = 'badge done';
      } else {
        dailyBadge.textContent = 'Pending';
        dailyBadge.className = 'badge pending';
      }
    } else {
      dailyBadge.textContent = 'Today';
      dailyBadge.className = 'badge';
    }
  } else {
    dailyCard.classList.add('hidden');
  }

  // Bypass button
  btnBypass.disabled = state.bypassUsed;
  btnBypass.textContent = bypassActive
    ? `🚨 Bypass active (${formatCountdown(state.bypassExpiresAt)})`
    : state.bypassUsed
    ? '🚨 Bypass used today'
    : '🚨 Emergency Bypass (3h)';
}

// ── Data loading ──────────────────────────────────────────────────────────────
let _lastState = null;

async function loadAndRender() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    _lastState = state;
    render(state);
  } catch {
    // Service worker waking up — fall back to direct storage read
    const defaults = {
      leetcodeUsername: '', dailyGoal: 1, requireDaily: false,
      notifyOnComplete: true, solvesToday: 0, dailySolved: false,
      bypassUsed: false, bypassExpiresAt: null, loggedIn: null,
      currentStreak: 0, longestStreak: 0, dailyTitle: '', dailyLink: '',
    };
    const state = await chrome.storage.local.get(defaults);
    _lastState = state;
    render(state);
  }
}

// ── Event: setup save ─────────────────────────────────────────────────────────
btnSetupSave?.addEventListener('click', async () => {
  const username = setupUsername.value.trim();
  if (!username) { setupUsername.focus(); return; }
  await chrome.storage.local.set({ leetcodeUsername: username });
  try { await chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }); } catch { /* sw waking */ }
  await loadAndRender();
});

setupUsername?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSetupSave.click();
});

// ── Event: bypass ─────────────────────────────────────────────────────────────
btnBypass?.addEventListener('click', async () => {
  btnBypass.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ACTIVATE_BYPASS' });
    if (result.success) {
      await loadAndRender();
    } else {
      alert(result.reason || 'Bypass cannot be activated.');
      btnBypass.disabled = false;
    }
  } catch {
    btnBypass.disabled = false;
  }
});

// ── Event: open / close settings ─────────────────────────────────────────────
btnSettings?.addEventListener('click', () => {
  openSettings(_lastState || {});
});

btnSettingsClose?.addEventListener('click', closeSettings);

// Close if clicking the panel backdrop (i.e. directly on the panel, not children)
// Not needed here since panel covers full area, so just use the X button.

// ── Event: save settings ─────────────────────────────────────────────────────
btnSettingsSave?.addEventListener('click', async () => {
  const username = sUsername.value.trim();
  const goal = Math.max(1, Math.min(30, parseInt(sGoal.value, 10) || 1));

  if (!username) { sUsername.focus(); return; }

  await chrome.storage.local.set({
    leetcodeUsername: username,
    dailyGoal: goal,
    requireDaily: sRequireDaily.checked,
    notifyOnComplete: sNotify.checked,
  });

  try { await chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }); } catch { /* sw waking */ }

  settingsSaved.classList.remove('hidden');
  setTimeout(() => settingsSaved.classList.add('hidden'), 2000);

  await loadAndRender();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAndRender();

// Refresh every 30 s while popup is open
setInterval(loadAndRender, 30_000);
