const bcrypt = require('bcrypt');

async function createAccount(conn, { email, password, firstName, middleName = null, lastName, phone = null, role = 'applicant', status = 'active' }) {
  if (Buffer.byteLength(String(password), 'utf8') > 72) throw new Error('Passwords must not exceed 72 UTF-8 bytes.');
  const hash = await bcrypt.hash(password, 12);
  const [result] = await conn.execute(
    `INSERT INTO users (email, password_hash, first_name, middle_name, last_name, phone, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [email.toLowerCase().trim(), hash, firstName.trim(), middleName?.trim() || null, lastName.trim(), phone, role, status]
  );
  return result.insertId;
}

module.exports = { createAccount };
