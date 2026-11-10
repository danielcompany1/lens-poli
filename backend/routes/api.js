const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const bcrypt = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const { parse } = require('csv-parse/sync');
const db = require('../config/database');
const { sendMail } = require('../config/mail');
const { upload, csvUpload, uploadRoot, validateFileSignature } = require('../middleware/uploads');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const HttpError = require('../utils/http-error');
const audit = require('../utils/audit');
const { createAccount } = require('../services/accounts');

const router = express.Router();
const appUrl = process.env.APP_URL || 'http://localhost:3000';
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const appNo = () => `LP-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const matricNo = async (conn, qualification) => {
  const [[row]] = await conn.execute('SELECT COUNT(*) total FROM students WHERE YEAR(created_at)=YEAR(CURDATE())');
  return `LP/${qualification}/${String(new Date().getFullYear()).slice(-2)}/${String(Number(row.total) + 1).padStart(4, '0')}`;
};
const validate = (req) => {
  const errors = validationResult(req);
  if (['password','newPassword','currentPassword','confirmPassword'].some((key)=>req.body?.[key] && Buffer.byteLength(String(req.body[key]), 'utf8') > 72)) {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
    throw new HttpError(400, 'Passwords must not exceed 72 UTF-8 bytes.');
  }
  if (!errors.isEmpty()) { if(req.file) fs.unlink(req.file.path).catch(()=>{}); throw new HttpError(400, errors.array()[0].msg); }
};
const notify = (conn, userId, title, body, type = 'info', link = null) => conn.execute(
  'INSERT INTO notifications (user_id,title,body,type,link) VALUES (?,?,?,?,?)', [userId,title,body,type,link]
);

router.get('/auth/csrf', (req, res) => res.json({ csrfToken: req.session.csrfToken }));

router.post('/auth/register', upload.single('photo'), [
  body('firstName').trim().isLength({ min: 1, max: 80 }), body('lastName').trim().isLength({ min: 1, max: 80 }),
  body('email').isEmail().normalizeEmail(), body('phone').trim().isLength({ min: 7, max: 30 }),
  body('dateOfBirth').isISO8601().withMessage('Enter a valid date of birth.'), body('gender').isIn(['Female','Male','Other','Prefer not to say']),
  body('password').isLength({ min: 10, max: 72 }).withMessage('Use a password with at least 10 characters.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'),
  body('programmeId').isInt({ min: 1 }), body('academicSessionId').isInt({ min: 1 })
], asyncHandler(async (req, res) => {
  validate(req);
  if (!req.file) throw new HttpError(400, 'A passport photograph is required.');
  await validateFileSignature(req.file);
  const conn = await db.getConnection();
  let userId;
  const token = crypto.randomBytes(32).toString('hex');
  try {
    await conn.beginTransaction();
    const [dupe] = await conn.execute('SELECT id FROM users WHERE email=?', [req.body.email]);
    if (dupe.length) throw new HttpError(409, 'An account with this email already exists.');
    const [[programme]] = await conn.execute('SELECT id FROM programmes WHERE id=? AND is_active=TRUE', [req.body.programmeId]);
    const [[session]] = await conn.execute('SELECT id FROM academic_sessions WHERE id=?', [req.body.academicSessionId]);
    if (!programme || !session) throw new HttpError(400, 'Choose an available programme and academic session.');
    userId = await createAccount(conn, {
      email: req.body.email, password: req.body.password, firstName: req.body.firstName,
      middleName: req.body.middleName, lastName: req.body.lastName, phone: req.body.phone || null
    });
    const [application] = await conn.execute(
      `INSERT INTO admission_applications (user_id,application_number,programme_id,academic_session_id,date_of_birth,gender,status)
       VALUES (?,?,?,?,?,?, 'draft')`,
      [userId, appNo(), Number(req.body.programmeId), Number(req.body.academicSessionId), req.body.dateOfBirth || null, req.body.gender || null]
    );
    const [photo] = await conn.execute(
      `INSERT INTO documents (owner_user_id,category,title,stored_name,original_name,mime_type,file_size,status)
       VALUES (?,'passport','Passport photograph',?,?,?,?, 'approved')`,
      [userId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size]
    );
    await conn.execute('UPDATE users SET photo_document_id=? WHERE id=?', [photo.insertId, userId]);
    await conn.execute('INSERT INTO email_verifications (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 24 HOUR))', [userId, hashToken(token)]);
    await audit(userId, 'applicant_registered', 'admission_application', application.insertId, null, conn);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    throw err;
  } finally { conn.release(); }
  const verifyUrl = `${appUrl}/?verify=${encodeURIComponent(token)}`;
  const delivered = await sendMail({ to: req.body.email, subject: 'Verify your Lens Polytechnic account', text: `Verify your email within 24 hours: ${verifyUrl}` });
  res.status(201).json({ message: 'Application account created. Verify your email to sign in.', emailSent: delivered, ...(process.env.NODE_ENV !== 'production' && !delivered ? { verificationToken: token } : {}) });
}));

router.post('/auth/verify-email', [body('token').isLength({ min: 32, max: 128 })], asyncHandler(async (req, res) => {
  validate(req);
  const [rows] = await db.execute('SELECT id,user_id FROM email_verifications WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW()', [hashToken(req.body.token)]);
  if (!rows.length) throw new HttpError(400, 'This verification link is invalid or expired.');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE email_verifications SET used_at=NOW() WHERE id=?', [rows[0].id]);
    await conn.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?', [rows[0].user_id]);
    await audit(rows[0].user_id, 'email_verified', 'user', rows[0].user_id, null, conn);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  res.json({ message: 'Email verified. You can now sign in.' });
}));

router.post('/auth/login', [body('identifier').trim().notEmpty(), body('password').isLength({min:1,max:72})], asyncHandler(async (req, res) => {
  validate(req);
  const identifier = req.body.identifier.trim();
  const [rows] = await db.execute(
    `SELECT u.id,u.email,u.password_hash,u.first_name,u.middle_name,u.last_name,u.role,u.status,u.email_verified_at,
            s.matriculation_number
       FROM users u LEFT JOIN students s ON s.user_id=u.id
      WHERE LOWER(u.email)=LOWER(?) OR s.matriculation_number=? LIMIT 1`, [identifier, identifier]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) throw new HttpError(401, 'Email/matriculation number or password is incorrect.');
  if (user.status !== 'active') throw new HttpError(403, 'This account is not active. Contact Student Affairs.');
  if (!user.email_verified_at) throw new HttpError(403, 'Verify your email before signing in.');
  await new Promise((resolve, reject) => req.session.regenerate((e) => e ? reject(e) : resolve()));
  req.session.user = { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, status: user.status };
  if (req.body.rememberMe) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  await db.execute('UPDATE users SET last_login_at=NOW() WHERE id=?', [user.id]);
  await audit(user.id, 'login', 'user', user.id, { ip: req.ip });
  res.json({ user: req.session.user, redirect: user.role === 'admin' ? '/admin' : '/student' });
}));

router.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  await audit(userId, 'logout', 'user', userId);
  req.session.destroy((err) => { if (err) return res.status(500).json({ error: 'Could not sign out.' }); res.clearCookie('lens.sid'); res.json({ message: 'Signed out.' }); });
}));

router.get('/auth/me', (req, res) => res.json({ user: req.session?.user || null }));

router.post('/auth/forgot-password', [body('email').isEmail().normalizeEmail()], asyncHandler(async (req, res) => {
  validate(req);
  const [rows] = await db.execute('SELECT id,email FROM users WHERE email=? AND status=\'active\'', [req.body.email]);
  let devToken;
  if (rows.length) {
    devToken = crypto.randomBytes(32).toString('hex');
    await db.execute('INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 1 HOUR))', [rows[0].id, hashToken(devToken)]);
    await sendMail({ to: rows[0].email, subject: 'Reset your Lens Polytechnic password', text: `Use this reset code in the portal within one hour: ${devToken}` });
  }
  res.json({ message: 'If the account exists, password reset instructions have been sent.', ...(process.env.NODE_ENV !== 'production' && devToken ? { resetToken: devToken } : {}) });
}));

router.post('/auth/reset-password', [body('token').isLength({ min: 32, max: 128 }), body('password').isLength({ min: 10, max: 72 })], asyncHandler(async (req, res) => {
  validate(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT id,user_id FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW() FOR UPDATE', [hashToken(req.body.token)]);
    if (!rows.length) throw new HttpError(400, 'This reset link is invalid or expired.');
    const hash = await bcrypt.hash(req.body.password, 12);
    await conn.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, rows[0].user_id]);
    await conn.execute('DELETE FROM web_sessions WHERE data LIKE ?', [`%"id":${rows[0].user_id}%`]);
    await conn.execute('UPDATE password_resets SET used_at=NOW() WHERE id=?', [rows[0].id]);
    await audit(rows[0].user_id, 'password_reset', 'user', rows[0].user_id, null, conn);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  res.json({ message: 'Password reset. Sign in with your new password.' });
}));

router.post('/auth/change-password', requireAuth, [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 10, max: 72 })], asyncHandler(async (req, res) => {
  validate(req);
  const [[user]] = await db.execute('SELECT password_hash FROM users WHERE id=?', [req.session.user.id]);
  if (!(await bcrypt.compare(req.body.currentPassword, user.password_hash))) throw new HttpError(400, 'Current password is incorrect.');
  const hash = await bcrypt.hash(req.body.newPassword, 12);
  await db.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.session.user.id]);
  await db.execute('DELETE FROM web_sessions WHERE data LIKE ?', [`%"id":${req.session.user.id}%`]);
  await audit(req.session.user.id, 'password_changed', 'user', req.session.user.id);
  req.session.destroy(() => {});
  res.json({ message: 'Password changed. Sign in again with your new password.' });
}));

router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const { id, role } = req.session.user;
  const [[session]] = await db.execute('SELECT id,name FROM academic_sessions WHERE is_current=TRUE LIMIT 1');
  const [[unread]] = await db.execute('SELECT COUNT(*) count FROM notifications WHERE user_id=? AND read_at IS NULL', [id]);
  const [[unreadMessages]] = await db.execute('SELECT COUNT(*) count FROM messages WHERE recipient_user_id=? AND read_at IS NULL', [id]);
  const [announcements] = await db.execute(`SELECT id,title,body,priority,created_at FROM announcements WHERE published=TRUE AND audience IN ('all','students') AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW()) ORDER BY FIELD(priority,'urgent','important','normal'),created_at DESC LIMIT 5`);
  if (role === 'admin') {
    const [[counts]] = await db.execute(`SELECT (SELECT COUNT(*) FROM students WHERE status='active') active_students,
      (SELECT COUNT(*) FROM admission_applications WHERE status IN ('submitted','under_review')) pending_applications,
      (SELECT COUNT(*) FROM documents WHERE status IN ('pending','under_review')) pending_documents,
      (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_progress')) open_tickets`);
    const [recent] = await db.execute(`SELECT u.id,u.first_name,u.last_name,a.application_number,a.status,a.created_at,p.name programme,p.qualification
      FROM admission_applications a JOIN users u ON u.id=a.user_id LEFT JOIN programmes p ON p.id=a.programme_id ORDER BY a.created_at DESC LIMIT 8`);
    return res.json({ role, session, counts, unread: unread.count, unreadMessages: unreadMessages.count, announcements, recent });
  }
  const [[student]] = await db.execute(`SELECT s.id,s.matriculation_number,s.current_level,s.status,p.name programme,p.qualification,d.name department,sc.name school,
    u.first_name,u.middle_name,u.last_name,u.email,u.phone,doc.id photo_id,ad.application_number,ad.status admission_status
    FROM users u LEFT JOIN students s ON s.user_id=u.id LEFT JOIN programmes p ON p.id=s.programme_id LEFT JOIN departments d ON d.id=p.department_id LEFT JOIN schools sc ON sc.id=d.school_id
    LEFT JOIN documents doc ON doc.id=u.photo_document_id LEFT JOIN admission_applications ad ON ad.user_id=u.id WHERE u.id=?`, [id]);
  const [[docCounts]] = await db.execute('SELECT COUNT(*) total,SUM(status=\'approved\') approved FROM documents WHERE owner_user_id=? AND category<>\'passport\'', [id]);
  const [[fee]] = student?.id ? await db.execute(`SELECT COALESCE(SUM(amount),0) due,COALESCE(SUM(amount_paid),0) paid FROM fee_accounts WHERE student_id=? AND status NOT IN ('paid','waived')`, [student.id]) : [[{ due: 0, paid: 0 }]];
  const [calendar] = await db.execute(`SELECT c.title,c.description,c.starts_at,c.ends_at FROM academic_calendar c JOIN academic_sessions a ON a.id=c.academic_session_id WHERE a.is_current=TRUE AND c.audience IN ('all','students') AND c.ends_at>=NOW() ORDER BY c.starts_at LIMIT 4`);
  const [results] = student?.id ? await db.execute(`SELECT SUM(r.grade_point*c.credit_units)/NULLIF(SUM(c.credit_units),0) gpa FROM results r JOIN courses c ON c.id=r.course_id WHERE r.student_id=? AND r.published=TRUE`, [student.id]) : [[{gpa:null}]];
  res.json({ role, session, student, unread: unread.count, unreadMessages: unreadMessages.count, announcements, calendar,
    documents: { total: docCounts.total || 0, approved: Number(docCounts.approved) || 0 }, fees: fee, cgpa: results[0]?.gpa === null ? null : Number(results[0]?.gpa).toFixed(2) });
}));

router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await db.execute(`SELECT u.id,u.email,u.phone,u.first_name,u.middle_name,u.last_name,u.photo_document_id,
    a.application_number,a.status admission_status,a.programme_id application_programme_id,a.academic_session_id application_session_id,a.date_of_birth,a.gender,a.state_of_origin,a.local_government,a.address,
    s.matriculation_number,s.current_level,s.admission_year,s.expected_graduation_year,s.status student_status,s.marital_status,s.nationality,s.guardian_name,s.guardian_phone,s.emergency_contact,s.previous_institution,
    COALESCE(sp.name,ap.name) programme,COALESCE(sp.qualification,ap.qualification) qualification,d.name department,sc.name school,ss.name academic_session
    FROM users u LEFT JOIN admission_applications a ON a.user_id=u.id LEFT JOIN students s ON s.user_id=u.id LEFT JOIN programmes sp ON sp.id=s.programme_id LEFT JOIN programmes ap ON ap.id=a.programme_id LEFT JOIN departments d ON d.id=COALESCE(sp.department_id,ap.department_id) LEFT JOIN schools sc ON sc.id=d.school_id LEFT JOIN academic_sessions ss ON ss.is_current=TRUE WHERE u.id=?`, [req.session.user.id]);
  if (!rows.length) throw new HttpError(404, 'Profile not found.');
  res.json({ profile: rows[0] });
}));

router.put('/profile', requireAuth, [body('phone').optional({checkFalsy:true}).isLength({max:30}), body('firstName').trim().isLength({min:1,max:80}), body('lastName').trim().isLength({min:1,max:80})], asyncHandler(async (req, res) => {
  validate(req);
  const id = req.session.user.id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE users SET first_name=?,middle_name=?,last_name=?,phone=? WHERE id=?', [req.body.firstName,req.body.middleName || null,req.body.lastName,req.body.phone || null,id]);
    await conn.execute(`UPDATE admission_applications SET date_of_birth=?,gender=?,state_of_origin=?,local_government=?,address=? WHERE user_id=?`,
      [req.body.dateOfBirth || null,req.body.gender || null,req.body.stateOfOrigin || null,req.body.localGovernment || null,req.body.address || null,id]);
    await conn.execute(`UPDATE students SET marital_status=?,nationality=?,guardian_name=?,guardian_phone=?,emergency_contact=?,previous_institution=? WHERE user_id=?`,
      [req.body.maritalStatus || null,req.body.nationality || 'Nigerian',req.body.guardianName || null,req.body.guardianPhone || null,req.body.emergencyContact || null,req.body.previousInstitution || null,id]);
    if(req.session.user.role==='applicant' && (req.body.programmeId || req.body.academicSessionId)) {
      const [[application]]=await conn.execute('SELECT id,status FROM admission_applications WHERE user_id=? FOR UPDATE',[id]);
      if(!application || application.status!=='draft') throw new HttpError(409,'Programme choices can only be changed while your application is a draft.');
      const [[programme]]=await conn.execute('SELECT id FROM programmes WHERE id=? AND is_active=TRUE',[req.body.programmeId]);
      const [[session]]=await conn.execute('SELECT id FROM academic_sessions WHERE id=?',[req.body.academicSessionId]);
      if(!programme||!session) throw new HttpError(400,'Choose a valid programme and academic session.');
      await conn.execute('UPDATE admission_applications SET programme_id=?,academic_session_id=? WHERE id=?',[
        req.body.programmeId, req.body.academicSessionId, application.id
      ]);
    }
    await audit(id,'profile_updated','user',id,null,conn);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  req.session.user.firstName = req.body.firstName; req.session.user.lastName = req.body.lastName;
  res.json({ message: 'Profile updated.' });
}));

router.post('/profile/photo', requireAuth, upload.single('photo'), asyncHandler(async (req,res) => {
  if (!req.file) throw new HttpError(400,'Choose a JPG, PNG or PDF file no larger than 5 MB.');
  await validateFileSignature(req.file);
  if (req.file.mimetype === 'application/pdf') { await fs.unlink(req.file.path); throw new HttpError(400,'A profile photo must be a JPG or PNG.'); }
  const conn=await db.getConnection();
  try { await conn.beginTransaction();
    const [doc]=await conn.execute(`INSERT INTO documents(owner_user_id,category,title,stored_name,original_name,mime_type,file_size,status) VALUES (?,'passport','Profile photograph',?,?,?,?, 'approved')`,[req.session.user.id,req.file.filename,req.file.originalname,req.file.mimetype,req.file.size]);
    await conn.execute('UPDATE users SET photo_document_id=? WHERE id=?',[doc.insertId,req.session.user.id]);
    await audit(req.session.user.id,'profile_photo_updated','document',doc.insertId,null,conn); await conn.commit();
    res.json({message:'Profile photo updated.'});
  } catch(err) { await conn.rollback(); await fs.unlink(req.file.path).catch(()=>{}); throw err; } finally { conn.release(); }
}));

router.get('/documents', requireAuth, asyncHandler(async (req,res)=>{
  const admin=req.session.user.role==='admin';
  const sql=`SELECT d.id,d.owner_user_id,d.category,d.title,d.description,d.original_name,d.mime_type,d.file_size,d.status,d.verification_comment,d.verified_at,d.created_at,u.first_name,u.last_name,u.email,s.matriculation_number FROM documents d JOIN users u ON u.id=d.owner_user_id LEFT JOIN students s ON s.user_id=u.id WHERE d.category<>'passport' ${admin?'':'AND d.owner_user_id=?'} ORDER BY d.created_at DESC`;
  const [rows]=await db.execute(sql,admin?[]:[req.session.user.id]); res.json({documents:rows});
}));

router.post('/documents', requireAuth, upload.single('file'), [body('title').trim().isLength({min:1,max:180}),body('category').isIn(['waec','neco','nabteb','jamb','nd_certificate','hnd_certificate','statement_of_result','transcript','birth_certificate','local_government_id','admission_letter','other'])], asyncHandler(async(req,res)=>{
  validate(req); if(!req.file) throw new HttpError(400,'Choose a file to upload.');
  await validateFileSignature(req.file);
  const [result]=await db.execute(`INSERT INTO documents(owner_user_id,category,title,description,stored_name,original_name,mime_type,file_size) VALUES(?,?,?,?,?,?,?,?)`,[req.session.user.id,req.body.category,req.body.title,req.body.description||null,req.file.filename,req.file.originalname,req.file.mimetype,req.file.size]);
  await audit(req.session.user.id,'document_uploaded','document',result.insertId,{category:req.body.category});
  await notify(db,req.session.user.id,'Document received',`${req.body.title} is waiting for review.`,'info','/student/documents');
  res.status(201).json({message:'Document uploaded and queued for review.',id:result.insertId});
}));

router.get('/documents/:id/download', requireAuth, asyncHandler(async(req,res)=>{
  const [[doc]]=await db.execute('SELECT id,owner_user_id,stored_name,original_name,mime_type FROM documents WHERE id=?',[req.params.id]);
  if(!doc || (req.session.user.role!=='admin' && doc.owner_user_id!==req.session.user.id)) throw new HttpError(404,'Document not found.');
  const full=path.join(uploadRoot,doc.stored_name);
  res.setHeader('Content-Type',doc.mime_type); res.download(full,doc.original_name);
}));

router.delete('/documents/:id', requireAuth, asyncHandler(async(req,res)=>{
  const [[doc]]=await db.execute('SELECT * FROM documents WHERE id=? AND owner_user_id=? AND category<>\'passport\'',[req.params.id,req.session.user.id]);
  if(!doc) throw new HttpError(404,'Document not found.');
  if(['approved','under_review'].includes(doc.status)) throw new HttpError(409,'This document cannot be deleted while it is approved or under review. Contact Student Affairs.');
  await db.execute('DELETE FROM documents WHERE id=?',[doc.id]); await fs.unlink(path.join(uploadRoot,doc.stored_name)).catch(()=>{}); res.json({message:'Document removed.'});
}));

router.patch('/documents/:id/verification', requireRole('admin'), [body('status').isIn(['under_review','approved','rejected','resubmission_required']),body('comment').optional({checkFalsy:true}).isLength({max:2000})], asyncHandler(async(req,res)=>{
  validate(req);
  const conn=await db.getConnection();
  try { await conn.beginTransaction();
    const [[doc]]=await conn.execute('SELECT id,owner_user_id,title FROM documents WHERE id=? FOR UPDATE',[req.params.id]); if(!doc) throw new HttpError(404,'Document not found.');
    await conn.execute('UPDATE documents SET status=?,verification_comment=?,verified_by=?,verified_at=NOW() WHERE id=?',[req.body.status,req.body.comment||null,req.session.user.id,doc.id]);
    await notify(conn,doc.owner_user_id,'Document review updated',`${doc.title}: ${req.body.status.replaceAll('_',' ')}${req.body.comment?` — ${req.body.comment}`:''}`,'info','/student/documents');
    await audit(req.session.user.id,'document_verification_changed','document',doc.id,{status:req.body.status},conn); await conn.commit();
  } catch(err){await conn.rollback();throw err;} finally{conn.release();}
  res.json({message:'Document status updated.'});
}));

router.get('/admissions', requireRole('admin'), asyncHandler(async(req,res)=>{
  const [applications]=await db.execute(`SELECT a.id,a.application_number,a.status,a.created_at,a.submitted_at,a.review_notes,u.id user_id,u.first_name,u.middle_name,u.last_name,u.email,u.phone,p.id programme_id,p.name programme,p.qualification,s.name academic_session
    FROM admission_applications a JOIN users u ON u.id=a.user_id LEFT JOIN programmes p ON p.id=a.programme_id LEFT JOIN academic_sessions s ON s.id=a.academic_session_id ORDER BY a.created_at DESC`);
  res.json({applications});
}));
router.get('/admissions/mine', requireRole('applicant','student'), asyncHandler(async(req,res)=>{
  const [[application]]=await db.execute(`SELECT a.id,a.application_number,a.status,a.review_notes,a.created_at,a.submitted_at,p.name programme,p.qualification,s.name academic_session FROM admission_applications a LEFT JOIN programmes p ON p.id=a.programme_id LEFT JOIN academic_sessions s ON s.id=a.academic_session_id WHERE a.user_id=?`,[req.session.user.id]);
  if(!application) throw new HttpError(404,'No admission application is linked to this account.'); res.json({application});
}));
router.post('/admissions/mine/submit', requireRole('applicant'), asyncHandler(async(req,res)=>{
  const [r]=await db.execute(`UPDATE admission_applications SET status='submitted',submitted_at=NOW() WHERE user_id=? AND status='draft' AND programme_id IS NOT NULL AND academic_session_id IS NOT NULL`,[req.session.user.id]);
  if(!r.affectedRows) throw new HttpError(409,'Your application is already submitted or needs a programme and session before submission.');
  await audit(req.session.user.id,'admission_application_submitted','admission_application',null); res.json({message:'Admission application submitted for review.'});
}));

router.patch('/admissions/:id/status', requireRole('admin'), [body('status').isIn(['submitted','under_review','approved','rejected','offered']),body('notes').optional({checkFalsy:true}).isLength({max:4000})], asyncHandler(async(req,res)=>{
  validate(req); const conn=await db.getConnection(); let matriculationNumber=null; let applicantId;
  try { await conn.beginTransaction();
    const [[a]]=await conn.execute(`SELECT a.*,u.first_name,u.last_name,p.qualification FROM admission_applications a JOIN users u ON u.id=a.user_id LEFT JOIN programmes p ON p.id=a.programme_id WHERE a.id=? FOR UPDATE`,[req.params.id]);
    if(!a) throw new HttpError(404,'Application not found.'); applicantId=a.user_id;
    await conn.execute('UPDATE admission_applications SET status=?,review_notes=?,reviewed_by=?,reviewed_at=NOW(),submitted_at=IF(?=\'submitted\' AND submitted_at IS NULL,NOW(),submitted_at) WHERE id=?',[req.body.status,req.body.notes||null,req.session.user.id,req.body.status,a.id]);
    if(req.body.status==='approved' || req.body.status==='offered') {
      const [[exists]]=await conn.execute('SELECT id FROM students WHERE application_id=?',[a.id]);
      if(!exists) {
        if(!a.programme_id) throw new HttpError(400,'Set an academic programme before approving this application.');
        matriculationNumber=await matricNo(conn,a.qualification||'ND');
        await conn.execute(`INSERT INTO students(user_id,application_id,matriculation_number,programme_id,admission_session_id,admission_year,expected_graduation_year) VALUES(?,?,?,?,?,YEAR(CURDATE()),YEAR(CURDATE())+2)`,[a.user_id,a.id,matriculationNumber,a.programme_id,a.academic_session_id]);
        await conn.execute("UPDATE users SET role='student' WHERE id=?",[a.user_id]);
      }
    }
    await notify(conn,a.user_id,'Admission application updated',`Your application ${a.application_number} is now ${req.body.status.replaceAll('_',' ')}${req.body.notes?`: ${req.body.notes}`:''}`,'info','/student/dashboard');
    await audit(req.session.user.id,'admission_status_changed','admission_application',a.id,{status:req.body.status,matriculationNumber},conn); await conn.commit();
  } catch(err){await conn.rollback();throw err;} finally{conn.release();}
  res.json({message:'Application updated.',matriculationNumber});
}));

router.get('/students', requireRole('admin'), asyncHandler(async(req,res)=>{
  const q=`%${String(req.query.q||'').slice(0,100)}%`;
  const [students]=await db.execute(`SELECT s.id,s.user_id,s.matriculation_number,s.programme_id,s.current_level,CASE WHEN u.status='active' THEN s.status ELSE u.status END status,s.admission_year,u.first_name,u.middle_name,u.last_name,u.email,u.phone,p.name programme,p.qualification,d.name department FROM students s JOIN users u ON u.id=s.user_id JOIN programmes p ON p.id=s.programme_id JOIN departments d ON d.id=p.department_id WHERE (?='' OR CONCAT_WS(' ',u.first_name,u.middle_name,u.last_name,s.matriculation_number,u.email) LIKE ?) ORDER BY u.last_name,u.first_name LIMIT 500`,[req.query.q||'',q]);
  res.json({students});
}));

router.post('/students', requireRole('admin'), [body('firstName').trim().isLength({min:1,max:80}),body('lastName').trim().isLength({min:1,max:80}),body('email').isEmail().normalizeEmail(),body('programmeId').isInt(),body('password').isLength({min:10,max:72})], asyncHandler(async(req,res)=>{
  validate(req); const conn=await db.getConnection(); let userId,matriculationNumber;
  try {await conn.beginTransaction();
    const [[p]]=await conn.execute('SELECT id,qualification FROM programmes WHERE id=?',[req.body.programmeId]); if(!p) throw new HttpError(400,'Programme does not exist.');
    userId=await createAccount(conn,{email:req.body.email,password:req.body.password,firstName:req.body.firstName,middleName:req.body.middleName,lastName:req.body.lastName,phone:req.body.phone||null,role:'student'});
    matriculationNumber=req.body.matriculationNumber||await matricNo(conn,p.qualification);
    await conn.execute(`INSERT INTO students(user_id,matriculation_number,programme_id,current_level,admission_year,expected_graduation_year) VALUES(?,?,?,?,YEAR(CURDATE()),YEAR(CURDATE())+2)`,[userId,matriculationNumber,p.id,Number(req.body.currentLevel)||1]);
    await conn.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?',[userId]);
    await audit(req.session.user.id,'student_created','student',userId,{matriculationNumber},conn); await conn.commit();
  }catch(err){await conn.rollback();throw err;}finally{conn.release();}
  res.status(201).json({message:'Student created.',matriculationNumber});
}));
router.put('/students/:id', requireRole('admin'), [body('programmeId').isInt(),body('currentLevel').isInt({min:1,max:5}),body('status').isIn(['active','suspended','graduated','withdrawn','deferred','archived'])], asyncHandler(async(req,res)=>{
  validate(req);const conn=await db.getConnection();try{await conn.beginTransaction();const [[s]]=await conn.execute('SELECT id,user_id FROM students WHERE id=? FOR UPDATE',[req.params.id]);if(!s)throw new HttpError(404,'Student not found.');const [[p]]=await conn.execute('SELECT id FROM programmes WHERE id=?',[req.body.programmeId]);if(!p)throw new HttpError(400,'Programme not found.');await conn.execute('UPDATE students SET programme_id=?,current_level=?,status=? WHERE id=?',[req.body.programmeId,req.body.currentLevel,req.body.status,s.id]);const accountStatus=req.body.status==='archived'?'archived':req.body.status==='suspended'?'blocked':'active';await conn.execute('UPDATE users SET status=? WHERE id=?',[accountStatus,s.user_id]);await audit(req.session.user.id,'student_record_updated','student',s.id,{programmeId:req.body.programmeId,currentLevel:req.body.currentLevel,status:req.body.status},conn);await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}res.json({message:'Student record updated.'});
}));

router.patch('/students/:id/status', requireRole('admin'), [body('status').isIn(['active','blocked','archived','suspended','graduated','withdrawn','deferred'])], asyncHandler(async(req,res)=>{
  validate(req); const conn=await db.getConnection();
  try {await conn.beginTransaction(); const [[s]]=await conn.execute('SELECT id,user_id FROM students WHERE id=? FOR UPDATE',[req.params.id]); if(!s) throw new HttpError(404,'Student not found.');
    const status=req.body.status; if(['active','blocked','archived'].includes(status)) await conn.execute('UPDATE users SET status=? WHERE id=?',[status,s.user_id]);
    if(!['active','blocked','archived'].includes(status)) await conn.execute('UPDATE students SET status=? WHERE id=?',[status,s.id]);
    if(status==='blocked') await conn.execute('UPDATE students SET status=\'suspended\' WHERE id=?',[s.id]);
    if(status==='active') await conn.execute('UPDATE students SET status=\'active\' WHERE id=?',[s.id]);
    if(status==='archived') await conn.execute('UPDATE students SET status=\'archived\' WHERE id=?',[s.id]);
    await notify(conn,s.user_id,'Student account status changed',`Your account status has been updated to ${status}.`,'important');
    await audit(req.session.user.id,'student_status_changed','student',s.id,{status},conn); await conn.commit();
  }catch(err){await conn.rollback();throw err;}finally{conn.release();}
  res.json({message:'Student status updated.'});
}));

router.get('/academic/sessions', asyncHandler(async(req,res)=>{
  const [sessions]=await db.execute('SELECT id,name,starts_on,ends_on,is_current,registration_opens_at,registration_closes_at FROM academic_sessions ORDER BY starts_on DESC'); res.json({sessions});
}));
router.get('/academic/semester/current', requireAuth, asyncHandler(async(req,res)=>{const [[semester]]=await db.execute(`SELECT se.id,se.name,se.registration_opens_at,se.registration_closes_at,ac.id academic_session_id,ac.name academic_session FROM semesters se JOIN academic_sessions ac ON ac.id=se.academic_session_id WHERE ac.is_current=TRUE AND se.is_current=TRUE LIMIT 1`);res.json({semester:semester||null});}));
router.get('/academic/semesters', requireRole('admin'), asyncHandler(async(req,res)=>{const [semesters]=await db.execute('SELECT se.id,se.name,se.starts_on,se.ends_on,se.is_current,se.registration_opens_at,se.registration_closes_at,ac.id academic_session_id,ac.name academic_session,ac.is_current session_is_current FROM semesters se JOIN academic_sessions ac ON ac.id=se.academic_session_id ORDER BY ac.starts_on DESC,se.starts_on');res.json({semesters});}));
router.post('/academic/sessions', requireRole('admin'), [body('name').matches(/^\d{4}\/\d{4}$/)], asyncHandler(async(req,res)=>{
  validate(req); const conn=await db.getConnection();let id;try{await conn.beginTransaction();const [r]=await conn.execute('INSERT INTO academic_sessions(name,starts_on,ends_on,registration_opens_at,registration_closes_at) VALUES(?,?,?,?,?)',[req.body.name,req.body.startsOn||null,req.body.endsOn||null,req.body.registrationOpensAt?.replace('T',' ')||null,req.body.registrationClosesAt?.replace('T',' ')||null]);id=r.insertId;for(const name of ['First Semester','Second Semester'])await conn.execute('INSERT INTO semesters(academic_session_id,name,registration_opens_at,registration_closes_at) VALUES(?,?,?,?)',[id,name,req.body.registrationOpensAt?.replace('T',' ')||null,req.body.registrationClosesAt?.replace('T',' ')||null]);await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}res.status(201).json({id,message:'Academic session and semesters created.'});
}));
router.patch('/academic/sessions/:id/current', requireRole('admin'), asyncHandler(async(req,res)=>{
  const conn=await db.getConnection(); try{await conn.beginTransaction(); await conn.execute('UPDATE academic_sessions SET is_current=FALSE'); const [r]=await conn.execute('UPDATE academic_sessions SET is_current=TRUE WHERE id=?',[req.params.id]); if(!r.affectedRows) throw new HttpError(404,'Session not found.'); await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();} res.json({message:'Current academic session changed.'});
}));
router.patch('/academic/semesters/:id/current', requireRole('admin'), asyncHandler(async(req,res)=>{const conn=await db.getConnection();try{await conn.beginTransaction();const [[target]]=await conn.execute(`SELECT se.id FROM semesters se JOIN academic_sessions ac ON ac.id=se.academic_session_id WHERE se.id=? AND ac.is_current=TRUE FOR UPDATE`,[req.params.id]);if(!target)throw new HttpError(409,'Set the academic session as current before changing its semester.');await conn.execute('UPDATE semesters SET is_current=FALSE');await conn.execute('UPDATE semesters SET is_current=TRUE WHERE id=?',[target.id]);await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}res.json({message:'Current semester changed.'});}));
router.patch('/academic/semesters/:id/registration', requireRole('admin'), [body('opensAt').optional({checkFalsy:true}).isISO8601(),body('closesAt').optional({checkFalsy:true}).isISO8601()], asyncHandler(async(req,res)=>{validate(req);const opens=req.body.opensAt?.replace('T',' ')||null,closes=req.body.closesAt?.replace('T',' ')||null;if(opens&&closes&&new Date(opens)>new Date(closes))throw new HttpError(400,'The registration closing date must follow the opening date.');const [r]=await db.execute('UPDATE semesters SET registration_opens_at=?,registration_closes_at=? WHERE id=?',[opens,closes,req.params.id]);if(!r.affectedRows)throw new HttpError(404,'Semester not found.');res.json({message:'Semester registration window updated.'});}));

router.get('/academic/programmes', asyncHandler(async(req,res)=>{
  const admin=req.session?.user?.role==='admin';const [programmes]=await db.execute(`SELECT p.id,p.name,p.qualification,p.duration_years,p.is_active,d.name department,s.name school FROM programmes p JOIN departments d ON d.id=p.department_id JOIN schools s ON s.id=d.school_id ${admin?'':'WHERE p.is_active=TRUE'} ORDER BY s.name,p.name,p.qualification`); res.json({programmes});
}));
router.get('/academic/grading-rules', requireAuth, asyncHandler(async(req,res)=>{const [rules]=await db.execute('SELECT id,minimum_score,maximum_score,grade,grade_point,remark FROM grading_rules ORDER BY minimum_score DESC');res.json({rules});}));
router.post('/academic/grading-rules', requireRole('admin'), [body('minimumScore').isFloat({min:0,max:100}),body('maximumScore').isFloat({min:0,max:100}),body('grade').trim().isLength({min:1,max:3}),body('gradePoint').isFloat({min:0,max:10}),body('remark').trim().isLength({min:2,max:30})], asyncHandler(async(req,res)=>{validate(req);if(Number(req.body.minimumScore)>Number(req.body.maximumScore))throw new HttpError(400,'Minimum score must not exceed maximum score.');const [[overlap]]=await db.execute('SELECT id FROM grading_rules WHERE minimum_score<=? AND maximum_score>=? LIMIT 1',[req.body.maximumScore,req.body.minimumScore]);if(overlap)throw new HttpError(409,'This score range overlaps an existing grading rule.');const [r]=await db.execute('INSERT INTO grading_rules(minimum_score,maximum_score,grade,grade_point,remark) VALUES(?,?,?,?,?)',[req.body.minimumScore,req.body.maximumScore,req.body.grade.toUpperCase(),req.body.gradePoint,req.body.remark]);res.status(201).json({id:r.insertId,message:'Grading rule added.'});}));
router.put('/academic/grading-rules/:id', requireRole('admin'), [body('minimumScore').isFloat({min:0,max:100}),body('maximumScore').isFloat({min:0,max:100}),body('grade').trim().isLength({min:1,max:3}),body('gradePoint').isFloat({min:0,max:10}),body('remark').trim().isLength({min:2,max:30})], asyncHandler(async(req,res)=>{validate(req);if(Number(req.body.minimumScore)>Number(req.body.maximumScore))throw new HttpError(400,'Minimum score must not exceed maximum score.');const [[overlap]]=await db.execute('SELECT id FROM grading_rules WHERE id<>? AND minimum_score<=? AND maximum_score>=? LIMIT 1',[req.params.id,req.body.maximumScore,req.body.minimumScore]);if(overlap)throw new HttpError(409,'This score range overlaps an existing grading rule.');const [r]=await db.execute('UPDATE grading_rules SET minimum_score=?,maximum_score=?,grade=?,grade_point=?,remark=? WHERE id=?',[req.body.minimumScore,req.body.maximumScore,req.body.grade.toUpperCase(),req.body.gradePoint,req.body.remark,req.params.id]);if(!r.affectedRows)throw new HttpError(404,'Grading rule not found.');res.json({message:'Grading rule updated.'});}));
router.get('/academic/departments', requireRole('admin'), asyncHandler(async(req,res)=>{const [departments]=await db.execute('SELECT d.id,d.name,d.code,d.school_id,s.name school FROM departments d JOIN schools s ON s.id=d.school_id ORDER BY s.name,d.name');res.json({departments});}));
router.get('/academic/schools', requireRole('admin'), asyncHandler(async(req,res)=>{const [schools]=await db.execute('SELECT id,name,code FROM schools ORDER BY name');res.json({schools});}));
router.post('/academic/departments', requireRole('admin'), [body('schoolId').isInt(),body('name').trim().isLength({min:2,max:150}),body('code').trim().isLength({min:2,max:20})], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('INSERT INTO departments(school_id,name,code) VALUES(?,?,?)',[req.body.schoolId,req.body.name,req.body.code.toUpperCase()]);res.status(201).json({id:r.insertId,message:'Department created.'});}));
router.post('/academic/programmes', requireRole('admin'), [body('departmentId').isInt(),body('name').trim().isLength({min:2,max:180}),body('qualification').isIn(['ND','HND'])], asyncHandler(async(req,res)=>{
  validate(req); const [r]=await db.execute('INSERT INTO programmes(department_id,name,qualification,duration_years) VALUES(?,?,?,?)',[req.body.departmentId,req.body.name,req.body.qualification,req.body.durationYears||2]); res.status(201).json({id:r.insertId,message:'Programme created.'});
}));
router.patch('/academic/programmes/:id', requireRole('admin'), [body('name').trim().isLength({min:2,max:180}),body('isActive').isBoolean()], asyncHandler(async(req,res)=>{validate(req); const [r]=await db.execute('UPDATE programmes SET name=?,is_active=? WHERE id=?',[req.body.name,req.body.isActive===true||req.body.isActive==='true',req.params.id]);if(!r.affectedRows) throw new HttpError(404,'Programme not found.');res.json({message:'Programme updated.'});}));

router.get('/academic/courses', requireAuth, asyncHandler(async(req,res)=>{
  let programmeId=req.query.programmeId, level=req.query.level, semester=req.query.semester;
  if(req.session.user.role==='student') { const [[s]]=await db.execute('SELECT programme_id,current_level FROM students WHERE user_id=?',[req.session.user.id]); if(s){programmeId=s.programme_id;level=s.current_level;} }
  const [courses]=await db.execute(`SELECT c.id,c.code,c.title,c.credit_units,c.level,c.semester,p.name programme FROM courses c JOIN programmes p ON p.id=c.programme_id WHERE c.is_active=TRUE AND (? IS NULL OR c.programme_id=?) AND (? IS NULL OR c.level=?) AND (? IS NULL OR c.semester=?) ORDER BY c.semester,c.code`,[programmeId||null,programmeId||null,level||null,level||null,semester||null,semester||null]); res.json({courses});
}));
router.post('/academic/courses', requireRole('admin'), [body('programmeId').isInt(),body('code').trim().isLength({min:2,max:20}),body('title').trim().isLength({min:2,max:180}),body('creditUnits').isInt({min:1,max:10}),body('level').isInt({min:1,max:5}),body('semester').isIn(['First Semester','Second Semester'])], asyncHandler(async(req,res)=>{validate(req); const [r]=await db.execute('INSERT INTO courses(programme_id,code,title,credit_units,level,semester) VALUES(?,?,?,?,?,?)',[req.body.programmeId,req.body.code.toUpperCase(),req.body.title,req.body.creditUnits,req.body.level,req.body.semester]);res.status(201).json({id:r.insertId,message:'Course created.'});}));

router.get('/academic/registration', requireAuth, asyncHandler(async(req,res)=>{
  if(req.session.user.role==='admin') {
    const [rows]=await db.execute(`SELECT cr.id,cr.status,cr.registered_at,u.first_name,u.last_name,s.matriculation_number,c.code,c.title,c.credit_units,se.name semester,ac.name academic_session FROM course_registrations cr JOIN students s ON s.id=cr.student_id JOIN users u ON u.id=s.user_id JOIN courses c ON c.id=cr.course_id JOIN semesters se ON se.id=cr.semester_id JOIN academic_sessions ac ON ac.id=se.academic_session_id ORDER BY cr.created_at DESC LIMIT 1000`); return res.json({registrations:rows});
  }
  const [rows]=await db.execute(`SELECT cr.id,cr.status,cr.registered_at,c.id course_id,c.code,c.title,c.credit_units,c.semester,se.name semester,ac.name academic_session FROM course_registrations cr JOIN students s ON s.id=cr.student_id JOIN courses c ON c.id=cr.course_id JOIN semesters se ON se.id=cr.semester_id JOIN academic_sessions ac ON ac.id=se.academic_session_id WHERE s.user_id=? AND ac.is_current=TRUE ORDER BY c.semester,c.code`,[req.session.user.id]); res.json({registrations:rows});
}));

router.post('/academic/registration', requireRole('student'), [body('courseIds').isArray({min:1}),body('courseIds.*').isInt()], asyncHandler(async(req,res)=>{
  const conn=await db.getConnection(); try{await conn.beginTransaction();
    const [[s]]=await conn.execute('SELECT id,programme_id,current_level FROM students WHERE user_id=? AND status=\'active\' FOR UPDATE',[req.session.user.id]);if(!s) throw new HttpError(403,'An active matriculated student record is required.');
    const [[semester]]=await conn.execute(`SELECT se.id,se.name FROM semesters se JOIN academic_sessions ac ON ac.id=se.academic_session_id WHERE ac.is_current=TRUE AND se.is_current=TRUE AND NOW() BETWEEN COALESCE(se.registration_opens_at,ac.registration_opens_at,'2000-01-01') AND COALESCE(se.registration_closes_at,ac.registration_closes_at,'2099-12-31') LIMIT 1`); if(!semester) throw new HttpError(409,'Course registration is currently closed.');
    const ids=[...new Set(req.body.courseIds.map(Number))];
    const [courses]=await conn.query(`SELECT id,credit_units FROM courses WHERE id IN (${ids.map(()=>'?').join(',')}) AND programme_id=? AND level=? AND semester=? AND is_active=TRUE`,[...ids,s.programme_id,s.current_level,semester.name]);
    if(courses.length!==ids.length) throw new HttpError(400,'One or more selected courses are not available for your current programme and level.');
    const units=courses.reduce((total,c)=>total+c.credit_units,0); if(units>30) throw new HttpError(400,'The selected courses exceed the 30 credit unit limit.');
    for(const course of courses) await conn.execute(`INSERT INTO course_registrations(student_id,course_id,semester_id,status) VALUES(?,?,?,'submitted') ON DUPLICATE KEY UPDATE status=IF(status='draft','submitted',status),registered_at=NOW()`,[s.id,course.id,semester.id]);
    await conn.execute(`UPDATE course_registrations SET registered_at=NOW() WHERE student_id=? AND semester_id=? AND status='submitted'`,[s.id,semester.id]); await audit(req.session.user.id,'course_registration_submitted','student',s.id,{courseIds:ids},conn); await conn.commit();
  }catch(err){await conn.rollback();throw err;}finally{conn.release();} res.json({message:'Course registration submitted.'});
}));
router.patch('/academic/registration/:id', requireRole('admin'), [body('status').isIn(['approved','reopened'])], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('UPDATE course_registrations SET status=?,approved_by=?,approved_at=NOW() WHERE id=?',[req.body.status,req.session.user.id,req.params.id]);if(!r.affectedRows) throw new HttpError(404,'Registration not found.');res.json({message:'Registration updated.'});}));

router.get('/academic/results', requireAuth, asyncHandler(async(req,res)=>{
  const isAdmin=req.session.user.role==='admin'; const sid=req.query.studentId;
  const [results]=await db.execute(`SELECT r.id,r.student_id,r.course_id,r.semester_id,r.ca_score,r.exam_score,r.total_score,r.grade,r.grade_point,r.published,c.code,c.title,c.credit_units,se.name semester,ac.name academic_session,s.matriculation_number,u.first_name,u.last_name FROM results r JOIN courses c ON c.id=r.course_id JOIN semesters se ON se.id=r.semester_id JOIN academic_sessions ac ON ac.id=se.academic_session_id JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id WHERE ${isAdmin?'(? IS NULL OR r.student_id=?)':'s.user_id=? AND r.published=TRUE'} ORDER BY ac.name DESC,se.name,c.code`,isAdmin?[sid||null,sid||null]:[req.session.user.id]);
  let semesterGpas=[];
  if(!isAdmin){const [rows]=await db.execute(`SELECT ac.name academic_session,se.name semester,SUM(r.grade_point*c.credit_units)/NULLIF(SUM(c.credit_units),0) gpa,SUM(c.credit_units) credit_units FROM results r JOIN courses c ON c.id=r.course_id JOIN semesters se ON se.id=r.semester_id JOIN academic_sessions ac ON ac.id=se.academic_session_id JOIN students st ON st.id=r.student_id WHERE st.user_id=? AND r.published=TRUE GROUP BY ac.id,se.id ORDER BY ac.starts_on DESC,se.starts_on DESC`,[req.session.user.id]);semesterGpas=rows;}
  res.json({results,semesterGpas});
}));
router.post('/academic/results', requireRole('admin'), [body('studentId').isInt(),body('courseId').isInt(),body('semesterId').isInt(),body('caScore').isFloat({min:0,max:100}),body('examScore').isFloat({min:0,max:100})], asyncHandler(async(req,res)=>{
  validate(req); const total=Number(req.body.caScore)+Number(req.body.examScore); if(total>100) throw new HttpError(400,'CA and examination scores together cannot exceed 100.');
  const [[grade]]=await db.execute('SELECT grade,grade_point FROM grading_rules WHERE ? BETWEEN minimum_score AND maximum_score LIMIT 1',[total]);
  const [r]=await db.execute(`INSERT INTO results(student_id,course_id,semester_id,ca_score,exam_score,total_score,grade,grade_point,entered_by) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ca_score=VALUES(ca_score),exam_score=VALUES(exam_score),total_score=VALUES(total_score),grade=VALUES(grade),grade_point=VALUES(grade_point),entered_by=VALUES(entered_by),entered_at=NOW()`,[req.body.studentId,req.body.courseId,req.body.semesterId,req.body.caScore,req.body.examScore,total,grade?.grade||null,grade?.grade_point||null,req.session.user.id]);
  await audit(req.session.user.id,'result_entered','result',r.insertId,{studentId:req.body.studentId,total}); res.status(201).json({message:'Result saved.'});
}));
router.patch('/academic/results/:id/publish', requireRole('admin'), asyncHandler(async(req,res)=>{const conn=await db.getConnection();let result;try{await conn.beginTransaction();[[result]]=await conn.execute('SELECT r.id,r.student_id,r.published,c.code FROM results r JOIN courses c ON c.id=r.course_id WHERE r.id=? FOR UPDATE',[req.params.id]);if(!result)throw new HttpError(404,'Result not found.');const published=!result.published;await conn.execute('UPDATE results SET published=? WHERE id=?',[published,result.id]);const [[student]]=await conn.execute('SELECT user_id FROM students WHERE id=?',[result.student_id]);if(published)await notify(conn,student.user_id,'A course result is available',`Your ${result.code} result has been published.`,'info','/student/results');await audit(req.session.user.id,published?'result_published':'result_unpublished','result',result.id,{published},conn);await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}res.json({message:'Result publication status changed.'});}));
router.post('/academic/results/import', requireRole('admin'), csvUpload.single('file'), asyncHandler(async(req,res)=>{
  if(!req.file) throw new HttpError(400,'Choose a CSV file.'); if(req.file.mimetype!=='text/csv'&&!req.file.originalname.toLowerCase().endsWith('.csv')) throw new HttpError(400,'Upload a CSV file.');
  const content=await fs.readFile(req.file.path,'utf8'); await fs.unlink(req.file.path).catch(()=>{});
  const rows=parse(content,{columns:true,skip_empty_lines:true,trim:true}); let imported=0;
  const conn=await db.getConnection(); try{await conn.beginTransaction(); for(const row of rows){const studentId=Number(row.student_id),courseId=Number(row.course_id),semesterId=Number(row.semester_id),ca=Number(row.ca_score),exam=Number(row.exam_score);if(!studentId||!courseId||!semesterId||!Number.isFinite(ca)||!Number.isFinite(exam)||ca<0||exam<0||ca+exam>100) throw new HttpError(400,`Invalid CSV row for student ${row.student_id||'(unknown)'}.`);const total=ca+exam;const [[g]]=await conn.execute('SELECT grade,grade_point FROM grading_rules WHERE ? BETWEEN minimum_score AND maximum_score LIMIT 1',[total]);await conn.execute(`INSERT INTO results(student_id,course_id,semester_id,ca_score,exam_score,total_score,grade,grade_point,entered_by) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ca_score=VALUES(ca_score),exam_score=VALUES(exam_score),total_score=VALUES(total_score),grade=VALUES(grade),grade_point=VALUES(grade_point),entered_by=VALUES(entered_by),entered_at=NOW()`,[studentId,courseId,semesterId,ca,exam,total,g?.grade||null,g?.grade_point||null,req.session.user.id]);imported++;}await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}
  await audit(req.session.user.id,'results_bulk_imported','result',null,{count:imported});res.json({message:`${imported} result rows imported.`,imported});
}));

router.get('/announcements', requireAuth, asyncHandler(async(req,res)=>{
  const admin=req.session.user.role==='admin'; const [announcements]=await db.execute(`SELECT id,title,body,audience,priority,published,starts_at,ends_at,created_at FROM announcements ${admin?'':'WHERE published=TRUE AND audience IN (\'all\',\'students\') AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())'} ORDER BY created_at DESC`);res.json({announcements});
}));
router.post('/announcements', requireRole('admin'), [body('title').trim().isLength({min:1,max:200}),body('body').trim().isLength({min:1,max:10000}),body('audience').isIn(['all','students','applicants','staff']),body('priority').isIn(['normal','important','urgent'])], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('INSERT INTO announcements(title,body,audience,priority,published,starts_at,ends_at,author_user_id) VALUES(?,?,?,?,?,?,?,?)',[req.body.title,req.body.body,req.body.audience,req.body.priority,req.body.published!==false,req.body.startsAt||null,req.body.endsAt||null,req.session.user.id]);if(req.body.published!==false&&['all','students'].includes(req.body.audience)){const [users]=await db.execute("SELECT id FROM users WHERE role='student' AND status='active'");for(const u of users) await notify(db,u.id,req.body.title,req.body.body.slice(0,450),'info','/student/announcements');}await audit(req.session.user.id,'announcement_created','announcement',r.insertId);res.status(201).json({message:'Announcement published.'});}));
router.put('/announcements/:id', requireRole('admin'), [body('title').trim().isLength({min:1,max:200}),body('body').trim().isLength({min:1,max:10000})], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('UPDATE announcements SET title=?,body=?,priority=?,published=? WHERE id=?',[req.body.title,req.body.body,req.body.priority||'normal',req.body.published!==false,req.params.id]);if(!r.affectedRows)throw new HttpError(404,'Announcement not found.');res.json({message:'Announcement updated.'});}));
router.delete('/announcements/:id', requireRole('admin'), asyncHandler(async(req,res)=>{const [r]=await db.execute('DELETE FROM announcements WHERE id=?',[req.params.id]);if(!r.affectedRows) throw new HttpError(404,'Announcement not found.');res.json({message:'Announcement deleted.'});}));

router.get('/messages', requireAuth, asyncHandler(async(req,res)=>{
  const [messages]=await db.execute(`SELECT m.id,m.sender_user_id,m.recipient_user_id,m.subject,m.body,m.parent_message_id,m.read_at,m.created_at,s.first_name sender_first,s.last_name sender_last,s.role sender_role,r.first_name recipient_first,r.last_name recipient_last FROM messages m JOIN users s ON s.id=m.sender_user_id JOIN users r ON r.id=m.recipient_user_id WHERE m.sender_user_id=? OR m.recipient_user_id=? ORDER BY m.created_at DESC LIMIT 300`,[req.session.user.id,req.session.user.id]);res.json({messages});
}));
router.post('/messages', requireAuth, [body('subject').trim().isLength({min:1,max:200}),body('body').trim().isLength({min:1,max:5000}),body('recipientUserId').optional({checkFalsy:true}).isInt()], asyncHandler(async(req,res)=>{
  validate(req); let recipient=req.body.recipientUserId;
  if(req.session.user.role==='student'&&!recipient){const [[admin]]=await db.execute("SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1");if(!admin)throw new HttpError(503,'Student Services messaging is not available yet.');recipient=admin.id;}
  if(!recipient) throw new HttpError(400,'Choose a recipient.');
  const [[target]]=await db.execute('SELECT id,role FROM users WHERE id=? AND status=\'active\'', [recipient]);if(!target) throw new HttpError(404,'Recipient not found.');
  if(req.session.user.role==='student'&&target.role!=='admin') throw new HttpError(403,'Students can send portal messages to Student Services administrators.');
  const [r]=await db.execute('INSERT INTO messages(sender_user_id,recipient_user_id,subject,body,parent_message_id) VALUES(?,?,?,?,?)',[req.session.user.id,recipient,req.body.subject,req.body.body,req.body.parentMessageId||null]);await notify(db,recipient,'New portal message',req.body.subject,'message','/student/messages');res.status(201).json({message:'Message sent.',id:r.insertId});
}));
router.patch('/messages/:id/read', requireAuth, asyncHandler(async(req,res)=>{const [r]=await db.execute('UPDATE messages SET read_at=NOW() WHERE id=? AND recipient_user_id=?',[req.params.id,req.session.user.id]);if(!r.affectedRows)throw new HttpError(404,'Message not found.');res.json({message:'Message marked as read.'});}));

router.get('/notifications', requireAuth, asyncHandler(async(req,res)=>{const [notifications]=await db.execute('SELECT id,title,body,type,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200',[req.session.user.id]);res.json({notifications});}));
router.patch('/notifications/read-all', requireAuth, asyncHandler(async(req,res)=>{await db.execute('UPDATE notifications SET read_at=NOW() WHERE user_id=? AND read_at IS NULL',[req.session.user.id]);res.json({message:'Notifications marked as read.'});}));

router.get('/tickets', requireAuth, asyncHandler(async(req,res)=>{const [tickets]=await db.execute(`SELECT t.id,t.ticket_number,t.subject,t.category,t.priority,t.status,t.created_at,t.updated_at,u.first_name,u.last_name FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE ${req.session.user.role==='admin'?'1=1':'t.user_id=?'} ORDER BY t.updated_at DESC`,req.session.user.role==='admin'?[]:[req.session.user.id]);res.json({tickets});}));
router.post('/tickets', requireAuth, [body('subject').trim().isLength({min:4,max:200}),body('body').trim().isLength({min:5,max:5000})], asyncHandler(async(req,res)=>{validate(req);const ticketNo=`LP-TKT-${Date.now().toString(36).toUpperCase()}`;const conn=await db.getConnection();try{await conn.beginTransaction();const [r]=await conn.execute('INSERT INTO support_tickets(ticket_number,user_id,subject,category,priority) VALUES(?,?,?,?,?)',[ticketNo,req.session.user.id,req.body.subject,req.body.category||'General',req.body.priority||'normal']);await conn.execute('INSERT INTO ticket_replies(ticket_id,sender_user_id,body) VALUES(?,?,?)',[r.insertId,req.session.user.id,req.body.body]);await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}res.status(201).json({message:`Support ticket ${ticketNo} created.`});}));
router.get('/tickets/:id', requireAuth, asyncHandler(async(req,res)=>{const [[ticket]]=await db.execute('SELECT * FROM support_tickets WHERE id=?',[req.params.id]);if(!ticket||(req.session.user.role!=='admin'&&ticket.user_id!==req.session.user.id))throw new HttpError(404,'Ticket not found.');const [replies]=await db.execute('SELECT r.id,r.body,r.created_at,u.first_name,u.last_name,u.role FROM ticket_replies r JOIN users u ON u.id=r.sender_user_id WHERE r.ticket_id=? ORDER BY r.created_at',[ticket.id]);res.json({ticket,replies});}));
router.post('/tickets/:id/replies', requireAuth, [body('body').trim().isLength({min:1,max:5000})], asyncHandler(async(req,res)=>{validate(req);const [[t]]=await db.execute('SELECT * FROM support_tickets WHERE id=?',[req.params.id]);if(!t||(req.session.user.role!=='admin'&&t.user_id!==req.session.user.id))throw new HttpError(404,'Ticket not found.');const [r]=await db.execute('INSERT INTO ticket_replies(ticket_id,sender_user_id,body) VALUES(?,?,?)',[t.id,req.session.user.id,req.body.body]);const recipient=req.session.user.role==='admin'?t.user_id:(await db.execute("SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1"))[0][0]?.id;if(recipient)await notify(db,recipient,'Support ticket reply',t.subject,'info','/student/support');res.status(201).json({message:'Reply added.',id:r.insertId});}));
router.patch('/tickets/:id/status', requireRole('admin'), [body('status').isIn(['open','in_progress','resolved','closed'])], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('UPDATE support_tickets SET status=? WHERE id=?',[req.body.status,req.params.id]);if(!r.affectedRows)throw new HttpError(404,'Ticket not found.');res.json({message:'Ticket status updated.'});}));

router.get('/academic/calendar', requireAuth, asyncHandler(async(req,res)=>{const [events]=await db.execute(`SELECT c.id,c.title,c.description,c.starts_at,c.ends_at,c.audience,s.name academic_session FROM academic_calendar c JOIN academic_sessions s ON s.id=c.academic_session_id WHERE ${req.session.user.role==='admin'?'1=1':"c.audience IN ('all','students')"} ORDER BY c.starts_at`,[]);res.json({events});}));
router.post('/academic/calendar', requireRole('admin'), [body('sessionId').isInt(),body('title').trim().isLength({min:1,max:180}),body('startsAt').isISO8601()], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('INSERT INTO academic_calendar(academic_session_id,title,description,starts_at,ends_at,audience) VALUES(?,?,?,?,?,?)',[req.body.sessionId,req.body.title,req.body.description||null,req.body.startsAt,req.body.endsAt||null,req.body.audience||'students']);res.status(201).json({id:r.insertId,message:'Calendar event created.'});}));

router.get('/fees', requireAuth, asyncHandler(async(req,res)=>{const [fees]=await db.execute(`SELECT f.id,f.description,f.amount,f.amount_paid,f.due_date,f.status,a.name academic_session,s.matriculation_number,u.first_name,u.last_name FROM fee_accounts f JOIN academic_sessions a ON a.id=f.academic_session_id JOIN students s ON s.id=f.student_id JOIN users u ON u.id=s.user_id WHERE ${req.session.user.role==='admin'?'1=1':'s.user_id=?'} ORDER BY f.due_date`,req.session.user.role==='admin'?[]:[req.session.user.id]);res.json({fees});}));
router.post('/fees', requireRole('admin'), [body('studentId').isInt(),body('sessionId').isInt(),body('description').trim().isLength({min:2,max:180}),body('amount').isFloat({min:0.01})], asyncHandler(async(req,res)=>{validate(req);const [r]=await db.execute('INSERT INTO fee_accounts(student_id,academic_session_id,description,amount,due_date) VALUES(?,?,?,?,?)',[req.body.studentId,req.body.sessionId,req.body.description,req.body.amount,req.body.dueDate||null]);res.status(201).json({id:r.insertId,message:'Fee account created.'});}));
router.post('/fees/:id/receipt', requireRole('admin'), [body('amount').isFloat({min:0.01})], asyncHandler(async(req,res)=>{validate(req);const conn=await db.getConnection();let fee;try{await conn.beginTransaction();[[fee]]=await conn.execute('SELECT * FROM fee_accounts WHERE id=? FOR UPDATE',[req.params.id]);if(!fee)throw new HttpError(404,'Fee account not found.');const paid=Number(fee.amount_paid)+Number(req.body.amount);if(paid>Number(fee.amount))throw new HttpError(400,'Payment is greater than the remaining balance.');const status=paid===Number(fee.amount)?'paid':'part_paid';await conn.execute('UPDATE fee_accounts SET amount_paid=?,status=? WHERE id=?',[paid,status,fee.id]);await notify(conn,(await conn.execute('SELECT user_id FROM students WHERE id=?',[fee.student_id]))[0][0].user_id,'Payment recorded',`${fee.description}: payment of ₦${Number(req.body.amount).toLocaleString()} recorded.`,'info');await audit(req.session.user.id,'fee_payment_recorded','fee_account',fee.id,{amount:req.body.amount},conn);await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}res.json({message:'Payment recorded.'});}));

router.get('/reports/dashboard', requireRole('admin'), asyncHandler(async(req,res)=>{
  const [[totals]]=await db.execute(`SELECT (SELECT COUNT(*) FROM students WHERE status='active') active_students,(SELECT COUNT(*) FROM admission_applications) applications,(SELECT COUNT(*) FROM admission_applications WHERE status IN ('submitted','under_review')) pending_applications,(SELECT COUNT(*) FROM results WHERE published=TRUE) published_results`);
  const [byProgramme]=await db.execute(`SELECT p.name,p.qualification,COUNT(s.id) students FROM programmes p LEFT JOIN students s ON s.programme_id=p.id GROUP BY p.id ORDER BY students DESC LIMIT 8`);
  const [applicationsByMonth]=await db.execute(`SELECT DATE_FORMAT(created_at,'%Y-%m') month,COUNT(*) count FROM admission_applications WHERE created_at>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH) GROUP BY month ORDER BY month`);
  res.json({totals,byProgramme,applicationsByMonth});
}));
router.get('/reports/students.csv', requireRole('admin'), asyncHandler(async(req,res)=>{const [rows]=await db.execute(`SELECT s.matriculation_number,u.first_name,u.middle_name,u.last_name,u.email,u.phone,p.name programme,p.qualification,s.current_level,s.status student_status FROM students s JOIN users u ON u.id=s.user_id JOIN programmes p ON p.id=s.programme_id ORDER BY u.last_name,u.first_name`);const esc=(x)=>`"${String(x??'').replaceAll('"','""')}"`;const csv=[Object.keys(rows[0]||{matriculation_number:'',first_name:'',last_name:'',email:'',programme:'',qualification:'',current_level:'',student_status:''}).join(','),...rows.map(r=>Object.values(r).map(esc).join(','))].join('\r\n');res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="lens-students.csv"');res.send(csv);}));
router.get('/reports/admissions.csv', requireRole('admin'), asyncHandler(async(req,res)=>{const [rows]=await db.execute(`SELECT a.application_number,u.first_name,u.middle_name,u.last_name,u.email,u.phone,p.name programme,p.qualification,s.name academic_session,a.status,a.submitted_at,a.reviewed_at FROM admission_applications a JOIN users u ON u.id=a.user_id LEFT JOIN programmes p ON p.id=a.programme_id LEFT JOIN academic_sessions s ON s.id=a.academic_session_id ORDER BY a.created_at DESC`);const esc=(x)=>`"${String(x??'').replaceAll('"','""')}"`;const keys=Object.keys(rows[0]||{application_number:'',first_name:'',last_name:'',email:'',programme:'',qualification:'',academic_session:'',status:''});const csv=[keys.join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n');res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="lens-admissions.csv"');res.send(csv);}));
router.get('/reports/registrations.csv', requireRole('admin'), asyncHandler(async(req,res)=>{const [rows]=await db.execute(`SELECT s.matriculation_number,u.first_name,u.last_name,p.name programme,ac.name academic_session,se.name semester,c.code course_code,c.title course_title,c.credit_units,cr.status,cr.registered_at FROM course_registrations cr JOIN students s ON s.id=cr.student_id JOIN users u ON u.id=s.user_id JOIN programmes p ON p.id=s.programme_id JOIN courses c ON c.id=cr.course_id JOIN semesters se ON se.id=cr.semester_id JOIN academic_sessions ac ON ac.id=se.academic_session_id ORDER BY ac.starts_on DESC,se.starts_on DESC,u.last_name,c.code`);const esc=(x)=>`"${String(x??'').replaceAll('"','""')}"`;const keys=Object.keys(rows[0]||{matriculation_number:'',first_name:'',last_name:'',programme:'',academic_session:'',semester:'',course_code:'',course_title:'',credit_units:'',status:''});const csv=[keys.join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n');res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="lens-registrations.csv"');res.send(csv);}));
router.post('/students/import', requireRole('admin'), csvUpload.single('file'), asyncHandler(async(req,res)=>{if(!req.file)throw new HttpError(400,'Choose a CSV file.');const content=await fs.readFile(req.file.path,'utf8');await fs.unlink(req.file.path).catch(()=>{});const rows=parse(content,{columns:true,skip_empty_lines:true,trim:true});if(rows.length>1000)throw new HttpError(400,'Import up to 1,000 students at a time.');const conn=await db.getConnection();let imported=0;try{await conn.beginTransaction();for(const row of rows){const email=String(row.email||'').trim().toLowerCase(),password=String(row.password||''),firstName=String(row.first_name||'').trim(),lastName=String(row.last_name||'').trim(),level=Number(row.current_level)||1;if(!/^\S+@\S+\.\S+$/.test(email)||!firstName||firstName.length>80||!lastName||lastName.length>80||password.length<10||Buffer.byteLength(password,'utf8')>72)throw new HttpError(400,'Each CSV row needs a valid email, first and last name, and a 10–72 character password (maximum 72 UTF-8 bytes).');if(!Number.isInteger(level)||level<1||level>6)throw new HttpError(400,'Student current_level must be an integer from 1 to 6.');const [[p]]=await conn.execute('SELECT id,qualification FROM programmes WHERE id=?',[Number(row.programme_id)]);if(!p)throw new HttpError(400,`Invalid programme_id: ${row.programme_id}`);const uid=await createAccount(conn,{email,password,firstName,lastName,middleName:row.middle_name,phone:row.phone,role:'student'});const number=row.matriculation_number||await matricNo(conn,p.qualification);await conn.execute(`INSERT INTO students(user_id,matriculation_number,programme_id,current_level,admission_year) VALUES(?,?,?,?,YEAR(CURDATE()))`,[uid,number,p.id,level]);await conn.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?',[uid]);imported++;}await conn.commit();}catch(err){await conn.rollback();throw err;}finally{conn.release();}await audit(req.session.user.id,'students_bulk_imported','student',null,{count:imported});res.json({message:`${imported} students imported.`,imported});}));

router.get('/admin/users', requireRole('admin'), asyncHandler(async(req,res)=>{const [users]=await db.execute(`SELECT id,email,first_name,last_name,role,status,created_at,last_login_at FROM users WHERE role='admin' ORDER BY created_at`);res.json({users});}));
router.post('/admin/users', requireRole('admin'), [body('email').isEmail().normalizeEmail(),body('firstName').trim().isLength({min:1,max:80}),body('lastName').trim().isLength({min:1,max:80}),body('password').isLength({min:12,max:72})], asyncHandler(async(req,res)=>{validate(req);const id=await createAccount(db,{email:req.body.email,password:req.body.password,firstName:req.body.firstName,lastName:req.body.lastName,role:'admin'});await db.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?',[id]);await audit(req.session.user.id,'admin_created','user',id);res.status(201).json({message:'Administrator account created.'});}));
router.patch('/admin/users/:id/status', requireRole('admin'), [body('status').isIn(['active','blocked'])], asyncHandler(async(req,res)=>{validate(req);if(Number(req.params.id)===req.session.user.id&&req.body.status==='blocked')throw new HttpError(400,'You cannot block your own administrator account.');const [r]=await db.execute("UPDATE users SET status=? WHERE id=? AND role='admin'",[req.body.status,req.params.id]);if(!r.affectedRows)throw new HttpError(404,'Administrator not found.');res.json({message:'Administrator status updated.'});}));

router.get('/me/photo', requireAuth, asyncHandler(async(req,res)=>{const [[doc]]=await db.execute('SELECT d.stored_name,d.original_name,d.mime_type FROM users u JOIN documents d ON d.id=u.photo_document_id WHERE u.id=?',[req.session.user.id]);if(!doc)throw new HttpError(404,'No profile photo uploaded.');res.setHeader('Content-Type',doc.mime_type);res.sendFile(path.join(uploadRoot,doc.stored_name));}));

module.exports = router;
