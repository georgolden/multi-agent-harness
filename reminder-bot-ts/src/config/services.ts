if (!process.env.DATABASE_URL) {
  throw new Error('Env DATABASE_URL is not defined');
}
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Env TELEGRAM_BOT_TOKEN is not defined');
}

export default {
  Scheduler: { connectionString: process.env.DATABASE_URL },
  Telegram: { token: process.env.TELEGRAM_BOT_TOKEN },
};
