import { AuditLog } from '../models/index.js';
import { ctx } from './context.js';
import { logger } from './logger.js';

const SKIP = new Set(['_id', '__v', 'updatedAt', 'updatedBy', 'passwordHash', 'resetOtpHash', 'history', 'comments']);
const plain = (d) => (d && typeof d.toObject === 'function' ? d.toObject() : d) || {};

function diff(before, after) {
  const b = {};
  const a = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SKIP.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { b, a };
}

// Immutable audit trail (FR-13.4). On updates only the changed fields are stored.
export async function audit(action, entity, doc, before) {
  const c = ctx();
  const after = plain(doc);
  if (after.bank) after.bank = { ...after.bank, accountNoEnc: undefined };
  const entry = { userId: c.userId, userName: c.userName, action, entity, entityId: after._id, ip: c.ip, propertyId: after.propertyId || c.propertyId, orgId: c.orgId };
  if (before) {
    const { b, a } = diff(plain(before), after);
    if (!Object.keys(a).length && action === 'update') return;
    Object.assign(entry, { before: b, after: a });
  } else if (action === 'create') {
    for (const k of SKIP) delete after[k];
    entry.after = after;
  }
  try {
    await AuditLog.create(entry);
  } catch (err) {
    logger.warn({ err }, 'audit write failed');
  }
}
