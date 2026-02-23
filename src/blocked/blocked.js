/**
 * blocked/blocked.js
 * Reads current state and updates the blocked page's progress display.
 * When goal is met: shows a "go back" button pointing to the original URL.
 * When bypass is active: immediately navigates back to the original URL.
 */

const returnHint  = document.getElementById('return-hint');
const hintIcon    = document.getElementById('hint-icon');
const hintLabel   = document.getElementById('hint-label');
const btnReturn   = document.getElementById('btn-return');
const mainContent = document.querySelectorAll('.tagline, .btn-solve, .sub');

async function updateDisplay() {
  const state = await chrome.storage.local.get({
    solvesToday: 0,
    dailyGoal: 1,
    requireDaily: false,
    dailySolved: false,
    bypassExpiresAt: null,
    lastBlockedUrl: '',
  });

  document.getElementById('solved-count').textContent = state.solvesToday;
  document.getElementById('goal-count').textContent   = state.dailyGoal;

  const dailyInfo       = document.getElementById('daily-info');
  const dailyStatusText = document.getElementById('daily-status-text');

  if (state.requireDaily) {
    dailyInfo.classList.remove('hidden');
    if (state.dailySolved) {
      dailyStatusText.textContent = '✓ Daily challenge complete';
      dailyStatusText.classList.add('daily-done');
    } else {
      dailyStatusText.textContent = 'Daily challenge: still pending';
      dailyStatusText.classList.remove('daily-done');
    }
  }

  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  const bypassActive =
    state.bypassExpiresAt !== null && Date.now() < state.bypassExpiresAt;

  if (bypassActive) {
    // Bypass activated — immediately navigate to the original destination
    window.location.replace(state.lastBlockedUrl || 'https://leetcode.com/problems/');
    return;
  }

  const originalUrl = state.lastBlockedUrl;
  let hostname = '';
  if (originalUrl) {
    try { hostname = new URL(originalUrl).hostname; } catch {}
  }

  if (goalMet) {
    // Unlock the return hint
    returnHint.classList.add('unlocked');
    mainContent.forEach(el => el.classList.add('hidden'));
    hintIcon.textContent = '🎉';
    hintLabel.textContent = "Goal complete! You've earned your internet back.";
    btnReturn.removeAttribute('aria-disabled');
    if (originalUrl) {
      btnReturn.textContent = `🔓 Back to ${hostname || 'site'}`;
      btnReturn.href = originalUrl;
    } else {
      btnReturn.textContent = '📚 Go to LeetCode';
      btnReturn.href = 'https://leetcode.com/problems/';
    }
  } else {
    // Keep hint locked — show how many problems remain
    returnHint.classList.remove('unlocked');
    mainContent.forEach(el => el.classList.remove('hidden'));
    hintIcon.textContent = '🔒';
    const remaining = Math.max(0, state.dailyGoal - state.solvesToday);
    const word = remaining === 1 ? 'problem' : 'problems';
    const siteText = hostname ? ` — unlock access to ${hostname}` : '';
    hintLabel.textContent = `Solve ${remaining} more ${word}${siteText}`;
    btnReturn.setAttribute('aria-disabled', 'true');
    btnReturn.textContent = hostname ? `Return to ${hostname}` : 'Return to site';
    btnReturn.href = '#';
  }
}

updateDisplay();
setInterval(updateDisplay, 5000);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateDisplay();
});
