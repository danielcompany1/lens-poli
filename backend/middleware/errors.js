function notFound(req, res) { res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }); }

function errorHandler(err, req, res, _next) {
  if (err?.code === 'LIMIT_FILE_SIZE') err.status = 400, err.message = 'Files must be 5 MB or smaller.';
  if (err?.code === 'ER_DUP_ENTRY') err.status = 409, err.message = 'A record with this email, code or number already exists.';
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'A server error occurred. Please try again.' : err.message });
}

module.exports = { notFound, errorHandler };
