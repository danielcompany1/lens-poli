const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const db = require('./config/database');
const csrf = require('./middleware/csrf');
const api = require('./routes/api');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
const frontend = path.resolve(__dirname, '../frontend');
const store = new MySQLStore({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, schema: { tableName: 'web_sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
  clearExpired: true, checkExpirationInterval: 15 * 60 * 1000, expiration: 8 * 60 * 60 * 1000
});
app.locals.sessionStore = store;

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'], styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"]
  } }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'lens.sid', store, secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(csrf);
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api', api);
app.use('/api', notFound);
app.use(express.static(frontend, { extensions: ['html'], index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('*', (_req, res) => res.sendFile(path.join(frontend, 'index.html')));
app.use(notFound);
app.use(errorHandler);

module.exports = app;
