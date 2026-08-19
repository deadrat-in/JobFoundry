import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'JobFoundry',
    description: 'Capture job postings in your browser and push them to your JobFoundry server.',
    version: '0.1.0',
    permissions: ['storage', 'alarms'],
    host_permissions: [
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
    browser_specific_settings: {
      gecko: {
        id: 'jobfoundry@covai.org',
        strict_min_version: '109.0',
      },
    },
  },
});
