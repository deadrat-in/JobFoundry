import { existsSync } from 'node:fs';

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  const apiKeys = String(env.API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const defaultBaseDir = existsSync('/data') ? '/data' : './data';
  const dbPath = (env.DB_PATH && env.DB_PATH.trim()) || `${defaultBaseDir}/jobfoundry.db`;
  const artifactsDir =
    (env.ARTIFACTS_DIR && env.ARTIFACTS_DIR.trim()) || `${defaultBaseDir}/artifacts`;
  const serverUrl = (env.SERVER_URL && env.SERVER_URL.trim()) || `http://localhost:${port}`;
  const staticDir = (env.STATIC_DIR && env.STATIC_DIR.trim()) || null;

  return { port, apiKeys, dbPath, artifactsDir, serverUrl, staticDir };
}
