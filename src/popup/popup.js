/**
 * popup/popup.js
 * Renders the popup UI based on current extension state.
 * Communicates with background service worker via chrome.runtime.sendMessage.
 */

// View elements
const viewSetup = document.getElementById('view-setup');
const viewLogin = document.getElementById('view-login');
const viewMain = document.getElementById('view-main');

// Main view elements
const bannerDone = document.getElementById('banner-done');
const bannerBypass = document.getElementById('banner-bypass');
const bypassCountdown = document.getElementById('bypass-countdown');
const progressFraction = document.getElementById('progress-fraction');
const progressBar = document.getElementById('progress-bar');
const dailyRow = document.getElementById('daily-row');
const dailyStatus = document.getElementById('daily-status');
const btnBypass = document.getElementById('btn-bypass');
const btnSettings = document.getElementById('btn-settings');
const btnOpenSettings = document.getElementById('btn-open-settings');

let countdownInterval = null;

function showView(id) {
  viewSetup.classList.add('hidden');
  viewLogin.classList.add('hidden');
  viewMain.classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function formatCountdown(expiresAt) {
  const remaining = Math.max(0, expiresAt - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function render(state) {
  // 1. Not configured
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

  // Progress bar
  const pct = Math.min(100, Math.round((state.solvesToday / state.dailyGoal) * 100));
  progressBar.style.width = `${pct}%`;
  progressFraction.textContent = `${state.solvesToday} / ${state.dailyGoal}`;

  // Done banner
  bannerDone.classList.toggle('hidden', !goalMet);

  // Bypass banner
  bannerBypass.classList.toggle('hidden', !bypassActive);

  if (bypassActive) {
    // Start / refresh countdown
    clearInterval(countdownInterval);
    const update = () => {
      if (Date.now() >= state.bypassExpiresAt) {
        clearInterval(countdownInterval);
        bypassCountdown.textContent = 'expired';
        return;
      }
      bypassCountdown.textContent = formatCountdown(state.bypassExpiresAt);
    };
    update();
    countdownInterval = setInterval(update, 1000);
  }

  // Daily challenge row
  if (state.requireDaily) {
    dailyRow.classList.remove('hidden');
    if (state.dailySolved) {
      dailyStatus.textContent = '✓ Solved';
      dailyStatus.className = 'badge done';
    } else {
      dailyStatus.textContent = 'Pending';
      dailyStatus.className = 'badge pending';
    }
  } else {
    dailyRow.classList.add('hidden');
  }

  // Emergency bypass button
  const bypassUsedOrActive = state.bypassUsed;
  btnBypass.disabled = bypassUsedOrActive;
  btnBypass.textContent = bypassActive
    ? `🚨 Bypass active (${formatCountdown(state.bypassExpiresAt)})`
    : state.bypassUsed
    ? '🚨 Bypass used today'
    : '🚨 Emergency Bypass (3h)';
}

async function loadAndRender() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    render(state);
  } catch {
    // Service worker may be waking — fall back to direct storage read
    const state = await chrome.storage.local.get({
      leetcodeUsername: '',
      dailyGoal: 1,
      requireDaily: false,
      solvesToday: 0,
      dailySolved: false,
      bypassUsed: false,
      bypassExpiresAt: null,
      loggedIn: null,
    });
    render(state);
  }
}

// Bypass button
btnBypass.addEventListener('click', async () => {
  btnBypass.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ACTIVATE_BYPASS' });
    if (result.success) {
      await loadAndRender();
    } else {
      alert(result.reason || 'Bypass cannot be activated.');
    }
  } catch {
    btnBypass.disabled = false;
  }
});

// Settings buttons
btnSettings?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

btnOpenSettings?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Initial render
loadAndRender();

// Refresh every 30s while popup is open
setInterval(loadAndRender, 30000);
