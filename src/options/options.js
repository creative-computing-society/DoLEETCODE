/**
 * options/options.js
 * Handles loading and saving user settings.
 */

const usernameInput      = document.getElementById('username');
const dailyGoalInput     = document.getElementById('daily-goal');
const requireDailyInput  = document.getElementById('require-daily');
const notifyInput        = document.getElementById('notify-complete');
const rewardMinutesInput = document.getElementById('reward-minutes');
const saveStatus         = document.getElementById('save-status');
const form               = document.getElementById('settings-form');

// Load saved settings into the form
async function loadSettings() {
  const state = await chrome.storage.local.get({
    leetcodeUsername: '',
    dailyGoal: 1,
    requireDaily: false,
    notifyOnComplete: true,
    rewardMinutesPerSolve: 60,
    solvesToday: 0,
    dailySolved: false,
  });

  usernameInput.value        = state.leetcodeUsername;
  dailyGoalInput.value       = state.dailyGoal;
  requireDailyInput.checked  = state.requireDaily;
  notifyInput.checked        = state.notifyOnComplete;
  rewardMinutesInput.value   = state.rewardMinutesPerSolve;

  // Lock goal-related settings if today's goal hasn't been met yet.
  // All fields (including username) are locked until goal is met.
  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  if (!goalMet && state.leetcodeUsername) {
    usernameInput.disabled    = true;
    dailyGoalInput.disabled   = true;
    requireDailyInput.disabled = true;
    document.getElementById('goal-locked-banner').classList.remove('hidden');
  }
}

function showStatus(message, type) {
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${type}`;
  clearTimeout(saveStatus._timer);
  saveStatus._timer = setTimeout(() => {
    saveStatus.className = 'save-status hidden';
  }, 3000);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const dailyGoal = parseInt(dailyGoalInput.value, 10);
  const requireDaily = requireDailyInput.checked;

  if (!usernameInput.disabled && !username) {
    showStatus('Please enter your LeetCode username.', 'error');
    usernameInput.focus();
    return;
  }

  if (!dailyGoalInput.disabled && (!dailyGoal || dailyGoal < 1)) {
    showStatus('Daily goal must be at least 1.', 'error');
    dailyGoalInput.focus();
    return;
  }

  await chrome.storage.local.set({
    // Only persist fields that aren't locked
    ...(usernameInput.disabled  ? {} : { leetcodeUsername: username, lastPollDate: null }),
    ...(dailyGoalInput.disabled ? {} : { dailyGoal, requireDaily }),
    notifyOnComplete: notifyInput.checked,
    rewardMinutesPerSolve: Math.max(5, parseInt(rewardMinutesInput.value, 10) || 60),
  });

  // Tell background service worker to re-evaluate blocking
  try {
    await chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
  } catch {
    // Service worker may be idle — it'll pick up changes on next activation
  }

  showStatus('Settings saved!', 'success');
});

loadSettings();
