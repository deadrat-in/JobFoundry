import { buildApp } from './app.mjs';

export async function startServer({ port, db, apiKeys, artifactsDir, serverUrl }) {
  const app = buildApp({ db, apiKeys, artifactsDir, serverUrl });
  const url = await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async (signal) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, url };
}
