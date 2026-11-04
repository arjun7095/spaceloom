import { Router } from 'express';
import { z } from 'zod';
import { Attendance, Employee, LeaveRequest, OvertimeRequest, Property, Roster, Shift, Department, User } from '../models/index.js';
import { crud } from '../lib/crud.js';
import { ah, ok, parse, bad, conflict, forbidden, notFound, ApiError } from '../lib/http.js';
import { requirePermission, can, isBroad, isSupervisorOnly } from '../middleware/auth.js';
import { istDate, istAt, addDays, DAY_MS } from '../lib/context.js';
import { emitProperty, bumpKpis } from '../lib/socket.js';
import { notify } from '../lib/notify.js';
import { sendXlsx, readSheet } from '../lib/excel.js';
import { memoryUpload } from '../middleware/upload.js';
import { audit } from '../lib/audit.js';
import { env } from '../config/env.js';

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const pointInPolygon = ([lat, lng], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Circle (centre + radius) or polygon geo-fence (FR-3.5). Distance is to the centre, or to the nearest corner when outside a polygon.
export function fenceCheck(fence, lat, lng) {
  if (fence?.type === 'polygon' && fence.polygon?.length >= 3) {
    const inside = pointInPolygon([lat, lng], fence.polygon);
    return { inside, distanceM: inside ? 0 : Math.round(Math.min(...fence.polygon.map(([a, b]) => haversineM(lat, lng, a, b)))), limit: 'the site boundary' };
  }
  if (fence?.lat == null) return { inside: true, distanceM: null };
  const distanceM = Math.round(haversineM(lat, lng, fence.lat, fence.lng));
  return { inside: distanceM <= (fence.radiusM || 300), distanceM, limit: `${fence.radiusM || 300} m` };
}

// The phone's time of the tap is kept (up to 12 h back, never in the future); actions that reached
// the server more than 2 minutes later are marked as synced later.
function clientMoment(clientTime, now = new Date()) {
  if (!clientTime) return null;
  const t = new Date(clientTime);
  if (Number.isNaN(+t) || t < new Date(+now - 12 * 36e5) || t > new Date(+now + 120000)) return null;
  return { at: t > now ? now : t, offline: t < new Date(+now - 120000) };
}

export function attScope(req) {
  const u = req.user;
  if (isBroad(u)) return {};
  if (u.roles.includes('supervisor')) return { departmentId: { $in: u.departmentIds } };
  return { employeeId: u.employeeId || null };
}

const shiftWindow = (date, s) => {
  const start = istAt(date, s.start);
  const end = new Date(+istAt(date, s.end) + (s.crossesMidnight ? DAY_MS : 0));
  return { start, end, minutes: (end - start) / 60000 - (s.breakMin || 0) };
};

// Roster for "now": today's shift, or last night's shift if it crosses midnight and is still running.
async function currentRoster(employeeId, at = new Date()) {
  const today = istDate(at);
  const yesterday = addDays(today, -1);
  const rows = await Roster.find({ employeeId, date: { $in: [today, yesterday] } }).populate('shiftId').lean();
  const y = rows.find((r) => r.date === yesterday && r.shiftId?.crossesMidnight);
  if (y && at < shiftWindow(yesterday, y.shiftId).end) return y;
  return rows.find((r) => r.date === today) || null;
}

async function punchIn({ emp, at, source, extra = {}, roster }) {
  const date = roster?.date || istDate(at);
  const shift = roster?.shiftId;
  const exceptions = [];
  if (shift && !roster.isWeeklyOff && at > new Date(+istAt(date, shift.start) + (shift.graceMin || 0) * 60000)) exceptions.push('late');
  if (extra.insideFence === false) exceptions.push('outside_fence');
  const att = (await Attendance.findOne({ employeeId: emp._id, date })) || new Attendance({ employeeId: emp._id, date, propertyId: emp.propertyId, orgId: emp.orgId });
  if (att.checkIn?.time) return { att, duplicate: true };
  att.set({ departmentId: emp.departmentId, shiftId: shift?._id, checkIn: { time: at, source, ...extra }, status: 'present', exceptions: [...new Set([...(att.exceptions || []).filter((e) => e !== 'absent'), ...exceptions])] });
  await att.save();
  return { att, exceptions };
}

async function punchOut(att, at, source, extra = {}) {
  const shift = att.shiftId ? await Shift.findById(att.shiftId).lean() : null;
  const worked = Math.round((at - att.checkIn.time) / 60000);
  const ex = new Set(att.exceptions || []);
  if (shift) {
    const w = shiftWindow(att.date, shift);
    if (at < w.end) ex.add('early_exit');
    if (worked < w.minutes - 30) ex.add('short_hours');
  }
  att.set({ checkOut: { time: at, source, ...extra }, workedMin: worked, status: worked < 240 ? 'half_day' : 'present', exceptions: [...ex] });
  await att.save();
  return att;
}

export const attendanceRouter = Router();

// Every employee marks their own attendance, whatever their role; without an employee link the permission decides.
// Marking someone else's attendance is checked separately (attendance:approve).
const ownAttendance = (perm) => (req, res, next) => (req.user.employeeId || can(req.user, perm) ? next() : next(forbidden()));

attendanceRouter.get('/my', ownAttendance('attendance:read'), ah(async (req, res) => {
  const empId = req.user.employeeId;
  const property = await Property.findById(req.property._id).select('geoFence name').lean();
  if (!empId) return ok(res, { linked: false, property });
  const today = istDate();
  const [emp, roster, history, open] = await Promise.all([
    Employee.findById(empId).populate('departmentId', 'name').lean(),
    currentRoster(empId),
    Attendance.find({ employeeId: empId, date: { $gte: addDays(today, -30) } }).sort('-date').populate('shiftId', 'name code').lean(),
    Attendance.findOne({ employeeId: empId, 'checkIn.time': { $exists: true }, 'checkOut.time': { $exists: false }, date: { $gte: addDays(today, -1) } }).lean(),
  ]);
  const week = await Roster.find({ employeeId: empId, date: { $gte: today, $lte: addDays(today, 6) } }).populate('shiftId', 'name code start end').sort('date').lean();
  ok(res, { linked: true, employee: emp, property, roster, week, today: history.find((h) => h.date === (roster?.date || today)) || null, open, history });
}));

attendanceRouter.post('/check-in', ownAttendance('attendance:create'), ah(async (req, res) => {
  const d = parse(z.object({
    lat: z.number().optional(), lng: z.number().optional(), accuracy: z.number().optional(), selfieUrl: z.string().optional(),
    employeeId: z.string().optional(), reason: z.string().optional(), time: z.string().optional(), clientTime: z.string().optional(),
  }), req.body);
  const manual = Boolean(d.employeeId && d.employeeId !== String(req.user.employeeId));
  if (manual && !can(req.user, 'attendance:approve')) throw forbidden('Only supervisors can mark attendance for someone else');
  if (manual && !d.reason) throw bad('A reason is required for manual attendance', { reason: ['Required'] });
  const empId = manual ? d.employeeId : req.user.employeeId;
  if (!empId) throw bad('Your login is not linked to an employee record. Ask your supervisor.');
  const emp = await Employee.findById(empId).lean();
  if (!emp) throw notFound('Employee');
  let extra = { selfieUrl: d.selfieUrl };
  const now = new Date();
  const cm = manual ? null : clientMoment(d.clientTime, now);
  if (!manual) {
    if (d.lat == null || d.lng == null) throw bad('Turn on location to check in');
    const f = fenceCheck(req.property.geoFence, d.lat, d.lng);
    if (!f.inside && req.property.geoFence?.policy === 'block') throw new ApiError(422, 'OUTSIDE_GEOFENCE', `You are ${f.distanceM} m outside the property. Check-in only works within ${f.limit}.`);
    extra = { ...extra, lat: d.lat, lng: d.lng, insideFence: f.inside, distanceM: f.distanceM, ...(cm?.offline && { offline: true, syncedAt: now }) };
  }
  const at = manual && d.time ? new Date(d.time) : cm?.at || now;
  const roster = await currentRoster(empId, at);
  const { att, duplicate, exceptions } = await punchIn({ emp, at, source: manual ? 'manual' : 'mobile', extra, roster });
  if (duplicate) throw conflict('Already checked in for this shift');
  if (manual) {
    att.manualReason = d.reason;
    att.approvedBy = req.user._id;
    await att.save();
    await audit('manual_check_in', 'Attendance', att);
  }
  if (exceptions?.length) emitProperty(String(att.propertyId), 'attendance:exception', { employee: emp.name, exceptions });
  bumpKpis(att.propertyId);
  ok(res, att);
}));

attendanceRouter.post('/check-out', ownAttendance('attendance:create'), ah(async (req, res) => {
  const d = parse(z.object({ lat: z.number().optional(), lng: z.number().optional(), employeeId: z.string().optional(), reason: z.string().optional(), clientTime: z.string().optional() }), req.body);
  const manual = Boolean(d.employeeId && d.employeeId !== String(req.user.employeeId));
  if (manual && !can(req.user, 'attendance:approve')) throw forbidden();
  const empId = manual ? d.employeeId : req.user.employeeId;
  const now = new Date();
  const cm = manual ? null : clientMoment(d.clientTime, now);
  const at = cm?.at || now;
  const att = await Attendance.findOne({ employeeId: empId, 'checkIn.time': { $exists: true, $lt: at }, 'checkOut.time': { $exists: false }, date: { $gte: addDays(istDate(at), -1) } }).sort('-date');
  if (!att) throw conflict('You have not checked in yet');
  let extra = cm?.offline ? { offline: true, syncedAt: now } : {};
  if (d.lat != null && d.lng != null) {
    const f = fenceCheck(req.property.geoFence, d.lat, d.lng);
    extra = { ...extra, lat: d.lat, lng: d.lng, distanceM: f.distanceM, insideFence: f.inside };
  }
  await punchOut(att, at, manual ? 'manual' : 'mobile', extra);
  bumpKpis(att.propertyId);
  ok(res, att);
}));

// FR-3.9: planned (rostered, shift already started) vs present, by department and shift.
export async function todaySummary(scope = {}) {
  const today = istDate();
  const yesterday = addDays(today, -1);
  const now = new Date();
  const [rosters, atts] = await Promise.all([
    Roster.find({ date: { $in: [today, yesterday] }, isWeeklyOff: { $ne: true }, ...(scope.departmentId && { departmentId: scope.departmentId }) }).populate('shiftId', 'name code start end crossesMidnight graceMin').populate('departmentId', 'name').lean(),
    Attendance.find({ date: { $in: [today, yesterday] }, ...(scope.departmentId && { departmentId: scope.departmentId }) }).select('employeeId date status exceptions checkIn').lean(),
  ]);
  // Planned = shifts that have started today, plus last night's overnight shift while it is still running.
  const running = (r) => r.shiftId && (r.date === today ? now >= istAt(today, r.shiftId.start) : r.shiftId.crossesMidnight && now < new Date(+istAt(yesterday, r.shiftId.end) + DAY_MS));
  const started = rosters.filter(running);
  const byEmp = new Map(atts.map((a) => [`${a.employeeId}:${a.date}`, a]));
  const isPresent = (r) => ['present', 'half_day'].includes(byEmp.get(`${r.employeeId}:${r.date}`)?.status);
  const group = (keyFn) => {
    const m = {};
    for (const r of started) {
      const k = keyFn(r);
      m[k] ||= { name: k, planned: 0, present: 0 };
      m[k].planned++;
      if (isPresent(r)) m[k].present++;
    }
    return Object.values(m);
  };
  const present = started.filter(isPresent).length;
  return {
    date: today,
    rostered: rosters.filter((r) => r.date === today).length,
    planned: started.length,
    present,
    absent: started.length - present,
    pct: started.length ? Math.round((present / started.length) * 1000) / 10 : 0,
    onLeave: atts.filter((a) => a.date === today && a.status === 'leave').length,
    exceptions: atts.filter((a) => a.date === today && a.exceptions?.length).length,
    byDepartment: group((r) => r.departmentId?.name || '—'),
    byShift: group((r) => r.shiftId?.name || '—'),
  };
}

attendanceRouter.get('/today-summary', requirePermission('attendance:read'), ah(async (req, res) => {
  const scope = isSupervisorOnly(req.user) ? { departmentId: { $in: req.user.departmentIds } } : {};
  ok(res, await todaySummary(scope));
}));

attendanceRouter.get('/exceptions', requirePermission('attendance:read'), ah(async (req, res) => {
  const rows = await Attendance.find({ ...attScope(req), exceptions: { $exists: true, $ne: [] }, exceptionResolved: { $ne: true }, date: { $gte: addDays(istDate(), -7) } })
    .populate('employeeId', 'name code designation').populate('departmentId', 'name').populate('shiftId', 'name start end').sort('-date').limit(200).lean();
  ok(res, rows);
}));

attendanceRouter.post('/:id/resolve', requirePermission('attendance:approve'), ah(async (req, res) => {
  const d = parse(z.object({ action: z.enum(['approve', 'regularise', 'mark_absent']), checkIn: z.string().optional(), checkOut: z.string().optional(), reason: z.string().min(3, 'Give a reason') }), req.body);
  const att = await Attendance.findOne({ _id: req.params.id, ...attScope(req) });
  if (!att) throw notFound('Attendance');
  if (att.locked) throw conflict('Attendance for this month is locked for payroll');
  const before = att.toObject();
  if (d.action === 'regularise') {
    if (d.checkIn) att.set('checkIn', { ...(att.checkIn?.toObject?.() || {}), time: new Date(d.checkIn), source: att.checkIn?.source || 'manual' });
    if (d.checkOut) att.set('checkOut', { ...(att.checkOut?.toObject?.() || {}), time: new Date(d.checkOut), source: 'manual' });
    if (att.checkIn?.time && att.checkOut?.time) att.workedMin = Math.round((att.checkOut.time - att.checkIn.time) / 60000);
    att.status = 'present';
  }
  if (d.action === 'mark_absent') att.status = 'absent';
  Object.assign(att, { exceptionResolved: true, manualReason: d.reason, approvedBy: req.user._id });
  await att.save();
  await audit('update', 'Attendance', att, before);
  bumpKpis(att.propertyId);
  ok(res, att);
}));

// ── Roster grid (FR-3.3) ──
const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

attendanceRouter.get('/roster', requirePermission('roster:read'), ah(async (req, res) => {
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart || '') ? req.query.weekStart : istDate();
  const days = weekDays(weekStart);
  const deptFilter = req.query.departmentId ? { departmentId: req.query.departmentId } : isSupervisorOnly(req.user) ? { departmentId: { $in: req.user.departmentIds } } : {};
  const [employees, shifts, rows] = await Promise.all([
    Employee.find({ status: 'active', ...deptFilter }).select('code name designation departmentId skills').populate('departmentId', 'name').sort('name').lean(),
    Shift.find().sort('start').lean(),
    Roster.find({ date: { $in: days }, ...deptFilter }).lean(),
  ]);
  const cells = {};
  for (const r of rows) (cells[r.employeeId] ||= {})[r.date] = { shiftId: r.shiftId, isWeeklyOff: r.isWeeklyOff, published: r.published };
  ok(res, { days, employees, shifts, cells, published: rows.length > 0 && rows.every((r) => r.published) });
}));

attendanceRouter.put('/roster', requirePermission('roster:update'), ah(async (req, res) => {
  const { entries } = parse(z.object({ entries: z.array(z.object({ employeeId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), shiftId: z.string().nullable().optional(), isWeeklyOff: z.boolean().optional() })).max(2000) }), req.body);
  const emps = await Employee.find({ _id: { $in: [...new Set(entries.map((e) => e.employeeId))] } }).select('departmentId').lean();
  const deptOf = new Map(emps.map((e) => [String(e._id), e.departmentId]));
  const { _id: propertyId, orgId } = req.property;
  await Roster.bulkWrite(entries.filter((e) => deptOf.has(e.employeeId)).map((e) => ({
    updateOne: {
      filter: { employeeId: e.employeeId, date: e.date, propertyId },
      update: { $set: { shiftId: e.isWeeklyOff ? null : e.shiftId || null, isWeeklyOff: Boolean(e.isWeeklyOff), departmentId: deptOf.get(e.employeeId), published: false, isDeleted: false }, $setOnInsert: { orgId, createdBy: req.user._id } },
      upsert: true,
    },
  })));
  ok(res, { saved: entries.length });
}));

attendanceRouter.post('/roster/copy-week', requirePermission('roster:update'), ah(async (req, res) => {
  const d = parse(z.object({ fromWeekStart: z.string(), toWeekStart: z.string(), departmentId: z.string().optional() }), req.body);
  const src = await Roster.find({ date: { $in: weekDays(d.fromWeekStart) }, ...(d.departmentId && { departmentId: d.departmentId }) }).lean();
  const offset = Math.round((istAt(d.toWeekStart) - istAt(d.fromWeekStart)) / DAY_MS);
  const { _id: propertyId, orgId } = req.property;
  if (src.length) {
    await Roster.bulkWrite(src.map((r) => ({
      updateOne: {
        filter: { employeeId: r.employeeId, date: addDays(r.date, offset), propertyId },
        update: { $set: { shiftId: r.shiftId, isWeeklyOff: r.isWeeklyOff, departmentId: r.departmentId, postLocationId: r.postLocationId, published: false, isDeleted: false }, $setOnInsert: { orgId } },
        upsert: true,
      },
    })));
  }
  ok(res, { copied: src.length });
}));

attendanceRouter.post('/roster/publish', requirePermission('roster:update'), ah(async (req, res) => {
  const d = parse(z.object({ weekStart: z.string(), departmentId: z.string().optional() }), req.body);
  const q = { date: { $in: weekDays(d.weekStart) }, ...(d.departmentId && { departmentId: d.departmentId }) };
  const result = await Roster.updateMany(q, { published: true });
  const empIds = await Roster.distinct('employeeId', q);
  const users = await User.find({ employeeId: { $in: empIds } }).select('_id').lean();
  await notify({ userIds: users.map((u) => u._id), propertyId: req.property._id, type: 'roster_published', title: `Your roster for the week of ${d.weekStart} is published`, link: '/my-attendance' });
  ok(res, { published: result.modifiedCount });
}));

// ── Monthly payroll export (FR-3.10) ──
async function payrollRows(month) {
  const from = `${month}-01`;
  const to = `${month}-31`;
  const [emps, atts, leaves, ots] = await Promise.all([
    Employee.find().populate('departmentId', 'name').select('code name departmentId employmentType').sort('code').lean(),
    Attendance.find({ date: { $gte: from, $lte: to } }).select('employeeId status exceptions').lean(),
    LeaveRequest.find({ status: 'approved', from: { $lte: istAt(to, '23:59') }, to: { $gte: istAt(from) } }).lean(),
    OvertimeRequest.find({ status: 'approved', date: { $gte: istAt(from), $lte: istAt(to, '23:59') } }).lean(),
  ]);
  return emps.map((e) => {
    const mine = atts.filter((a) => String(a.employeeId) === String(e._id));
    return {
      code: e.code, name: e.name, department: e.departmentId?.name, type: e.employmentType,
      presentDays: mine.filter((a) => a.status === 'present').length + mine.filter((a) => a.status === 'half_day').length * 0.5,
      absentDays: mine.filter((a) => a.status === 'absent').length,
      leaveDays: leaves.filter((l) => String(l.employeeId) === String(e._id)).reduce((s, l) => s + (l.days || 0), 0),
      otHours: ots.filter((o) => String(o.employeeId) === String(e._id)).reduce((s, o) => s + (o.hours || 0), 0),
      lateMarks: mine.filter((a) => a.exceptions?.includes('late')).length,
    };
  });
}

attendanceRouter.get('/payroll-export', requirePermission('attendance:approve'), ah(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : istDate().slice(0, 7);
  const rows = await payrollRows(month);
  if (req.query.format === 'json') return ok(res, rows);
  const cols = [['code', 'Employee code'], ['name', 'Name'], ['department', 'Department'], ['type', 'Employment type'], ['presentDays', 'Present days'], ['absentDays', 'Absent days'], ['leaveDays', 'Leave days'], ['otHours', 'OT hours'], ['lateMarks', 'Late marks']].map(([key, header]) => ({ key, header }));
  await sendXlsx(res, `payroll-${month}`, cols, rows);
}));

attendanceRouter.post('/payroll-webhook', requirePermission('attendance:approve'), ah(async (req, res) => {
  const month = req.body?.month || istDate().slice(0, 7);
  const url = req.property.settings?.payrollWebhookUrl;
  if (!url) throw bad('Set a payroll webhook URL in the property settings first');
  const rows = await payrollRows(month);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property: req.property.code, month, rows }) });
  await Attendance.updateMany({ date: { $gte: `${month}-01`, $lte: `${month}-31` } }, { locked: true });
  ok(res, { sent: rows.length, status: r.status });
}));

// ── Device punches (FR-3.11 / FR-15.1): API key, no user session ──
export async function processPunches(propertyId, punches) {
  const result = { accepted: 0, duplicates: 0, unknown: [] };
  for (const p of punches) {
    const emp = await Employee.findOne({ propertyId, code: String(p.employeeCode).toUpperCase() }).lean();
    if (!emp) {
      result.unknown.push(p.employeeCode);
      continue;
    }
    const at = new Date(p.timestamp);
    if (Number.isNaN(+at)) continue;
    const source = p.source === 'face' ? 'face' : 'biometric';
    const open = await Attendance.findOne({ employeeId: emp._id, 'checkIn.time': { $lt: at }, 'checkOut.time': { $exists: false }, date: { $gte: addDays(istDate(at), -1) } });
    if (open && at - open.checkIn.time > 30 * 60000) {
      await punchOut(open, at, source, { deviceId: p.deviceId });
      result.accepted++;
      continue;
    }
    const roster = await Roster.findOne({ employeeId: emp._id, date: istDate(at) }).populate('shiftId').lean();
    const { duplicate } = await punchIn({ emp, at, source, extra: { deviceId: p.deviceId }, roster });
    duplicate ? result.duplicates++ : result.accepted++;
  }
  return result;
}

export const devicePunchHandler = ah(async (req, res) => {
  if (req.get('x-api-key') !== env.deviceApiKey) throw new ApiError(401, 'INVALID_API_KEY', 'Invalid device API key');
  const d = parse(z.object({ propertyCode: z.string(), punches: z.array(z.object({ deviceId: z.string().optional(), employeeCode: z.string(), timestamp: z.string(), source: z.enum(['biometric', 'face']).optional() })).max(5000) }), req.body);
  const prop = await Property.findOne({ code: d.propertyCode.toUpperCase() }).lean();
  if (!prop) throw notFound('Property');
  ok(res, await processPunches(prop._id, d.punches));
});

attendanceRouter.post('/import', requirePermission('attendance:approve'), memoryUpload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('Attach a CSV or Excel file with employeeCode, timestamp, deviceId columns');
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  ok(res, await processPunches(req.property._id, rows.map((r) => ({ employeeCode: r.employeeCode || r['Employee Code'], timestamp: r.timestamp || r.Timestamp, deviceId: r.deviceId || 'csv' }))));
}));

// Register (list / export) uses the generic engine.
export const attendanceList = crud(Attendance, {
  perm: 'attendance',
  label: 'Attendance',
  scopeFilter: attScope,
  sort: '-date',
  dateField: 'createdAt',
  populate: [{ path: 'employeeId', select: 'code name' }, { path: 'departmentId', select: 'name' }, { path: 'shiftId', select: 'name code' }],
  disable: ['create', 'delete', 'update'],
  queryHook: (q, req) => {
    if (req.query.date) q.$and.push({ date: req.query.date });
    if (req.query.view === 'exceptions') q.$and.push({ exceptions: { $ne: [] }, exceptionResolved: { $ne: true } });
  },
});

export const leaveHooks = {
  async beforeCreate(data, req) {
    const empId = data.employeeId && can(req.user, 'leave:approve') ? data.employeeId : req.user.employeeId;
    if (!empId) throw bad('Your login is not linked to an employee record');
    const emp = await Employee.findById(empId).lean();
    const out = { ...data, employeeId: empId, departmentId: emp?.departmentId, approvalLevels: ['supervisor'], currentLevel: 0 };
    if (data.from && data.to) out.days = Math.max(1, Math.round((istAt(String(data.to).slice(0, 10)) - istAt(String(data.from).slice(0, 10))) / DAY_MS) + 1);
    return out;
  },
  scope(req) {
    const u = req.user;
    if (isBroad(u)) return {};
    if (u.roles.includes('supervisor')) return { $or: [{ departmentId: { $in: u.departmentIds } }, { employeeId: u.employeeId }] };
    return { employeeId: u.employeeId || null };
  },
  async onLeaveApproved(doc) {
    const emp = await Employee.findById(doc.employeeId).lean();
    for (let d = istDate(doc.from); d <= istDate(doc.to); d = addDays(d, 1)) {
      await Attendance.updateOne(
        { employeeId: doc.employeeId, date: d, propertyId: doc.propertyId },
        { $set: { status: 'leave', departmentId: emp?.departmentId, isDeleted: false }, $setOnInsert: { orgId: doc.orgId } },
        { upsert: true },
      );
    }
  },
  async onRegularizationApproved(doc) {
    const att = (await Attendance.findOne({ employeeId: doc.employeeId, date: doc.date })) || new Attendance({ employeeId: doc.employeeId, date: doc.date, propertyId: doc.propertyId, orgId: doc.orgId, departmentId: doc.departmentId });
    if (doc.requestedIn) att.set('checkIn', { time: doc.requestedIn, source: 'manual' });
    if (doc.requestedOut) att.set('checkOut', { time: doc.requestedOut, source: 'manual' });
    if (att.checkIn?.time && att.checkOut?.time) att.workedMin = Math.round((att.checkOut.time - att.checkIn.time) / 60000);
    Object.assign(att, { status: 'present', exceptionResolved: true, manualReason: `Regularised: ${doc.reason}` });
    await att.save();
  },
};

export { Department };
