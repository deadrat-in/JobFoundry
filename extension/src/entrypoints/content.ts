import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendMessage } from '../shared/messaging.ts';
import { getConfig } from '../shared/config.ts';
import { createPassiveObserver } from '../content/passive.js';

export default defineContentScript({
  matches: [
    '*://*.linkedin.com/*',
    '*://*.indeed.com/*',
    '*://*.indeed.co.uk/*',
    '*://*.indeed.ca/*',
    '*://*.indeed.de/*',
    '*://*.indeed.fr/*',
    '*://*.indeed.co.in/*',
    '*://*.glassdoor.com/*',
    '*://*.glassdoor.co.in/*',
    '*://*.glassdoor.co.uk/*',
    '*://*.naukri.com/*',
  ],
  runAt: 'document_idle',
  async main(ctx) {
    const config = await getConfig();
    if (!config.passiveMode) return;

    const observer = createPassiveObserver({
      doc: document,
      win: window,
      onJobsFound: (fresh: any[]) => {
        sendMessage('content:jobsDiscovered', { jobs: fresh }).catch(() => {
          // ignore background disconnection
        });
      },
    });

    observer.start();

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      observer.scan();
    });
  },
});
