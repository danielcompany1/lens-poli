const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    if (process.env.NODE_ENV !== 'production') console.info(`[mail dev] ${to}: ${subject}\n${text}`);
    return false;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text, html });
  return true;
}

module.exports = { sendMail };
