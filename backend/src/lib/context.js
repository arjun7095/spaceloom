import { AsyncLocalStorage } from 'node:async_hooks';

// Request context: { propertyId, orgId, userId, userName, ip }. The Mongoose base plugin reads it
// to scope every query to the active property, so a handler cannot leak another property's data.
export const als = new AsyncLocalStorage();
export const ctx = () => als.getStore() || {};

const IST_OFFSET_MIN = 330;
export const DAY_MS = 864e5;

// 'YYYY-MM-DD' for a date in India Standard Time.
export const istDate = (d = new Date()) => new Date(+new Date(d) + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
// A Date for an IST wall-clock time on an IST date, e.g. istAt('2026-10-30', '09:00').
export const istAt = (date, hhmm = '00:00') => new Date(`${date}T${hhmm}:00+05:30`);
export const addDays = (dateStr, n) => istDate(+istAt(dateStr, '12:00') + n * DAY_MS);
