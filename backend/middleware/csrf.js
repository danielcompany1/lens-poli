const crypto = require('crypto');
const HttpError = require('../utils/http-error');

function csrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const supplied = req.get('x-csrf-token');
    if (!supplied || supplied.length !== req.session.csrfToken.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(req.session.csrfToken))) {
      return next(new HttpError(403, 'Your session token is missing or expired. Refresh and try again.'));
    }
  }
  next();
}

module.exports = csrf;
