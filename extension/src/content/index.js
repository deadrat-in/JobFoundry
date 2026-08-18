/**
 * index.js — Main content script entry point.
 */

import { createPassiveObserver } from './passive.js';
import { runActiveCrawl } from './active.js';
import { detectPlatform } from './extractors/index.js';

export function initContentScript({
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (!doc || !win) return null;

  const platform = detectPlatform(win.location?.hostname);
  if (!platform) return null;

  // Start passive observer
  const observer = createPassiveObserver({ doc, win });
  observer.start();

  const handleMessage = (message, sender, sendResponse) => {
    if (message?.type === 'content:startActiveCrawl') {
      runActiveCrawl({
        doc,
        maxPages: message.maxPages || 3,
        onJobs: (jobs) => {
          win.chrome?.runtime?.sendMessage?.({
            type: 'content:jobsDiscovered',
            jobs,
          });
        },
      })
        .then((result) => sendResponse?.({ ok: true, result }))
        .catch((err) => sendResponse?.({ ok: false, error: err.message }));
      return true; // async response
    }
    return undefined;
  };

  if (win.chrome?.runtime?.onMessage) {
    win.chrome.runtime.onMessage.addListener(handleMessage);
  } else if (win.browser?.runtime?.onMessage) {
    win.browser.runtime.onMessage.addListener(handleMessage);
  }

  return {
    observer,
    dispose() {
      observer.stop();
      if (win.chrome?.runtime?.onMessage) {
        win.chrome.runtime.onMessage.removeListener(handleMessage);
      } else if (win.browser?.runtime?.onMessage) {
        win.browser.runtime.onMessage.removeListener(handleMessage);
      }
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initContentScript({ doc: document, win: window });
}
