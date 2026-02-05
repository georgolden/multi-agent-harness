if (!process.env.DATABASE_URL) {
  throw new Error('Env DATABASE_URL is not defined');
}

export default {
  MessageHistory: { maxMessages: 10 },
  Storage: { connectionString: process.env.DATABASE_URL },
};
