/**
 * background/service_worker.js
 * Heart of the extension. Handles:
 *   - Tab-based redirect blocking via chrome.tabs.onUpdated / onActivated
 *     (same approach as golldyydev/LeetCodeForcer — works in Arc, Brave, Edge)
 *   - Daily alarm scheduling and reset (UTC midnight)
 *   - Lazy poll on startup to sync solve count (max once per UTC day)
 *   - Receiving SOLVE_DETECTED messages from the content script
 *   - Emergency bypass activation
 *   - Streak tracking (increment when goal met on consecutive UTC days)
 *   - Goal-complete notifications
 *
 * CRITICAL: MV3 service workers are NOT persistent. They terminate when idle.
 * Never store state in module-level variables — always read from chrome.storage.local.
 */

import { getState, setState, resetDailyState, todayUTC, yesterdayUTC, nextUTCMidnight } from '../utils/storage.js';
import { fetchTodaySolves, fetchDailyChallenge } from '../utils/api.js';

const ALARM_DAILY_RESET  = 'dailyReset';
const ALARM_BYPASS_EXPIRY = 'bypassExpiry';

// ─── URL Whitelist ─────────────────────────────────────────────────────────────

/**
 * Hostnames that are always allowed through.
 * Includes LeetCode itself and Google SSO used for LeetCode login.
 */
const ALLOWED_HOSTNAMES = new Set([
  'leetcode.com',
  'accounts.google.com',
]);

/**
 * URL scheme prefixes that are never blocked.
 * Covers all browser-internal pages (chrome://, arc://, brave://, edge://)
 * and extension pages themselves.
 */
const ALLOWED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'arc://',
  'brave://',
  'edge://',
  'about:',
  'data:',
  'javascript:',
  'moz-extension://',  // Firefox compatibility if ever needed
];

function isUrlAllowed(url) {
  if (!url) return true;
  for (const prefix of ALLOWED_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTNAMES.has(hostname);
  } catch {
    return true; // unparseable URL — allow through
  }
}

// ─── Tab-based Redirect ────────────────────────────────────────────────────────

/**
 * Check a single tab and redirect it to the blocked page if needed.
 * This is the core blocking mechanism — identical in principle to how
 * golldyydev/LeetCodeForcer handles blocking, which works across all
 * Chromium forks (Chrome, Arc, Brave, Edge) without any DNR quirks.
 */
async function evaluateTab(tabId, url) {
  if (isUrlAllowed(url)) return;

  const state = await getState();

  if (!state.leetcodeUsername) return; // not configured yet

  const goalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  const bypassActive =
    state.bypassExpiresAt !== null && Date.now() < state.bypassExpiresAt;

  if (!goalMet && !bypassActive) {
    // Remember what the user was trying to visit so the blocked page can offer a "go back" button
    await chrome.storage.local.set({ lastBlockedUrl: url });
    try {
      await chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL('blocked/blocked.html'),
      });
    } catch {
      // Tab was closed between the check and the update — safe to ignore
    }
  }
}

/**
 * Re-evaluate only the currently focused tab.
 * We intentionally do NOT sweep all open tabs — background tabs should not
 * be silently redirected. The onUpdated/onActivated listeners handle blocking
 * the moment the user actually navigates to or focuses a tab.
 */
async function evaluateBlocking() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id && tab?.url) {
      await evaluateTab(tab.id, tab.url);
    }
  } catch {
    // No focused window (e.g. browser minimised) — nothing to do
  }
}

// ─── Tab Event Listeners ───────────────────────────────────────────────────────

// Fires on every tab navigation change. We wait for status==='complete'
// to avoid duplicate firings caused by iFrame loads (same guard as golldyydev).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url !== undefined) {
    evaluateTab(tabId, tab.url);
  }
});

// Fires when the user switches to a tab or opens a new one.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) evaluateTab(tabId, tab.url);
  } catch {
    // Tab already closed
  }
});

// ─── Daily Alarm ───────────────────────────────────────────────────────────────

async function scheduleDailyResetAlarm() {
  await chrome.alarms.clear(ALARM_DAILY_RESET);
  chrome.alarms.create(ALARM_DAILY_RESET, {
    when: nextUTCMidnight(),
    periodInMinutes: 24 * 60,
  });
}

// ─── Streak Tracking ──────────────────────────────────────────────────────────

/**
 * Call after the goal is newly met for the current UTC day.
 * Increments currentStreak if goal was also met yesterday, otherwise resets to 1.
 * Updates longestStreak if the new streak beats the record.
 */
async function updateStreak() {
  const state = await getState();
  const today = todayUTC();

  // Already updated streak today — don't double-count
  if (state.lastGoalMetDate === today) return;

  const newStreak =
    state.lastGoalMetDate === yesterdayUTC()
      ? state.currentStreak + 1
      : 1;

  const newLongest = Math.max(newStreak, state.longestStreak);

  await setState({
    currentStreak: newStreak,
    longestStreak: newLongest,
    lastGoalMetDate: today,
  });
}

// ─── Notifications ─────────────────────────────────────────────────────────────

async function notifyGoalMet() {
  const state = await getState();
  if (!state.notifyOnComplete) return;

  const streak = state.currentStreak;
  const streakText = streak > 1 ? ` 🔥 ${streak}-day streak!` : '';

  try {
    chrome.notifications.create('goal-met', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'LeetCode Forcer — Goal Met! 🎉',
      message: `You've hit your daily goal.${streakText} Websites unlocked.`,
      priority: 1,
    });
  } catch {
    // Notifications permission may not be granted; fail silently
  }
}

// ─── Goal Met Handler ──────────────────────────────────────────────────────────

/**
 * Checks whether the goal has just been met (was not met before, is now met).
 * If so, updates the streak and fires a notification.
 */
async function checkAndHandleGoalMet(prevState) {
  const state = await getState();

  const wasGoalMet =
    prevState.solvesToday >= prevState.dailyGoal &&
    (!prevState.requireDaily || prevState.dailySolved);

  const isGoalMet =
    state.solvesToday >= state.dailyGoal &&
    (!state.requireDaily || state.dailySolved);

  if (!wasGoalMet && isGoalMet) {
    await updateStreak();
    await notifyGoalMet();
  }
}

// ─── Lazy Poll ─────────────────────────────────────────────────────────────────

/**
 * On startup, if we haven't polled today (UTC), query LeetCode once.
 * Syncs solve count and fetches today's daily challenge metadata.
 */
async function lazyPollIfNeeded() {
  const state = await getState();

  if (!state.leetcodeUsername) return;
  if (state.lastPollDate === todayUTC()) return; // already polled today

  // Fetch daily challenge info (slug + title + link)
  const daily = await fetchDailyChallenge();
  if (daily) {
    await setState({
      dailySlug: daily.slug,
      dailyTitle: daily.title,
      dailyLink: daily.link,
    });
  }

  const updatedState = await getState();
  const { count, slugs, loggedIn } = await fetchTodaySolves(updatedState.leetcodeUsername);

  const dailySolved = updatedState.dailySlug
    ? slugs.includes(updatedState.dailySlug)
    : false;

  await setState({
    solvesToday: count,
    solvedSlugs: slugs,
    lastPollDate: todayUTC(),
    loggedIn,
    ...(updatedState.dailySlug ? { dailySolved } : {}),
  });

  await evaluateBlocking();
}

// ─── Solve Detected (from content script) ─────────────────────────────────────

async function handleSolveDetected({ questionSlug }) {
  const prevState = await getState();

  // Deduplicate: if already counted this slug today, skip
  if (prevState.solvedSlugs.includes(questionSlug)) {
    await evaluateBlocking();
    return;
  }

  const newSlugs = [...prevState.solvedSlugs, questionSlug];
  const newCount = newSlugs.length;

  const dailySolved =
    prevState.requireDaily && prevState.dailySlug === questionSlug
      ? true
      : prevState.dailySolved;

  await setState({
    solvesToday: newCount,
    solvedSlugs: newSlugs,
    dailySolved,
    lastPollDate: todayUTC(),
  });

  await checkAndHandleGoalMet(prevState);
  await evaluateBlocking();
}

// ─── Emergency Bypass ──────────────────────────────────────────────────────────

async function activateBypass() {
  const state = await getState();

  if (state.bypassUsed) {
    return { success: false, reason: 'Already used today' };
  }

  const expiresAt = Date.now() + 3 * 60 * 60 * 1000; // 3 hours
  await setState({ bypassUsed: true, bypassExpiresAt: expiresAt });

  await chrome.alarms.clear(ALARM_BYPASS_EXPIRY);
  chrome.alarms.create(ALARM_BYPASS_EXPIRY, { when: expiresAt });

  // No rule to remove — tab-based blocking re-evaluates on every navigation.
  // Existing blocked-page tabs will detect bypass via their storage poll.

  return { success: true, expiresAt };
}

// ─── Alarm Handler ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_DAILY_RESET) {
    await resetDailyState();
    // Fetch daily challenge for the new UTC day
    const state = await getState();
    if (state.leetcodeUsername) {
      const daily = await fetchDailyChallenge();
      if (daily) {
        await setState({
          dailySlug: daily.slug,
          dailyTitle: daily.title,
          dailyLink: daily.link,
        });
      }
    }
    await evaluateBlocking();
  }

  if (alarm.name === ALARM_BYPASS_EXPIRY) {
    await setState({ bypassExpiresAt: null });
    await evaluateBlocking();
  }
});

// ─── Message Handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SOLVE_DETECTED') {
    handleSolveDetected({ questionSlug: message.questionSlug }).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }

  if (message.type === 'ACTIVATE_BYPASS') {
    activateBypass().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_STATE') {
    getState().then(sendResponse);
    return true;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    evaluateBlocking().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ─── Startup ───────────────────────────────────────────────────────────────────

async function onStartup() {
  await scheduleDailyResetAlarm();
  await lazyPollIfNeeded();
  await evaluateBlocking();
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await setState(state); // writes all defaults if not present
  await onStartup();
});

chrome.runtime.onStartup.addListener(onStartup);
