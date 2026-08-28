import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: (env) => ({
    name: 'JobFoundry',
    description: 'Capture job postings in your browser and push them to your JobFoundry server.',
    version: '0.1.0',
    permissions: [
      'storage',
      'alarms',
      'activeTab',
      'scripting',
      ...(env.browser === 'firefox' ? [] : ['sidePanel']),
    ],
    commands: {
      ...(env.browser === 'firefox'
        ? {
            _execute_sidebar_action: {
              suggested_key: {
                default: 'Ctrl+Shift+S',
                mac: 'Command+Shift+S',
              },
              description: 'Open Side Panel',
            },
          }
        : {
            'open-side-panel': {
              suggested_key: {
                default: 'Ctrl+Shift+S',
                mac: 'Command+Shift+S',
              },
              description: 'Open Side Panel',
            },
          }),
    },
    host_permissions: [
      '<all_urls>',
    ],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: 'jobfoundry@covai.org',
        strict_min_version: '109.0',
      },
    },
  }),
});
