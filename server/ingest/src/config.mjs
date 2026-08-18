export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 8080);
  const apiKeys = String(env.API_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dbPath = env.DB_PATH ?? './data/jobfoundry.db';
  const artifactsDir = env.ARTIFACTS_DIR ?? './data/artifacts';
  const serverUrl = env.SERVER_URL ?? `http://localhost:${port}`;
  return { port, apiKeys, dbPath, artifactsDir, serverUrl };
}
