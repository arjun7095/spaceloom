import crypto from 'node:crypto';
import { env } from '../config/env.js';

const key = crypto.createHash('sha256').update(env.encryptionKey).digest();

// AES-256-GCM; output is "enc:<iv>:<tag>:<ciphertext>" in base64 parts.
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['enc', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(value) {
  if (!value?.startsWith('enc:')) return value;
  const [, iv, tag, data] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
