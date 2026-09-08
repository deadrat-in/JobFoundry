/**
 * mjs-files.mjs — helper definitions for file walking and nested checkout detection.
 * Ported from career-ops/lib/mjs-files.mjs.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'output',
  'data',
  'coverage',
  'test-results',
]);

/**
 * Is `dir` a checkout of its own, rather than a subdirectory of this one?
 *
 * @param {string} dir - Absolute path to a directory found below the walk root.
 * @returns {boolean} True if `dir` carries its own git marker.
 */
export function isNestedCheckout(dir) {
  return existsSync(join(dir, '.git'));
}

/**
 * Does `relPath` sit inside a nested checkout below `root`?
 *
 * @param {string} root - Absolute directory the paths are relative to.
 * @param {string} relPath - Path relative to `root`, `/` or platform separated.
 * @returns {boolean} True if any ancestor below `root` carries a git marker.
 */
export function isUnderNestedCheckout(root, relPath) {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    if (isNestedCheckout(dir)) return true;
  }
  return false;
}

/**
 * Every `.mjs` file under `root`, recursively, sorted by full path.
 *
 * @param {string} root - Absolute path to walk.
 * @returns {string[]} Absolute paths, lexicographically sorted.
 */
export function collectMjsFiles(root) {
  const files = [];
  const walk = (dir, isRoot) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'ENOENT' && !isRoot) return;
      throw err;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isNestedCheckout(full)) continue;
        walk(full, false);
      } else if (entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(root, true);
  return files.sort();
}
