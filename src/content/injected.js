/**
 * content/injected.js
 * Runs in the MAIN world ("world": "MAIN" in manifest).
 *
 * This is the only way to intercept LeetCode's own fetch/XHR calls —
 * content scripts in the ISOLATED world get a separate copy of window,
 * so patching window.fetch there never affects the page's real requests.
 *
 * When an accepted submission is detected, fire a postMessage that
 * content/detector.js (isolated world) picks up and forwards to the
 * service worker via chrome.runtime.sendMessage.
 *
 * No chrome.* APIs are available here.
 */
(function () {
  'use strict';

  const MSG_TYPE = 'LEETCODE_FORCER_SOLVE_DETECTED';

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function extractSlugFromUrl() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function handleAccepted(data) {
    const questionSlug =
      (data && (data.question_slug || data.questionSlug)) ||
      extractSlugFromUrl();
    if (!questionSlug) return;
    // postMessage bridges to the isolated-world detector.js
    window.postMessage({ type: MSG_TYPE, questionSlug }, '*');
  }

  /**
   * Fast pre-check then JSON.parse.
   * LeetCode's polling endpoint returns status_msg === null on intermediate
   * responses. We only fire on the final 'Accepted' value.
   */
  function tryParseAccepted(text) {
    if (!text || !text.includes('"status_msg"')) return;
    try {
      const data = JSON.parse(text);
      if (data && data.status_msg === 'Accepted') handleAccepted(data);
    } catch {
      // Not JSON — ignore
    }
  }

  // ─── Layer 1: window.fetch intercept ────────────────────────────────────────
  // No URL filtering — any future submission endpoint change is automatically
  // covered. The fast string pre-check keeps overhead negligible.

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      throw err;
    }

    try {
      // Skip non-LeetCode requests early
      const url = args[0] instanceof Request ? args[0].url
        : typeof args[0] === 'string' ? args[0] : '';
      if (url && url.includes('leetcode.com')) {
        response.clone().text().then(tryParseAccepted).catch(() => {});
      } else if (!url) {
        // Relative URL — always on leetcode.com, check it
        response.clone().text().then(tryParseAccepted).catch(() => {});
      }
    } catch {
      // Never break the page
    }

    return response;
  };

  // ─── Layer 2: XMLHttpRequest intercept ──────────────────────────────────────

  const OriginalXHR = window.XMLHttpRequest;

  function PatchedXHR() {
    const xhr = new OriginalXHR();

    xhr.addEventListener('load', function () {
      try {
        tryParseAccepted(xhr.responseText);
      } catch {
        // Ignore
      }
    });

    return xhr;
  }

  // Preserve prototype chain so instanceof and static props still work
  Object.defineProperty(PatchedXHR, 'prototype',         { value: OriginalXHR.prototype });
  Object.defineProperty(PatchedXHR, 'UNSENT',            { value: OriginalXHR.UNSENT });
  Object.defineProperty(PatchedXHR, 'OPENED',            { value: OriginalXHR.OPENED });
  Object.defineProperty(PatchedXHR, 'HEADERS_RECEIVED',  { value: OriginalXHR.HEADERS_RECEIVED });
  Object.defineProperty(PatchedXHR, 'LOADING',           { value: OriginalXHR.LOADING });
  Object.defineProperty(PatchedXHR, 'DONE',              { value: OriginalXHR.DONE });
  window.XMLHttpRequest = PatchedXHR;

})();
