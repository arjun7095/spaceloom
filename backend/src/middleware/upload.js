import multer from 'multer';
import { bad } from '../lib/http.js';

const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/csv|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|application\/vnd\.ms-excel)$/;

// Files are held in memory and handed to the storage adapter (local disk or S3).
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (ALLOWED.test(file.mimetype) ? cb(null, true) : cb(bad('This file type is not allowed'))),
});

export const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
