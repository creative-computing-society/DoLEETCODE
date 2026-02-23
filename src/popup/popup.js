/**
 * popup/popup.js
 * Renders popup: progress, streak, daily challenge, bypass.
 * Settings live on the full options page (⚙️ opens a tab).
 */

// ── Element refs ──────────────────────────────────────────────────────────────
const viewSetup       = document.getElementById('view-setup');
const viewLogin       = document.getElementById('view-login');
const viewMain        = document.getElementById('view-main');

const bannerDone      = document.getElementById('banner-done');
const bannerBypass    = document.getElementById('banner-bypass');
const bypassCountdown = document.getElementById('bypass-countdown');
const progressFraction = document.getElementById('progress-fraction');
const progressBar     = document.getElementById('progress-bar');
const streakCurrent   = document.getElementById('streak-current');
const streakLongest   = document.getElementById('streak-longest');
const dailyCard       = document.getElementById('daily-card');
const dailyLink       = document.getElementById('daily-link');
const dailyBadge      = document.getElementById('daily-badge');
const btnBypass       = document.getElementById('btn-bypass');
const btnSettings     = document.getElementById('btn-settings');
const btnOpenSettings = document.getElementById('btn-open-settings');
const overflowRow     = document.getElementById('overflow-row');
const overflowBadge   = document.getElementById('overflow-badge');
const btnSync         = document.getElementById('btn-sync');

let countdownInterval = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Render ─────────────────────────────────────────────────────────────────────
function render(state) {
  if (!state.leetcodeUsername) { showView('view-setup'); return; }
  if (state.loggedIn === false) { showView('view-login'); return; }

  showView('view-main');

  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  const bypassActive =
    state.bypassExpiresAt !== null && Date.now() < state.bypassExpiresAt;

  // Banners
  bannerDone.classList.toggle('hidden', !goalMet);
  bannerBypass.classList.toggle('hidden', !bypassActive);

  // Live bypass countdown
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

  // Overflow — show how many extra problems solved beyond the goal
  const overflow = state.solvesToday - state.dailyGoal;
  if (overflow > 0) {
    const word = overflow === 1 ? 'problem' : 'problems';
    overflowBadge.textContent = `+${overflow} ${word} over goal`;
    overflowRow.classList.remove('hidden');
  } else {
    overflowRow.classList.add('hidden');
  }

  // Streak
  streakCurrent.textContent = state.currentStreak ?? 0;
  streakLongest.textContent = state.longestStreak ?? 0;

  // Daily challenge card
  if (state.dailyTitle) {
    dailyCard.classList.remove('hidden');
    dailyLink.textContent = state.dailyTitle;
    dailyLink.href = state.dailyLink || 'https://leetcode.com';
    if (state.requireDaily) {
      dailyBadge.textContent = state.dailySolved ? '✓ Solved' : 'Pending';
      dailyBadge.className   = state.dailySolved ? 'badge done' : 'badge pending';
    } else {
      dailyBadge.textContent = 'Today';
      dailyBadge.className   = 'badge';
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
async function loadAndRender() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    render(state);
  } catch {
    // Service worker waking — fall back to direct storage read
    const state = await chrome.storage.local.get({
      leetcodeUsername: '', dailyGoal: 1, requireDaily: false,
      notifyOnComplete: true, solvesToday: 0, dailySolved: false,
      bypassUsed: false, bypassExpiresAt: null, loggedIn: null,
      currentStreak: 0, longestStreak: 0, dailyTitle: '', dailyLink: '',
    });
    render(state);
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
btnSettings?.addEventListener('click', () => chrome.runtime.openOptionsPage());
btnOpenSettings?.addEventListener('click', () => chrome.runtime.openOptionsPage());

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

btnSync?.addEventListener('click', async () => {
  btnSync.disabled = true;
  btnSync.textContent = '↻ Syncing…';
  try {
    await chrome.runtime.sendMessage({ type: 'FORCE_SYNC' });
    await loadAndRender();
  } catch {
    // Service worker woke mid-call — still try to re-render
    await loadAndRender();
  } finally {
    btnSync.disabled = false;
    btnSync.textContent = '↻ Sync';
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAndRender();
setInterval(loadAndRender, 30_000);
