import { App } from './app.js';

const app = new App();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await app.stop();
  process.exit(0);
});

await app.start();
