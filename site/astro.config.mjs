import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  outDir: '../docs',
  base: process.env.ASTRO_BASE || '/',
  build: {
    format: 'directory'
  }
});
