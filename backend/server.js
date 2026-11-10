require('dotenv').config();
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('Set SESSION_SECRET to a random value of at least 32 characters in .env.');
  process.exit(1);
}
const app = require('./app');
const db = require('./config/database');
const port = Number(process.env.PORT || 3000);

(async () => {
  await app.locals.sessionStore.onReady();
  await db.query('SELECT 1');
  const server = app.listen(port, () => console.log(`Lens Polytechnic SIMS listening at ${process.env.APP_URL || `http://localhost:${port}`}`));
  const shutdown = () => server.close(async () => { await app.locals.sessionStore.close(); await db.end(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((err) => { console.error(`Startup failed: ${err.message}`); process.exit(1); });
