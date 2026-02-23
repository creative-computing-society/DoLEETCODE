/**
 * blocked/blocked.js
 * Reads current state and updates the blocked page's progress display.
 * When goal is met: shows a "go back" button pointing to the original URL.
 * When bypass is active: immediately navigates back to the original URL.
 */

const goalDoneSection = document.getElementById('goal-done');
const btnReturn       = document.getElementById('btn-return');
const mainContent     = document.querySelectorAll('.tagline, .btn-solve, .sub');

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

  if (goalMet) {
    // Show the "go back" button, hide the blocking UI
    goalDoneSection.classList.remove('hidden');
    mainContent.forEach(el => el.classList.add('hidden'));

    const originalUrl = state.lastBlockedUrl;
    if (originalUrl) {
      try {
        const hostname = new URL(originalUrl).hostname;
        btnReturn.textContent = `🔓 Back to ${hostname}`;
      } catch {
        btnReturn.textContent = '🔓 Continue to site';
      }
      btnReturn.href = originalUrl;
    } else {
      btnReturn.textContent = '📚 Go to LeetCode';
      btnReturn.href = 'https://leetcode.com/problems/';
    }
  }
}

updateDisplay();
setInterval(updateDisplay, 5000);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateDisplay();
});
