require('dotenv').config();
const db = require('../config/database');
const { createAccount } = require('../services/accounts');

(async () => {
  const password = process.env.DEMO_STUDENT_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set DEMO_STUDENT_PASSWORD (12+ characters) in .env to create the demo student.');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.execute('SELECT id FROM users WHERE email=?', ['student.demo@lenspolytechnic.edu.ng']);
    if (found.length) throw new Error('Demo student already exists.');
    const userId = await createAccount(conn, { email: 'student.demo@lenspolytechnic.edu.ng', password, firstName: 'Amina', middleName: 'Oluwaseun', lastName: 'Bello', phone: '+234 800 000 0000', role: 'student' });
    const [[programme]] = await conn.execute("SELECT id FROM programmes WHERE name='Computer Science' AND qualification='ND' LIMIT 1");
    const [[session]] = await conn.execute("SELECT id FROM academic_sessions WHERE is_current=TRUE LIMIT 1");
    await conn.execute(`INSERT INTO students (user_id,matriculation_number,programme_id,admission_session_id,current_level,admission_year,expected_graduation_year)
      VALUES (?, 'LP/ND/26/0001', ?, ?, 1, 2026, 2028)`, [userId, programme.id, session.id]);
    await conn.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?', [userId]);
    await conn.execute("INSERT INTO announcements (title,body,audience,priority,published,starts_at) VALUES ('Portal orientation','Welcome to the Lens Polytechnic student portal. Complete your profile, upload the required credentials and review your academic calendar.','students','normal',TRUE,NOW())");
    await conn.commit();
    console.log('Demo student created: student.demo@lenspolytechnic.edu.ng. Use the password from DEMO_STUDENT_PASSWORD.');
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); await db.end(); }
})().catch(async (err) => { console.error(err.message); await db.end(); process.exitCode = 1; });
