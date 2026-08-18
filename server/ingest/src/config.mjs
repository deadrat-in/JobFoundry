export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 8080);
  const apiKeys = String(env.API_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dbPath = env.DB_PATH ?? './data/jobfoundry.db';
  return { port, apiKeys, dbPath };
}
