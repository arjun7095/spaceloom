import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Files are referenced in the database as "/uploads/<name>". Every API response turns that into a
// short-lived signed link; /uploads only serves a file when the signature is valid. With S3 configured
// the bytes live in the bucket and a valid link redirects to a presigned S3 URL.
export const uploadRoot = path.resolve(env.uploadDir);
await fs.mkdir(uploadRoot, { recursive: true });

const s3on = Boolean(env.s3.bucket);
const NAME = /^[a-f0-9]{32}\.[a-z0-9]{1,5}$/;
let s3;
async function s3client() {
  if (!s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3 = new S3Client({
      region: env.s3.region, endpoint: env.s3.endpoint, forcePathStyle: env.s3.forcePathStyle,
      credentials: env.s3.accessKeyId ? { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey } : undefined,
    });
  }
  return s3;
}

export const storageKind = () => (s3on ? `S3 (${env.s3.bucket})` : 'Local disk');
export const keyOf = (url) => (typeof url === 'string' ? url.match(/^\/uploads\/([a-f0-9]{32}\.[a-z0-9]{1,5})/)?.[1] || null : null);

export async function saveFile(buffer, originalName, mimetype) {
  const ext = (path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin').slice(0, 6);
  const name = crypto.randomBytes(16).toString('hex') + ext;
  if (s3on) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3client()).send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: name, Body: buffer, ContentType: mimetype }));
  } else {
    await fs.writeFile(path.join(uploadRoot, name), buffer);
  }
  return `/uploads/${name}`;
}

export async function removeFile(url) {
  const name = keyOf(url);
  if (!name) return;
  if (s3on) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3client()).send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: name }));
  } else {
    await fs.rm(path.join(uploadRoot, name), { force: true });
  }
}

const signature = (name, exp) => crypto.createHmac('sha256', `${env.jwtSecret}:files`).update(`${name}:${exp}`).digest('base64url').slice(0, 32);

// Expiry is rounded to the hour so the same file keeps the same link (and browser cache) for a while.
export function signUrl(url) {
  const name = keyOf(url);
  if (!name) return url;
  const exp = Math.ceil(Date.now() / 3600000) * 3600 + env.signedUrlTtlSec;
  return `/uploads/${name}?exp=${exp}&sig=${signature(name, exp)}`;
}

export const stripSignature = (s) => (typeof s === 'string' && s.startsWith('/uploads/') ? s.split('?')[0] : s);

// Removes signatures from anything a client sends back, so only the plain reference is stored.
export function stripDeep(v) {
  if (Array.isArray(v)) return v.map(stripDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripDeep(x)]));
  return stripSignature(v);
}

export function verifyLink(name, exp, sig) {
  if (!NAME.test(name || '') || !(Number(exp) > Date.now() / 1000) || typeof sig !== 'string') return false;
  const expected = Buffer.from(signature(name, Number(exp)));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export async function serveFile(req, res) {
  const { name } = req.params;
  if (!verifyLink(name, req.query.exp, req.query.sig)) {
    return res.status(403).json({ success: false, error: { code: 'LINK_EXPIRED', message: 'This file link has expired or is not valid. Reload the page to get a fresh link.' } });
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (s3on) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return res.redirect(302, await getSignedUrl(await s3client(), new GetObjectCommand({ Bucket: env.s3.bucket, Key: name }), { expiresIn: 300 }));
  }
  res.sendFile(path.join(uploadRoot, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
  });
}
