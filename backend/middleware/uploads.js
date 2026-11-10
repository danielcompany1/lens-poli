const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readFile } = require('fs/promises');
const HttpError = require('../utils/http-error');

const root = path.resolve(__dirname, '../uploads/private');
fs.mkdirSync(root, { recursive: true });
const allowed = new Map([
  ['application/pdf', '.pdf'], ['image/jpeg', '.jpg'], ['image/png', '.png']
]);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, root),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${allowed.get(file.mimetype) || '.bin'}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const matches = file.mimetype === 'image/jpeg' ? ['.jpg','.jpeg'].includes(ext) : allowed.get(file.mimetype) === ext;
    if (matches) return cb(null, true);
    cb(new HttpError(400, 'Upload a PDF, JPG, JPEG or PNG file.'));
  }
});

const csvUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.csv' && ['text/csv','application/vnd.ms-excel','application/csv','application/octet-stream'].includes(file.mimetype)) return cb(null, true);
    cb(new HttpError(400, 'Upload a CSV file.'));
  }
});

async function validateFileSignature(file) {
  if (!file) return;
  const handle = await readFile(file.path);
  const bytes = handle.subarray(0, 8);
  const valid = file.mimetype === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
    : file.mimetype === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : file.mimetype === 'image/png' ? bytes.equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) : false;
  if (!valid) { await require('fs/promises').unlink(file.path).catch(() => {}); throw new HttpError(400, 'The file contents do not match the selected file type.'); }
}

module.exports = { upload, csvUpload, uploadRoot: root, validateFileSignature };
