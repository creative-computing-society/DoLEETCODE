/**
 * content/detector.js
 * Three-layer detection strategy — all passive, zero extra API calls.
 *
 * Layer 1 (Primary):   Intercept window.fetch calls to LeetCode's submission-check endpoint.
 * Layer 2 (Fallback):  Intercept XMLHttpRequest for the same endpoint (LeetCode uses both).
 * Layer 3 (Last resort): MutationObserver watching for the "Accepted" result in the DOM.
 *
 * Any layer that fires sends SOLVE_DETECTED to the service worker.
 * The service worker deduplicates by slug, so double-firing is safe.
 */

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

    // Broader text search as an absolute last resort — still require exact match
    const resultArea = document.querySelector('[class*="result"], [class*="submission"]');
    if (resultArea) {
      const isAccepted = /^\s*accepted\s*$/im.test(resultArea.textContent);
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
