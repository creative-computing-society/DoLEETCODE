/**
 * blocked/blocked.js
 * Reads current state and updates the blocked page's progress display.
 * Note: cannot use ES modules here (loaded as regular script).
 */

async function updateDisplay() {
  const state = await chrome.storage.local.get({
    solvesToday: 0,
    dailyGoal: 1,
    requireDaily: false,
    dailySolved: false,
    bypassExpiresAt: null,
  });

  document.getElementById('solved-count').textContent = state.solvesToday;
  document.getElementById('goal-count').textContent = state.dailyGoal;

  const dailyInfo = document.getElementById('daily-info');
  const dailyStatusText = document.getElementById('daily-status-text');

  if (state.requireDaily) {
    dailyInfo.classList.remove('hidden');
    if (state.dailySolved) {
      dailyStatusText.textContent = '✓ Daily challenge complete';
      dailyStatusText.classList.add('daily-done');
    } else {
      dailyStatusText.textContent = 'Daily challenge: still pending';
    }
  }

  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  const bypassActive =
    state.bypassExpiresAt !== null && Date.now() < state.bypassExpiresAt;

  // Redirect away from blocked page when goal is met OR bypass is active
  if (goalMet || bypassActive) {
    window.location.replace('https://leetcode.com/problems/');
  }
}

// Update immediately and poll every 5 seconds
updateDisplay();
setInterval(updateDisplay, 5000);

// Also update when storage changes (passive detection fires and updates storage)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.solvesToday || changes.dailySolved)) {
    updateDisplay();
  }
});
