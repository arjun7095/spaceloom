import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Property, User } from '../models/index.js';
import { ah, ok, parse, unauthorized, bad, ApiError } from '../lib/http.js';
import { authenticate, toAuthUser } from '../middleware/auth.js';
import { sendEmail } from '../lib/notify.js';
import { sha256 } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

const r = Router();
const COOKIE = 'ps_rt';
const MAX_ATTEMPTS = 5;
const LOCK_MIN = 15;
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/api/v1/auth', maxAge: 7 * 864e5 };

export const passwordRule = z.string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/\d/, 'Add a number')
  .regex(/[^A-Za-z0-9]/, 'Add a symbol such as @ or #');

const limiter = rateLimit({ windowMs: 15 * 60000, limit: env.isProd ? 30 : 300, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please wait a few minutes.' } } });

const loadUser = (q) => User.findOne(q).select('+passwordHash').populate('roleIds', 'key name permissions layout').lean();
const findByIdentifier = (id) => loadUser(String(id).includes('@') ? { email: String(id).toLowerCase().trim() } : { mobile: String(id).trim() });

function issueTokens(res, user) {
  const au = toAuthUser(user);
  const accessToken = jwt.sign({ sub: au.id, props: au.propertyIds, super: au.isSuper }, env.jwtSecret, { expiresIn: '15m' });
  const refresh = jwt.sign({ sub: au.id, tv: user.tokenVersion || 0 }, env.jwtRefreshSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, refresh, cookieOpts);
  return accessToken;
}

export async function publicUser(user) {
  const au = toAuthUser(user);
  const properties = await Property.find(au.isSuper ? {} : { _id: { $in: user.propertyIds } }).select('name code city type areaSqft is24x7 geoFence').lean();
  const roles = (user.roleIds || []).map((x) => ({ key: x.key, name: x.name, layout: x.layout }));
  return {
    _id: user._id, name: user.name, email: user.email, mobile: user.mobile, avatar: user.avatar,
    roles, primaryRole: roles[0]?.key, permissions: [...au.perms],
    layout: roles.length && roles.every((x) => x.layout === 'field') ? 'field' : 'office',
    properties, departmentIds: au.departmentIds, employeeId: user.employeeId, vendorId: user.vendorId, tenantId: user.tenantId,
    notificationPrefs: user.notificationPrefs || {}, isDemo: user.isDemo,
  };
}

r.post('/login', limiter, ah(async (req, res) => {
  const { identifier, password } = parse(z.object({ identifier: z.string().min(3, 'Enter your email or mobile'), password: z.string().min(1, 'Enter your password') }), req.body);
  const user = await findByIdentifier(identifier);
  if (!user || user.status !== 'active') throw unauthorized('Email/mobile or password is incorrect');
  if (user.lockUntil && user.lockUntil > new Date()) {
    const mins = Math.ceil((user.lockUntil - new Date()) / 60000);
    throw new ApiError(423, 'LOCKED', `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${mins} min or reset your password.`);
  }
  if (!(await bcrypt.compare(password, user.passwordHash || ''))) {
    const attempts = (user.failedAttempts || 0) + 1;
    const lock = attempts >= MAX_ATTEMPTS ? { lockUntil: new Date(Date.now() + LOCK_MIN * 60000), failedAttempts: 0 } : { failedAttempts: attempts };
    await User.updateOne({ _id: user._id }, lock);
    const left = MAX_ATTEMPTS - attempts;
    throw unauthorized(left > 0 ? `Email/mobile or password is incorrect (${left} attempt${left === 1 ? '' : 's'} left)` : `Account locked for ${LOCK_MIN} minutes`);
  }
  await User.updateOne({ _id: user._id }, { failedAttempts: 0, lockUntil: null, lastLogin: new Date() });
  const accessToken = issueTokens(res, user);
  ok(res, { accessToken, user: await publicUser(user) });
}));

r.post('/refresh', ah(async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw unauthorized();
  let p;
  try {
    p = jwt.verify(token, env.jwtRefreshSecret);
  } catch {
    throw unauthorized('Your session has expired');
  }
  const user = await loadUser({ _id: p.sub });
  if (!user || user.status !== 'active' || (user.tokenVersion || 0) !== p.tv) throw unauthorized('Your session has expired');
  const accessToken = issueTokens(res, user); // refresh token rotates on every use
  ok(res, { accessToken, user: await publicUser(user) });
}));

r.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
  ok(res, { loggedOut: true });
});

r.post('/forgot-password', limiter, ah(async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().min(3) }), req.body);
  const user = await findByIdentifier(identifier);
  let devOtp;
  if (user) {
    const otp = String(crypto.randomInt(100000, 999999));
    await User.updateOne({ _id: user._id }, { resetOtpHash: sha256(otp), resetOtpExpires: new Date(Date.now() + 10 * 60000) });
    await sendEmail(user.email, 'Your PrimeSpace password reset code', `Your one-time code is ${otp}. It expires in 10 minutes.`);
    if (!env.isProd) {
      devOtp = otp;
      logger.info({ email: user.email, otp }, '[dev] password reset OTP');
    }
  }
  ok(res, { message: 'If the account exists, a 6-digit code has been sent to its email.', devOtp });
}));

r.post('/reset-password', limiter, ah(async (req, res) => {
  const d = parse(z.object({ identifier: z.string(), otp: z.string().length(6, 'The code has 6 digits'), newPassword: passwordRule }), req.body);
  const user = await User.findOne(String(d.identifier).includes('@') ? { email: d.identifier.toLowerCase().trim() } : { mobile: d.identifier.trim() }).select('+resetOtpHash +resetOtpExpires');
  if (!user || !user.resetOtpHash || user.resetOtpExpires < new Date() || user.resetOtpHash !== sha256(d.otp)) throw bad('The code is wrong or has expired', { otp: ['Invalid code'] });
  user.passwordHash = await bcrypt.hash(d.newPassword, 12);
  user.resetOtpHash = undefined;
  user.resetOtpExpires = undefined;
  user.failedAttempts = 0;
  user.lockUntil = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  ok(res, { message: 'Password updated. Please sign in.' });
}));

r.get('/me', authenticate, ah(async (req, res) => {
  ok(res, await publicUser(await loadUser({ _id: req.user._id })));
}));

r.patch('/change-password', authenticate, ah(async (req, res) => {
  const d = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordRule }), req.body);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(d.currentPassword, user.passwordHash))) throw bad('Current password is incorrect', { currentPassword: ['Incorrect'] });
  user.passwordHash = await bcrypt.hash(d.newPassword, 12);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  const fresh = await loadUser({ _id: user._id });
  const accessToken = issueTokens(res, fresh);
  ok(res, { accessToken, message: 'Password changed' });
}));

r.patch('/preferences', authenticate, ah(async (req, res) => {
  const prefs = req.body?.notificationPrefs;
  if (!prefs || typeof prefs !== 'object') throw bad('notificationPrefs is required');
  await User.updateOne({ _id: req.user._id }, { notificationPrefs: prefs });
  ok(res, { notificationPrefs: prefs });
}));

export default r;
