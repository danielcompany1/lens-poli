const db = require('../config/database');

async function audit(userId, action, entityType, entityId, details = null, conn = db) {
  await conn.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId || null, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = audit;
