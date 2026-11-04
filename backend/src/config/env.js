import 'dotenv/config';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 5080),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/primespace_ipfm',
  jwtSecret: process.env.JWT_SECRET || 'dev-access-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  encryptionKey: process.env.ENCRYPTION_KEY || 'dev-encryption-key-change-me',
  clientUrls: (process.env.CLIENT_URLS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  deviceApiKey: process.env.DEVICE_API_KEY || 'dev-device-key',
  runJobs: process.env.RUN_JOBS !== 'false',
  demoMode: process.env.DEMO_MODE !== 'false',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  signedUrlTtlSec: Number(process.env.SIGNED_URL_TTL_SEC || 6 * 3600),
  s3: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || 'ap-south-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
  vapid: { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT || 'mailto:admin@primespace.local' },
  sms: { provider: process.env.SMS_PROVIDER || 'console', from: process.env.SMS_FROM },
  whatsapp: { provider: process.env.WHATSAPP_PROVIDER || 'console', from: process.env.WHATSAPP_FROM },
  twilio: { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN },
  messageWebhook: { url: process.env.MESSAGE_WEBHOOK_URL, token: process.env.MESSAGE_WEBHOOK_TOKEN },
  inboundEmailToken: process.env.INBOUND_EMAIL_TOKEN,
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '91',
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'PrimeSpace IPFM <no-reply@primespace.local>',
  },
};

if (env.isProd && (env.jwtSecret === 'dev-access-secret' || env.encryptionKey.startsWith('dev-'))) {
  throw new Error('Set JWT_SECRET, JWT_REFRESH_SECRET and ENCRYPTION_KEY before running in production');
}
