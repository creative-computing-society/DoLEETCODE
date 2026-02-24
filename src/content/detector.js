/**
 * content/detector.js
 * Runs in the ISOLATED world (default for content scripts).
 *
 * Two responsibilities:
 *
 * 1. Bridge: Listen for postMessage events from content/injected.js (MAIN
 *    world). When an accepted solve is signalled, forward it to the service
 *    worker via chrome.runtime.sendMessage.
 *
 * 2. DOM fallback: MutationObserver watching LeetCode's result element for
 *    the "Accepted" verdict. Catches edge cases where the network layers miss
 *    (e.g. cached responses, GraphQL subscriptions).
 */

(function () {
  'use strict';

  const MSG_TYPE = 'LEETCODE_FORCER_SOLVE_DETECTED';

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function extractSlugFromUrl() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function sendSolveDetected(questionSlug) {
    if (!questionSlug) return;
    try {
      chrome.runtime.sendMessage({ type: 'SOLVE_DETECTED', questionSlug });
    } catch {
      // Extension context invalidated (e.g. reload during session) — ignore
    }
  }

  // ─── Bridge: postMessage from injected.js (MAIN world) ──────────────────────

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== MSG_TYPE) return;
    const { questionSlug } = event.data;
    sendSolveDetected(questionSlug || extractSlugFromUrl());
  });

  // ─── Layer 3: MutationObserver DOM fallback ──────────────────────────────────
  // Watches LeetCode's result panel. Fires when the visible text settles on
  // "Accepted" — useful when the network layers are bypassed (e.g. WebSocket
  // push updates the UI without a standard fetch/XHR response body).

  let domDetectedThisPage = false;

  // Reset flag on SPA navigation so each problem submission gets a fresh check
  window.addEventListener('popstate', () => { domDetectedThisPage = false; });

  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    domDetectedThisPage = false;
    return origPushState(...args);
  };

  function checkDomForAccepted() {
    if (domDetectedThisPage) return;

    // LeetCode has used several class/attribute patterns over the years.
    // We check the most specific selectors first.
    const selectors = [
      '[data-e2e-locator="submission-result"]',
      '[class*="result-container"] [class*="text-green"]',
      '[class*="status-accepted"]',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && /^\s*accepted\s*$/i.test(el.textContent.trim())) {
          domDetectedThisPage = true;
          sendSolveDetected(extractSlugFromUrl());
          return;
        }
      } catch {
        // Selector may not be valid in all DOM states
      }
    }

    // Looser fallback: scan deeper result/submission containers.
    // Still require the element's text to be only "Accepted" so we don't
    // fire on "14 / 15 testcases accepted" from a failed run.
    const containers = document.querySelectorAll(
      '[class*="result"], [class*="submission-result"]'
    );
    for (const el of containers) {
      if (/^\s*accepted\s*$/i.test(el.textContent.trim())) {
        domDetectedThisPage = true;
        sendSolveDetected(extractSlugFromUrl());
        return;
      }
    }
  }

  const observer = new MutationObserver(() => {
    try {
      checkDomForAccepted();
    } catch {
      // Never let observer errors surface to the page
    }
  });

  function startObserver() {
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver);
  }

})();
