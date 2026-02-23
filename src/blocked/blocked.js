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

  // If goal is now met (e.g., they solved while on this page), redirect to a neutral page
  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  if (goalMet) {
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
