import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  zip: {
    artifactTemplate: '{{name}}-{{browser}}{{modeSuffix}}.zip',
    sourcesTemplate: '{{name}}-sources{{modeSuffix}}.zip',
  },
  manifest: (env) => ({
    name: 'JobFoundry',
    description: 'Capture job postings in your browser and push them to your JobFoundry server.',
    version: '0.1.0',
    permissions: [
      'storage',
      'alarms',
      'activeTab',
      'scripting',
      'tabs',
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
    host_permissions: ['<all_urls>'],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: 'jobfoundry@covai.org',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {
        strict_min_version: '142.0',
      },
    },
  }),
});
