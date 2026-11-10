require('dotenv').config();
const db = require('../config/database');
const { createAccount } = require('../services/accounts');

(async () => {
  const { INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME, INITIAL_ADMIN_PASSWORD } = process.env;
  if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_NAME || !INITIAL_ADMIN_PASSWORD || INITIAL_ADMIN_PASSWORD.length < 12) {
    throw new Error('Set INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME and a 12+ character INITIAL_ADMIN_PASSWORD in .env before setup.');
  }
  const [existing] = await db.execute('SELECT id FROM users WHERE role=\'admin\' LIMIT 1');
  if (existing.length) throw new Error('An administrator already exists. Use the admin management screen to add another.');
  const [firstName, ...last] = INITIAL_ADMIN_NAME.trim().split(/\s+/);
  const conn = await db.getConnection();
  try {
    const id = await createAccount(conn, { email: INITIAL_ADMIN_EMAIL, password: INITIAL_ADMIN_PASSWORD, firstName, lastName: last.join(' ') || 'Administrator', role: 'admin' });
    await conn.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?', [id]);
    console.log(`Initial administrator created (user id ${id}). Remove INITIAL_ADMIN_PASSWORD from .env now.`);
  } finally { conn.release(); await db.end(); }
})().catch(async (err) => { console.error(err.message); await db.end(); process.exitCode = 1; });
