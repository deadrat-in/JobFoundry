/**
 * passive.js — Passive DOM observer that monitors job board interactions.
 * Debounces mutations and URL shifts, extracts newly rendered jobs,
 * and reports them to the background worker.
 */

import { extractJobsFromDocument } from './extractors/index.js';

export function createPassiveObserver({
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  onJobsFound = null,
  debounceMs = 300,
} = {}) {
  if (!doc) throw new Error('document is required for passive observer');

  let timer = null;
  let observer = null;
  const seenUrls = new Set();

  const notify = (jobs) => {
    if (!jobs || jobs.length === 0) return;
    const fresh = jobs.filter((j) => j && j.url && !seenUrls.has(j.url));
    if (fresh.length === 0) return;

    for (const j of fresh) {
      seenUrls.add(j.url);
    }

    if (typeof onJobsFound === 'function') {
      onJobsFound(fresh);
    } else if (win?.chrome?.runtime?.sendMessage) {
      win.chrome.runtime.sendMessage({
        type: 'content:jobsDiscovered',
        jobs: fresh,
      });
    } else if (win?.browser?.runtime?.sendMessage) {
      win.browser.runtime.sendMessage({
        type: 'content:jobsDiscovered',
        jobs: fresh,
      });
    }
  };

  const scan = () => {
    try {
      const jobs = extractJobsFromDocument(doc);
      notify(jobs);
    } catch {
      // Ignore DOM reading errors during page transitions
    }
  };

  const scheduleScan = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, debounceMs);
  };

  const start = () => {
    // Initial scan on load
    scan();

    // Attach MutationObserver if available
    const MutationObs = win?.MutationObserver || globalThis.MutationObserver;
    if (MutationObs && doc.body) {
      observer = new MutationObs(() => {
        scheduleScan();
      });
      observer.observe(doc.body, {
        childList: true,
        subtree: true,
      });
    }

    // Attach URL navigation listeners for SPAs
    if (win) {
      win.addEventListener?.('popstate', scheduleScan);
      win.addEventListener?.('hashchange', scheduleScan);
    }
  };

  const stop = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (win) {
      win.removeEventListener?.('popstate', scheduleScan);
      win.removeEventListener?.('hashchange', scheduleScan);
    }
  };

  return {
    start,
    stop,
    scan,
    getSeenUrls: () => Array.from(seenUrls),
  };
}
