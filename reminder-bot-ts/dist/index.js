/**
 * Telegram bot entry point for the reminder agent.
 */
import 'dotenv/config';
import { App } from './app.js';
const app = new App();
/**
 * Main entry point
 */
async function main() {
    await app.start();
    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`[Bot] ${signal} received, shutting down...`);
        await app.stop();
        process.exit(0);
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}
// Run the bot
main().catch((error) => {
    console.error('[Bot] Fatal error:', error);
    process.exit(1);
});
