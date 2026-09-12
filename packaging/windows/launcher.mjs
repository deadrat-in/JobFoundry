#!/usr/bin/env node
// ==============================================================================
// JobFoundry - Windows launcher (process manager)
// Node port of packaging/launcher.sh for the MSIX package.
//
// Started by the JobFoundry.exe shim (FullTrust MSIX app). Starts the three
// localhost services (tailor, scorer, ingest), opens the browser, and keeps
// running until a service exits or the user stops the app.
//
// Data lives OUTSIDE the read-only MSIX payload in %LOCALAPPDATA%\JobFoundry
// (mirrors the Linux XDG layout). API keys go in $DATA_DIR\.env.
//
// NOTE: Windows force-terminates the app on console close without warning;
// child services can be orphaned. Use jobfoundry.ps1 stop for clean shutdown.
// ==============================================================================

import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

// ------------------------------------------------------------------------------
// 1. Locate package root (JobFoundry.exe sits at the package root)
// ------------------------------------------------------------------------------
// This script ships at <root>\usr\share\jobfoundry\windows\launcher.mjs, so the
// package root is four directories up from the script dir (NOT the node.exe dir).
const PKG_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

const NODE_BIN = path.join(PKG_ROOT, 'usr', 'lib', 'node', 'node.exe');
const PYTHON_BIN = path.join(PKG_ROOT, 'usr', 'lib', 'python', 'python.exe');
const CHROME_BIN = path.join(
  PKG_ROOT,
  'usr',
  'lib',
  'chrome-headless-shell',
  'chrome-headless-shell.exe'
);

const APP_SRC = path.join(PKG_ROOT, 'usr', 'share', 'jobfoundry');
const SITE_PACKAGES = path.join(PKG_ROOT, 'usr', 'lib', 'python', 'Lib', 'site-packages');

// ------------------------------------------------------------------------------
// 2. Data directory (%LOCALAPPDATA%\JobFoundry)
// ------------------------------------------------------------------------------
const DATA_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'),
  'JobFoundry'
);
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const RUNTIME_DIR = path.join(DATA_DIR, 'run');

for (const dir of [
  path.join(DATA_DIR, 'artifacts'),
  path.join(DATA_DIR, 'themes', 'node_modules'),
  LOGS_DIR,
  RUNTIME_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'jobfoundry.db');
const MASTER_RESUME_PATH = path.join(DATA_DIR, 'master-resume.json');

// ------------------------------------------------------------------------------
// 3. Verify bundled binaries exist
// ------------------------------------------------------------------------------
for (const bin of [NODE_BIN, PYTHON_BIN, CHROME_BIN]) {
  if (!fs.existsSync(bin)) {
    console.error(`[jobfoundry] ERROR: required binary not found: ${bin}`);
    process.exit(1);
  }
}
fs.accessSync(NODE_BIN, fs.constants.X_OK);

// ------------------------------------------------------------------------------
// 4. Environment setup
// ------------------------------------------------------------------------------
const env = { ...process.env };

env.NODE_PATH = [
  path.join(DATA_DIR, 'themes', 'node_modules'),
  path.join(APP_SRC, 'node_modules'),
  path.join(APP_SRC, 'node-tools', 'node_modules'),
].join(process.platform === 'win32' ? ';' : ':');
env.PYTHONPATH = [path.join(APP_SRC, 'server', 'scorer'), SITE_PACKAGES].join(';');
env.PUPPETEER_EXECUTABLE_PATH = CHROME_BIN;
env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';

// Ports (all bound on localhost).
const TAILOR_PORT = 8081;
const SCORER_PORT = 8001;
const INGEST_PORT = 8080;

// Load user .env (API keys, model overrides, custom base URLs).
const ENV_FILE = path.join(DATA_DIR, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !(key in env)) env[key] = value;
  }
}

env.SCORER_MODEL = env.SCORER_MODEL || 'openrouter/google/gemini-2.0-flash-exp:free';
env.SCORER_PROVIDER = env.SCORER_PROVIDER || 'openrouter';
env.SCORER_THRESHOLD = env.SCORER_THRESHOLD || '75';
env.TAILOR_MODEL = env.TAILOR_MODEL || 'openrouter/google/gemini-2.0-flash-exp:free';
env.TAILOR_TIMEOUT_SECONDS = env.TAILOR_TIMEOUT_SECONDS || '900';
env.TAILOR_TIMEOUT_MS = env.TAILOR_TIMEOUT_MS || '1800000';
env.LLM_RATE_LIMIT_REQUESTS = env.LLM_RATE_LIMIT_REQUESTS || '20';
env.LLM_RATE_LIMIT_PERIOD = env.LLM_RATE_LIMIT_PERIOD || '60';
env.LLM_MAX_RETRIES = env.LLM_MAX_RETRIES || '25';
env.LLM_RETRY_MIN_WAIT_SECONDS = env.LLM_RETRY_MIN_WAIT_SECONDS || '5';
env.LLM_RETRY_MAX_WAIT_SECONDS = env.LLM_RETRY_MAX_WAIT_SECONDS || '120';
env.LLM_RETRY_MULTIPLIER = env.LLM_RETRY_MULTIPLIER || '3';
env.LLM_REQUEST_TIMEOUT = env.LLM_REQUEST_TIMEOUT || '600';
env.HOST = env.HOST || '127.0.0.1';
env.API_KEYS = env.API_KEYS || '';

// ------------------------------------------------------------------------------
// 5. PID tracking and helpers
// ------------------------------------------------------------------------------
const children = new Map();

function writePidfile(name, pid) {
  fs.writeFileSync(path.join(RUNTIME_DIR, `${name}.pid`), String(pid), 'utf8');
}

function removePidfile(name) {
  fs.rmSync(path.join(RUNTIME_DIR, `${name}.pid`), { force: true });
}

function timestamp() {
  return new Date().toISOString();
}

function logLine(name, line) {
  const text = `${timestamp()} ${line}`;
  try {
    fs.appendFileSync(path.join(LOGS_DIR, `${name}.log`), `${text}\r\n`, 'utf8');
  } catch {
    // Logging is best-effort.
  }
}

function startService(name, exe, args, envOverrides, logStream) {
  const child = spawn(exe, args, {
    env: { ...env, ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  children.set(name, child);
  writePidfile(name, child.pid);
  logLine(name, `[jobfoundry] spawned pid ${child.pid}`);
  child.on('exit', (code, signal) => {
    logLine(name, `[jobfoundry] exited code=${code} signal=${signal}`);
    removePidfile(name);
    children.delete(name);
    if (code !== null || signal !== null) {
      if (name !== 'launcher') shutdown(`service ${name} exited`, 1);
    }
  });
  return child;
}

function waitForPort(name, port, maxWaitSeconds) {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  console.log(`[jobfoundry] Waiting for ${name} on port ${port}...`);
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        console.log(`[jobfoundry] ${name} ready`);
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`${name} failed to start within ${maxWaitSeconds}s`));
        } else {
          setTimeout(attempt, 1000);
        }
      });
    };
    attempt();
  });
}

const openLogStream = (name) =>
  fs.createWriteStream(path.join(LOGS_DIR, `${name}.log`), { flags: 'a' });

// ------------------------------------------------------------------------------
// 6. Start services in dependency order
// ------------------------------------------------------------------------------
console.log('[jobfoundry] Starting services...');
writePidfile('launcher', process.pid);
logLine('launcher', '[jobfoundry] launcher starting');

startService(
  'tailor',
  PYTHON_BIN,
  ['-m', 'resume_ops_api'],
  {
    PORT: String(TAILOR_PORT),
    MASTER_RESUME_PATH,
    DEFAULT_MODEL: env.TAILOR_MODEL,
    LLM_MAX_CONCURRENCY: '1',
  },
  openLogStream('tailor')
);
startService(
  'scorer',
  PYTHON_BIN,
  ['-m', 'src.main'],
  {
    PORT: String(SCORER_PORT),
    HOST: env.HOST,
    DB_PATH,
    ARTIFACTS_DIR: path.join(DATA_DIR, 'artifacts'),
    SCORER_MODEL: env.SCORER_MODEL,
    SCORER_PROVIDER: env.SCORER_PROVIDER,
    SCORER_THRESHOLD: env.SCORER_THRESHOLD,
    TAILOR_PORT: String(TAILOR_PORT),
    TAILOR_TIMEOUT_SECONDS: env.TAILOR_TIMEOUT_SECONDS,
  },
  openLogStream('scorer')
);
startService(
  'ingest',
  NODE_BIN,
  [path.join(APP_SRC, 'server', 'ingest', 'src', 'index.mjs')],
  {
    PORT: String(INGEST_PORT),
    DB_PATH,
    ARTIFACTS_DIR: path.join(DATA_DIR, 'artifacts'),
    STATIC_DIR: path.join(APP_SRC, 'web', 'dist'),
    API_KEYS: env.API_KEYS,
    TAILOR_PORT: String(TAILOR_PORT),
    TAILOR_TIMEOUT_MS: env.TAILOR_TIMEOUT_MS,
  },
  openLogStream('ingest')
);

let shuttingDown = false;

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[jobfoundry] Shutting down services (${reason})...`);
  for (const [name, child] of children) {
    if (child.pid) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    logLine(name, '[jobfoundry] requested shutdown');
    removePidfile(name);
  }
  const deadline = Date.now() + 5000;
  const poll = setInterval(() => {
    const alive = [...children.values()].some((c) => c.exitCode === null && !c.killed);
    if (!alive || Date.now() >= deadline) {
      clearInterval(poll);
      for (const child of children.values()) {
        if (child.exitCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }
      removePidfile('launcher');
      console.log('[jobfoundry] All services stopped.');
      process.exit(exitCode);
    }
  }, 200);
}

// Ctrl+C / console-close best effort; on Windows a hard terminate may bypass this.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(`received ${signal}`));
}

async function main() {
  try {
    await Promise.all([
      waitForPort('tailor', TAILOR_PORT, 60),
      waitForPort('scorer', SCORER_PORT, 60),
    ]);
    await waitForPort('ingest', INGEST_PORT, 60);

    console.log('');
    console.log('[jobfoundry] All services running.');
    console.log(`[jobfoundry]   Dashboard: http://localhost:${INGEST_PORT}`);
    console.log(`[jobfoundry]   Logs:      ${LOGS_DIR}`);
    console.log('');

    // Fire-and-forget: open the default browser.
    execFile('cmd', ['/c', 'start', '', `http://localhost:${INGEST_PORT}`], {}, (err) => {
      if (err) console.log(`[jobfoundry] Open your browser at: http://localhost:${INGEST_PORT}`);
    });

    // Wait for any service to exit, then shut everything down.
    await new Promise((resolve) => {
      const done = () => resolve();
      for (const child of children.values()) {
        if (!child.exitCode) child.once('exit', done);
      }
    });
    console.log('[jobfoundry] A service exited unexpectedly. Shutting down.');
    shutdown('service exit', 1);
  } catch (err) {
    console.error(`[jobfoundry] ERROR: ${err.message}`);
    console.error(`[jobfoundry] See logs in ${LOGS_DIR}`);
    shutdown('startup failure', 1);
  }
}

main();
