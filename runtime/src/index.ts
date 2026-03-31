import { loadEnv } from './utils/dotenv.js';

await loadEnv();

const { App } = await import('./app.js');

const app = new App();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  const forceExit = setTimeout(() => process.exit(1), 3000).unref();
  await app.stop();
  clearTimeout(forceExit);
  process.exit(0);
});

await app.start();
