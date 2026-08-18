import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT = resolve(import.meta.dirname, '.');
const DIST = resolve(EXT, 'dist');
const TARGETS = ['chrome', 'firefox'];

// The static provider registry must exist before bundling (see _registry.mjs).
await import('./scripts/gen-provider-index.mjs');

const entryPoints = {
  background: 'src/background/index.js',
  popup: 'src/popup/index.js',
  content: 'src/content/index.js',
};

const staticFiles = [
  { from: 'src/popup/index.html', to: 'popup.html' },
  { from: 'src/popup/popup.css', to: 'popup.css' },
];

rmSync(DIST, { recursive: true, force: true });

for (const target of TARGETS) {
  const outdir = resolve(DIST, target);
  mkdirSync(outdir, { recursive: true });

  for (const [name, entry] of Object.entries(entryPoints)) {
    await build({
      entryPoints: [resolve(EXT, entry)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['es2020'],
      outfile: resolve(outdir, `${name}.js`),
      sourcemap: false,
      logLevel: 'warning',
    });
  }

  for (const { from, to } of staticFiles) {
    copyFileSync(resolve(EXT, from), resolve(outdir, to));
  }

  const manifest = JSON.parse(readFileSync(resolve(EXT, `manifest.${target}.json`), 'utf8'));
  writeFileSync(resolve(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`built dist/${target}/`);
}

const isRelease = process.argv.includes('--release');
if (isRelease) {
  const webExtModule = await import('web-ext');
  const webExt = webExtModule.default || webExtModule;
  const releaseDir = resolve(DIST, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const buildResult = await webExt.cmd.build({
    sourceDir: resolve(DIST, 'firefox'),
    artifactsDir: releaseDir,
    overwriteDest: true,
  });
  if (buildResult?.extensionPath) {
    const xpiTarget = resolve(DIST, 'firefox.xpi');
    copyFileSync(buildResult.extensionPath, xpiTarget);
    console.log(`built release package: ${xpiTarget} (${buildResult.extensionPath})`);
  }
}
