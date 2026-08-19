import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/.venv/**',
      // Vendored career-ops provider layer (MIT): files are byte-identical to
      // upstream so `sync:providers` content hashes stay stable. Upstream
      // carries its own lint noise (unused vars, irregular whitespace); do not
      // "fix" them here or the drift check will flag every vendored file.
      'extension/src/background/providers/**',
      'extension/scripts/ports/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
