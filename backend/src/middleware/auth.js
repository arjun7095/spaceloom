import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError, ah, forbidden, unauthorized } from '../lib/http.js';

export function toAuthUser(user) {
  const roles = user.roleIds || [];
  const perms = new Set(roles.flatMap((r) => r.permissions || []));
  return {
    _id: user._id,
    id: String(user._id),
    name: user.name,
    email: user.email,
    roles: roles.map((r) => r.key),
    perms,
    isSuper: perms.has('*'),
    propertyIds: (user.propertyIds || []).map(String),
    departmentIds: (user.departmentIds || []).map(String),
    employeeId: user.employeeId,
    vendorId: user.vendorId,
    tenantId: user.tenantId,
  };
}

// '*' = everything, '*:read' = read everything, 'ticket:*' = every ticket action.
export function can(user, perm) {
  if (!user) return false;
  const [mod, action] = perm.split(':');
  return user.isSuper || user.perms.has(perm) || user.perms.has(`${mod}:*`) || user.perms.has(`*:${action}`);
}

export const requirePermission = (...perms) => (req, res, next) => (perms.some((p) => can(req.user, p)) ? next() : next(forbidden()));

// Role helpers for row-level scope. "Broad" roles see the whole property.
const BROAD = ['super_admin', 'owner', 'property_manager', 'helpdesk', 'auditor', 'hse_officer', 'storekeeper', 'procurement'];
export const isBroad = (user) => user.isSuper || user.roles.some((r) => BROAD.includes(r));
export const hasOnly = (user, ...keys) => !isBroad(user) && user.roles.some((r) => keys.includes(r)) && !user.roles.includes('supervisor');
export const isSupervisorOnly = (user) => !isBroad(user) && user.roles.includes('supervisor');

export const authenticate = ah(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new ApiError(401, 'TOKEN_EXPIRED', 'Your session has expired');
  }
  const user = await User.findById(payload.sub).populate('roleIds', 'key name permissions layout').lean();
  if (!user || user.status !== 'active') throw unauthorized('This account is not active');
  req.user = toAuthUser(user);
  next();
});
