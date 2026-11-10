const HttpError = require('../utils/http-error');
const db = require('../config/database');

async function currentAccount(req) {
  if (!req.session?.user) return null;
  const [[account]] = await db.execute('SELECT role,status FROM users WHERE id=?', [req.session.user.id]);
  if (!account) return null;
  req.session.user.role = account.role;
  req.session.user.status = account.status;
  return account;
}

async function requireAuth(req, res, next) {
  try {
  if (!req.session?.user) return next(new HttpError(401, 'Please sign in to continue.'));
  const account = await currentAccount(req);
  if (!account) return next(new HttpError(401, 'Please sign in to continue.'));
  if (account.status !== 'active') { req.session.destroy(() => {}); return next(new HttpError(403, 'This account is not active. Contact Student Affairs.')); }
  next();
  } catch (err) { next(err); }
}

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
    if (!req.session?.user) return next(new HttpError(401, 'Please sign in to continue.'));
    const account = await currentAccount(req);
    if (!account) return next(new HttpError(401, 'Please sign in to continue.'));
    if (account.status !== 'active') { req.session.destroy(() => {}); return next(new HttpError(403, 'This account is not active.')); }
    if (!roles.includes(account.role)) return next(new HttpError(403, 'You do not have permission to perform this action.'));
    next();
    } catch (err) { next(err); }
  };
}

module.exports = { requireAuth, requireRole };
