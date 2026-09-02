import { loadConfig } from './config.mjs';
import { openDb } from './db/index.mjs';
import { startServer } from './server.mjs';

const config = loadConfig();
const db = openDb({ path: config.dbPath });
const { url } = await startServer({
  port: config.port,
  db,
  apiKeys: config.apiKeys,
  artifactsDir: config.artifactsDir,
  serverUrl: config.serverUrl,
  staticDir: config.staticDir,
});
console.log(`ingest listening on ${url}`);
