/**
 * utils/storage.js
 * Helpers for reading and writing chrome.storage.local.
 * MV3 service workers terminate when idle — all state lives here, never in module-level vars.
 */

export const DEFAULTS = {
  // Settings
  leetcodeUsername: '',
  dailyGoal: 1,
  requireDaily: false,
  notifyOnComplete: true,

  // Daily progress (reset at UTC midnight)
  solvesToday: 0,
  dailySolved: false,
  bypassUsed: false,
  bypassExpiresAt: null,   // ms timestamp or null
  lastPollDate: null,      // 'YYYY-MM-DD' UTC string or null
  solvedSlugs: [],         // Problem slugs solved today (for deduplication)
  loggedIn: null,          // null = unknown, true/false after first poll

  // Daily challenge info (refreshed each UTC day)
  dailySlug: null,         // e.g. 'two-sum'
  dailyTitle: null,        // e.g. 'Two Sum'
  dailyLink: null,         // e.g. 'https://leetcode.com/problems/two-sum/'

  // Streak tracking (persists across days)
  currentStreak: 0,
  longestStreak: 0,
  lastGoalMetDate: null,   // 'YYYY-MM-DD' UTC of last day goal was met

  // Reward time: free browsing earned by solving problems
  rewardMinutesPerSolve: 60,  // minutes of free time earned per solve
  rewardExpiresAt: null,       // ms timestamp when current reward window closes

  // Rate-limiting guard: epoch ms of last LeetCode API call.
  // Prevents hammering the API on rapid wake-ups or button spam.
  lastPollTimestamp: 0,
};

/** Read all state from storage, merging with defaults for missing keys. */
export async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULTS, resolve);
  });
}

/** Write a partial state update. */
export async function setState(partial) {
  return new Promise((resolve) => {
    chrome.storage.local.set(partial, resolve);
  });
}

/** Reset daily progress (called at UTC midnight). */
export async function resetDailyState() {
  await setState({
    solvesToday: 0,
    dailySolved: false,
    bypassUsed: false,
    bypassExpiresAt: null,
    rewardExpiresAt: null,
    lastPollDate: null,
    solvedSlugs: [],
    dailySlug: null,
    dailyTitle: null,
    dailyLink: null,
  });
}

/** Get today's UTC date as 'YYYY-MM-DD'. */
export function todayUTC() {
  return new Date().toISOString().split('T')[0];
}

/** Get the ms timestamp for the next UTC midnight. */
export function nextUTCMidnight() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/** Get yesterday's UTC date as 'YYYY-MM-DD'. */
export function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}
