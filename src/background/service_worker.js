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

const ALARM_DAILY_RESET   = 'dailyReset';
const ALARM_BYPASS_EXPIRY = 'bypassExpiry';
/**
 * Fires ~45 s after the last SOLVE_DETECTED to do one authoritative API sync.
 * Using an alarm (not setTimeout) means the check survives service-worker sleep.
 * It is always recreated on every detection, so rapid back-to-back submits
 * collapse into a single network request.
 */
const ALARM_VERIFY_SOLVE  = 'verifyAfterSolve';

/**
 * Minimum milliseconds between any two LeetCode API calls.
 * Prevents hammering the API on rapid service-worker wakes, power-cycling,
 * or repeated force-sync button presses.
 * 5 minutes is generous — LeetCode's own site polls far more often.
 */
const MIN_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Returns true if enough time has passed since the last API call. */
async function canPollNow() {
  const { lastPollTimestamp = 0 } = await chrome.storage.local.get('lastPollTimestamp');
  return Date.now() - lastPollTimestamp >= MIN_POLL_INTERVAL_MS;
}

async function stampPollTime() {
  await chrome.storage.local.set({ lastPollTimestamp: Date.now() });
}

// ─── URL Whitelist ─────────────────────────────────────────────────────────────

/**
 * Hostnames that are always allowed through.
 * Includes LeetCode itself, Google SSO, and popular DSA reference/study sites.
 */
const ALLOWED_HOSTNAMES = new Set([
  // LeetCode + auth
  'leetcode.com',
  'accounts.google.com',

  // Popular DSA study / problem-list sites
  'neetcode.io',              // NeetCode (problem lists, solutions)
  'takeuforward.org',         // Striver's A2Z / SDE Sheet
  'geeksforgeeks.org',        // GFG articles and problem explanations
  'cp-algorithms.com',        // Competitive programming algorithms reference
  'codeforces.com',           // CP contest platform often used alongside LC
  'interviewbit.com',         // Interview prep problems
  'algo.monster',             // Algo Monster pattern guide
  'lintcode.com',             // Alternative problem bank
  'codingninjas.com',         // Coding Ninjas DSA courses
  'algoexpert.io',            // AlgoExpert
  'interviewing.io',          // Mock interviews
  'hackerrank.com',           // HackerRank
  'github.com',               // Solution repos, study guides
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
    let { hostname } = new URL(url);
    // Strip leading www. so both www.geeksforgeeks.org and geeksforgeeks.org match
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
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
 * On startup — and whenever settings change — sync solve count + daily challenge.
 * Gated by two conditions:
 *   a) Never polled today (UTC date changed) — hard gate, always runs on new day.
 *   b) MIN_POLL_INTERVAL_MS has passed — prevents bursts within a session.
 * Returns immediately (no-op) if either gate blocks, so it’s safe to call often.
 */
async function lazyPollIfNeeded() {
  const state = await getState();
  if (!state.leetcodeUsername) return;

  const newDay = state.lastPollDate !== todayUTC();
  const cooldownPassed = await canPollNow();

  // Skip only if we’ve already polled today AND the cooldown hasn’t expired.
  // On a new UTC day, always poll regardless of cooldown.
  if (!newDay && !cooldownPassed) return;

  await stampPollTime(); // stamp immediately to block concurrent wakes

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

/**
 * Called by the content script whenever it sees status_msg==='Accepted'.
 *
 * Strategy — zero extra API calls per submit:
 *  1. Deduplicate by slug (layers 1+2 can both fire for the same submission).
 *  2. Increment local counter immediately — instant UI update, no network.
 *  3. Schedule ALARM_VERIFY_SOLVE to fire ~45 s from now (debounced).
 *     Rapid back-to-back solves just push the alarm forward — collapses to
 *     ONE API call regardless of how many problems were submitted quickly.
 */
async function handleSolveDetected({ questionSlug }) {
  const prevState = await getState();

  if (!prevState.solvedSlugs.includes(questionSlug)) {
    const newSlugs = [...prevState.solvedSlugs, questionSlug];
    const dailySolved =
      prevState.requireDaily && prevState.dailySlug === questionSlug
        ? true
        : prevState.dailySolved;
    await setState({
      solvesToday: newSlugs.length,
      solvedSlugs: newSlugs,
      dailySolved,
    });
    await checkAndHandleGoalMet(prevState);
  }

  await evaluateBlocking();

  // Debounced accuracy check — (re)set alarm to 45 s from now.
  await chrome.alarms.clear(ALARM_VERIFY_SOLVE);
  chrome.alarms.create(ALARM_VERIFY_SOLVE, { delayInMinutes: 0.75 }); // ~45 s
}

/**
 * Triggered by ALARM_VERIFY_SOLVE ~45 s after the last detected solve.
 * Makes ONE authoritative API call to reconcile the local counter with
 * LeetCode's truth. Merges rather than overwrites to handle the case where
 * the submission was so recent that LeetCode's API hasn't indexed it yet.
 */
async function verifySolveCount() {
  const state = await getState();
  if (!state.leetcodeUsername) return;
  if (!(await canPollNow())) return; // respect rate limit even for verify alarm
  try {
    await stampPollTime();
    const { count, slugs, loggedIn } = await fetchTodaySolves(state.leetcodeUsername);
    if (!loggedIn) return;
    const mergedSet   = new Set([...slugs, ...state.solvedSlugs]);
    const mergedSlugs = [...mergedSet];
    const trueCount   = Math.max(count, mergedSlugs.length);
    const dailySolved = state.dailySlug ? mergedSet.has(state.dailySlug) : state.dailySolved;
    await setState({
      solvesToday:  trueCount,
      solvedSlugs:  mergedSlugs,
      lastPollDate: todayUTC(),
      loggedIn:     true,
      dailySolved,
    });
    await evaluateBlocking();
  } catch {
    // Network offline — local counter stands until next sync
  }
}

// ─── Force Sync (triggered by popup Sync button) ──────────────────────────────

async function forceSync() {
  const state = await getState();
  if (!state.leetcodeUsername) return;

  // For explicit user-triggered syncs, use a short 10-second dedup window only
  // (prevents double-fire if the service worker happens to wake twice). The
  // 5-minute MIN_POLL_INTERVAL only applies to background auto-polls.
  const { lastPollTimestamp = 0 } = await chrome.storage.local.get('lastPollTimestamp');
  if (Date.now() - lastPollTimestamp < 10_000) return;
  await stampPollTime();

  const daily = await fetchDailyChallenge();
  if (daily) {
    await setState({ dailySlug: daily.slug, dailyTitle: daily.title, dailyLink: daily.link });
  }

  const updated = await getState();
  const { count, slugs, loggedIn } = await fetchTodaySolves(updated.leetcodeUsername);
  if (loggedIn) {
    const dailySolved = updated.dailySlug ? slugs.includes(updated.dailySlug) : false;
    await setState({
      solvesToday: count,
      solvedSlugs: slugs,
      lastPollDate: todayUTC(),
      loggedIn: true,
      dailySolved,
    });
  }
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
  if (alarm.name === ALARM_VERIFY_SOLVE) {
    await verifySolveCount();
  }

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
    // Read state once, respond immediately, then kick background poll if stale.
    // lazyPollIfNeeded is rate-gated so this never spams the API.
    getState().then(s => {
      sendResponse(s);
      if (s.leetcodeUsername) lazyPollIfNeeded();
    });
    return true;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    // Settings changed (e.g. username just entered for the first time).
    // Clear lastPollTimestamp so the next lazyPollIfNeeded runs immediately,
    // giving the user an instant solve-count on first setup.
    chrome.storage.local.set({ lastPollTimestamp: 0 }).then(() => {
      return lazyPollIfNeeded();
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'FORCE_SYNC') {
    forceSync().then(() => sendResponse({ ok: true }));
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
