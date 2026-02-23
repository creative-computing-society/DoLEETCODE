/**
 * content/detector.js
 * Three-layer detection strategy — all passive, zero extra API calls.
 *
 * Layer 1 (Primary):   Intercept window.fetch — scan every JSON response from
 *                       leetcode.com for status_msg==='Accepted'. No URL filter
 *                       so future endpoint changes don't break detection.
 * Layer 2 (Fallback):  Same treatment for XMLHttpRequest.
 * Layer 3 (Last resort): MutationObserver watching for the "Accepted" verdict
 *                        rendered in the DOM.
 *
 * Any layer that fires sends SOLVE_DETECTED to the service worker.
 * The service worker deduplicates by slug + re-fetches the authoritative count.
 */

(function () {
  'use strict';

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  function extractSlugFromUrl() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function handleAccepted(data) {
    const questionSlug =
      (data && (data.question_slug || data.questionSlug)) ||
      extractSlugFromUrl();
    if (!questionSlug) return;
    try {
      chrome.runtime.sendMessage({ type: 'SOLVE_DETECTED', questionSlug });
    } catch {
      // Extension context may have reloaded — ignore
    }
  }

  /**
   * Try to parse any JSON text and check if it signals an accepted submission.
   * LeetCode polls a check endpoint several times; intermediate responses have
   * status_msg === null. Only the final settled response has 'Accepted'.
   * We do a fast string pre-check to avoid JSON.parse on unrelated responses.
   */
  function tryParseAccepted(text) {
    if (!text || !text.includes('"status_msg"') || !text.includes('Accepted')) return;
    try {
      const data = JSON.parse(text);
      if (data && data.status_msg === 'Accepted') handleAccepted(data);
    } catch {
      // Not JSON
    }
  }

  // ─── Layer 1: window.fetch intercept ────────────────────────────────────────
  // Scan ALL responses on leetcode.com — no URL filtering — so any submission
  // endpoint variant (current or future) is caught automatically.

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      throw err;
    }

    try {
      const ct = response.headers?.get('content-type') ?? '';
      if (ct.includes('application/json') || ct.includes('text/')) {
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

  // Copy static properties and prototype so instanceof checks still work
  Object.defineProperty(PatchedXHR, 'prototype', { value: OriginalXHR.prototype });
  Object.defineProperty(PatchedXHR, 'UNSENT',            { value: OriginalXHR.UNSENT });
  Object.defineProperty(PatchedXHR, 'OPENED',            { value: OriginalXHR.OPENED });
  Object.defineProperty(PatchedXHR, 'HEADERS_RECEIVED',  { value: OriginalXHR.HEADERS_RECEIVED });
  Object.defineProperty(PatchedXHR, 'LOADING',           { value: OriginalXHR.LOADING });
  Object.defineProperty(PatchedXHR, 'DONE',              { value: OriginalXHR.DONE });
  window.XMLHttpRequest = PatchedXHR;

  // ─── Layer 3: MutationObserver DOM watch ─────────────────────────────────────
  // Watches for LeetCode's result panel showing "Accepted".
  // Most resilient to API changes — UI confirmation is the ground truth.

  let domDetectedThisLoad = false;

  // LeetCode resets page content on SPA navigation — also reset our flag
  window.addEventListener('popstate', () => { domDetectedThisLoad = false; });

  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    domDetectedThisLoad = false;
    return origPushState(...args);
  };

  function checkDomForAccepted() {
    if (domDetectedThisLoad) return;

    const selectors = [
      '[data-e2e-locator="submission-result"]',
      '[class*="result-container"] [class*="text-green"]',
      '[class*="status-accepted"]',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && /^\s*accepted\s*$/i.test(el.textContent.trim())) {
          domDetectedThisLoad = true;
          handleAccepted(null);
          return;
        }
      } catch {
        // Selector failed
      }
    }

    // Broader fallback — entire result area must be only the word "Accepted"
    const resultArea = document.querySelector('[class*="result"], [class*="submission"]');
    if (resultArea && /^\s*accepted\s*$/i.test(resultArea.textContent)) {
      domDetectedThisLoad = true;
      handleAccepted(null);
    }
  }

  const observer = new MutationObserver(() => {
    try { checkDomForAccepted(); } catch { /* ignore */ }
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


(function () {
  'use strict';

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  function extractSlugFromUrl() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function isSubmissionCheckUrl(url) {
    return (
      typeof url === 'string' &&
      url.includes('/submissions/detail/') &&
      url.includes('/check/')
    );
  }

  function handleAccepted(data) {
    const questionSlug =
      (data && (data.question_slug || data.questionSlug)) ||
      extractSlugFromUrl();
    if (!questionSlug) return;
    try {
      chrome.runtime.sendMessage({ type: 'SOLVE_DETECTED', questionSlug });
    } catch {
      // Extension context may have reloaded — ignore
    }
  }

  function tryParseAccepted(text) {
    try {
      const data = JSON.parse(text);
      // Only fire on the finalised response. LeetCode's polling loop returns
      // {state:'STARTED'} / {state:'PENDING'} many times before the final
      // {state:'SUCCESS', status_msg:'Accepted'} arrives. We check status_msg
      // directly — it is null/absent on every intermediate response.
      if (data && data.status_msg === 'Accepted') handleAccepted(data);
    } catch {
      // Not JSON
    }
  }

  // ─── Layer 1: window.fetch intercept ────────────────────────────────────────

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      throw err;
    }

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (isSubmissionCheckUrl(url)) {
        response.clone().json().then((data) => {
          if (data && data.status_msg === 'Accepted') handleAccepted(data);
        }).catch(() => {});
      }
    } catch {
      // Never break the page
    }

    return response;
  };

  // ─── Layer 2: XMLHttpRequest intercept ──────────────────────────────────────
  // LeetCode's internal code may use XHR instead of fetch for some requests.

  const OriginalXHR = window.XMLHttpRequest;

  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let capturedUrl = '';

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      capturedUrl = typeof url === 'string' ? url : String(url);
      return origOpen(method, url, ...rest);
    };

    xhr.addEventListener('load', function () {
      try {
        if (isSubmissionCheckUrl(capturedUrl)) {
          tryParseAccepted(xhr.responseText);
        }
      } catch {
        // Ignore
      }
    });

    return xhr;
  }

  // Copy static properties and prototype so instanceof checks still work
  Object.defineProperty(PatchedXHR, 'prototype', { value: OriginalXHR.prototype });
  Object.defineProperty(PatchedXHR, 'UNSENT', { value: OriginalXHR.UNSENT });
  Object.defineProperty(PatchedXHR, 'OPENED', { value: OriginalXHR.OPENED });
  Object.defineProperty(PatchedXHR, 'HEADERS_RECEIVED', { value: OriginalXHR.HEADERS_RECEIVED });
  Object.defineProperty(PatchedXHR, 'LOADING', { value: OriginalXHR.LOADING });
  Object.defineProperty(PatchedXHR, 'DONE', { value: OriginalXHR.DONE });
  window.XMLHttpRequest = PatchedXHR;

  // ─── Layer 3: MutationObserver DOM watch ─────────────────────────────────────
  // Watches for LeetCode's result panel showing "Accepted".
  // Most resilient to API changes — UI confirmation is the ground truth.

  let domDetectedThisLoad = false;

  // LeetCode resets page content on navigation — also reset our flag
  window.addEventListener('popstate', () => { domDetectedThisLoad = false; });
  window.addEventListener('pushstate', () => { domDetectedThisLoad = false; });

  // Intercept history.pushState to catch SPA navigation
  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    domDetectedThisLoad = false;
    return origPushState(...args);
  };

  function checkDomForAccepted() {
    if (domDetectedThisLoad) return;

    // LeetCode uses several patterns across its versions — we check multiple selectors
    const selectors = [
      '[data-e2e-locator="submission-result"]',
      '[class*="result-container"] [class*="text-green"]',
      '[class*="status-accepted"]',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        // Must be exactly "Accepted" — partial matches like "14/15 testcases accepted" are failed submissions
        if (el && /^\s*accepted\s*$/i.test(el.textContent.trim())) {
          domDetectedThisLoad = true;
          handleAccepted(null);
          return;
        }
      } catch {
        // Selector failed
      }
    }

    // Broader text search as an absolute last resort.
    // No 'm' multiline flag — the ENTIRE text content block must consist of only
    // the word "Accepted" (plus whitespace). This prevents partial matches like
    // "14 / 15 testcases accepted" on failed submissions from triggering a count.
    const resultArea = document.querySelector('[class*="result"], [class*="submission"]');
    if (resultArea) {
      const isAccepted = /^\s*accepted\s*$/i.test(resultArea.textContent);
      if (isAccepted) {
        domDetectedThisLoad = true;
        handleAccepted(null);
      }
    }
  }

  const observer = new MutationObserver(() => {
    try {
      checkDomForAccepted();
    } catch {
      // Ignore observer errors
    }
  });

  // Start observing once the body is available
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
