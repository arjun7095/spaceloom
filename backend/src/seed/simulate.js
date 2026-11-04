import { Attendance, Roster } from '../models/index.js';
import { istDate, istAt, addDays, DAY_MS } from '../lib/context.js';

export const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
};

// Demo mode only: simulates biometric punches (~94% attendance, ~8% late) for shifts that have
// started, so the demo property's dashboard looks like a live site at any time of day.
export async function simulateAttendance(property, now = new Date()) {
  const today = istDate(now);
  const dates = [addDays(today, -1), today];
  const [rosters, atts] = await Promise.all([
    Roster.find({ propertyId: property._id, date: { $in: dates }, isWeeklyOff: { $ne: true }, shiftId: { $ne: null } }).populate('shiftId').lean(),
    Attendance.find({ propertyId: property._id, date: { $in: dates } }).lean(),
  ]);
  const have = new Map(atts.map((a) => [`${a.employeeId}:${a.date}`, a]));
  const ops = [];
  for (const r of rosters) {
    const s = r.shiftId;
    if (!s) continue;
    const start = istAt(r.date, s.start);
    const end = new Date(+istAt(r.date, s.end) + (s.crossesMidnight ? DAY_MS : 0));
    if (now < start) continue;
    const h = hash(`${r.employeeId}:${r.date}`) % 100;
    const existing = have.get(`${r.employeeId}:${r.date}`);
    const base = { propertyId: property._id, orgId: property.orgId, employeeId: r.employeeId, departmentId: r.departmentId, date: r.date, shiftId: s._id, isDeleted: false };
    if (h < 6) {
      if (!existing && now > end) ops.push({ insertOne: { document: { ...base, status: 'absent', exceptions: ['absent'] } } });
      continue;
    }
    const late = h >= 92;
    const inAt = new Date(+start + (late ? 15 + (h % 20) : -(h % 12)) * 60000);
    const outAt = new Date(+end + (h % 15) * 60000);
    const worked = Math.round((outAt - inAt) / 60000);
    if (!existing) {
      if (inAt > now) continue;
      const doc = { ...base, status: 'present', exceptions: late ? ['late'] : [], checkIn: { time: inAt, source: 'biometric', deviceId: 'DEMO-SIM', insideFence: true } };
      if (now > outAt) Object.assign(doc, { checkOut: { time: outAt, source: 'biometric', deviceId: 'DEMO-SIM' }, workedMin: worked });
      ops.push({ insertOne: { document: doc } });
    } else if (existing.checkIn?.deviceId === 'DEMO-SIM' && !existing.checkOut?.time && now > outAt) {
      ops.push({ updateOne: { filter: { _id: existing._id }, update: { $set: { checkOut: { time: outAt, source: 'biometric', deviceId: 'DEMO-SIM' }, workedMin: worked } } } });
    }
  }
  if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });

  // Keep today's attendance close to the 94% demo baseline when the hash spread falls short.
  const yesterday = dates[0];
  const started = rosters.filter((r) => r.shiftId && (r.date === today ? now >= istAt(today, r.shiftId.start) : r.shiftId.crossesMidnight && now < new Date(+istAt(yesterday, r.shiftId.end) + DAY_MS)));
  const fresh = await Attendance.find({ propertyId: property._id, date: { $in: dates } }).select('employeeId date status').lean();
  const key = (x) => `${x.employeeId}:${x.date}`;
  const presentKeys = new Set(fresh.filter((a) => ['present', 'half_day'].includes(a.status)).map(key));
  let need = Math.round(started.length * 0.94) - started.filter((r) => presentKeys.has(key(r))).length;
  for (const r of started) {
    if (need <= 0) break;
    if (presentKeys.has(key(r))) continue;
    const inAt = new Date(+istAt(r.date, r.shiftId.start) + 4 * 60000);
    const set = { status: 'present', exceptions: [], checkIn: { time: inAt, source: 'biometric', deviceId: 'DEMO-SIM', insideFence: true } };
    const existing = fresh.find((a) => key(a) === key(r));
    if (existing) await Attendance.updateOne({ _id: existing._id }, { $set: set });
    else await Attendance.create({ propertyId: property._id, orgId: property.orgId, employeeId: r.employeeId, departmentId: r.departmentId, date: r.date, shiftId: r.shiftId._id, ...set });
    need--;
  }
  return ops.length;
}
