import { defineConfig } from 'astro/config';

// https://astro.build/config
// Build output goes to the default `dist/` (gitignored) and is deployed to
// GitHub Pages as a workflow artifact — see .github/workflows/pages.yml.
// `base` carries the Pages subpath when ASTRO_BASE is set in CI
// (e.g. /JobFoundry/); local preview defaults to '/'.
export default defineConfig({
  output: 'static',
  base: process.env.ASTRO_BASE || '/',
  build: {
    format: 'directory',
  },
});
