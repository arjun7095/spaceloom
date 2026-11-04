import { Counter, Property } from '../models/index.js';

const codeCache = new Map();

// Human-readable numbers such as TKT-PTP-2026-000123, from an atomic counter.
export async function nextNumber(prefix, propertyId) {
  let code = codeCache.get(String(propertyId));
  if (!code) {
    const p = propertyId ? await Property.findById(propertyId).select('code').lean() : null;
    code = p?.code || 'GEN';
    codeCache.set(String(propertyId), code);
  }
  const key = `${prefix}-${code}-${new Date().getFullYear()}`;
  const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(c.seq).padStart(6, '0')}`;
}
