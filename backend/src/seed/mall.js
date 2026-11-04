import * as M from '../models/index.js';
import { istAt, addDays, DAY_MS } from '../lib/context.js';
import { addFreq } from '../modules/workorders.js';
import { simulateAttendance } from './simulate.js';

// A second, smaller demo property so the portfolio view, property switcher and data isolation can be shown.
let state = 7;
const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const FIRST = ['Naresh', 'Sai', 'Teja', 'Vamsi', 'Chaitanya', 'Rakesh', 'Pavan', 'Srikanth', 'Ashwini', 'Haritha', 'Keerthi', 'Mounika', 'Sneha', 'Roja', 'Usha', 'Yusuf', 'Abdul', 'Mary', 'Gopal', 'Ravi'];
const LAST = ['Reddy', 'Rao', 'Goud', 'Naidu', 'Varma', 'Shaik', 'Kumar', 'Yadav', 'Achari', 'Raju'];
const H = 36e5;
const MIN = 6e4;

export async function seedMall({ orgId, role, slaPolicy, tcats, acats, tpls, vendor, itemDocs, passwordHash, numFor, today, now, goLive }) {
  state = 7;
  const num = numFor('PGM');
  const property = await M.Property.create({
    orgId, name: 'Prime Galleria Mall', code: 'PGM', type: 'mall', address: 'Gachibowli Main Road', city: 'Hyderabad', areaSqft: 350000, is24x7: true,
    geoFence: { type: 'circle', lat: 17.4401, lng: 78.3489, radiusM: 250, policy: 'flag' }, slaPolicyId: slaPolicy._id, isDemo: true,
    goLive: goLive.map((g) => ({ ...g, done: g.phase <= 2 })), settings: { reportRecipients: ['mall.reports@primegalleria.example'], selfieRetentionDays: 60 },
  });
  const P = { orgId, propertyId: property._id };
  const depts = await M.Department.insertMany([['FM', 'Facility Management'], ['ENG', 'Engineering'], ['HK', 'Housekeeping'], ['SEC', 'Security'], ['HSE', 'HSE'], ['HD', 'Helpdesk'], ['ADM', 'Admin']].map(([code, name]) => ({ ...P, code, name })));
  const dept = Object.fromEntries(depts.map((d) => [d.code, d]));
  const shifts = await M.Shift.insertMany([
    { ...P, code: 'GEN', name: 'General', start: '09:00', end: '18:00', breakMin: 60, color: '#00918F' },
    { ...P, code: 'A', name: 'Shift A', start: '06:00', end: '14:00', color: '#3B82F6' },
    { ...P, code: 'B', name: 'Shift B', start: '14:00', end: '22:00', color: '#F59E0B' },
    { ...P, code: 'C', name: 'Shift C', start: '22:00', end: '06:00', crossesMidnight: true, color: '#6366F1' },
  ]);
  const shift = Object.fromEntries(shifts.map((s) => [s.code, s]));

  const locs = [];
  const loc = {};
  const mk = (doc) => { const d = new M.Location({ ...P, ...doc }); locs.push(d); loc[d.code] = d; return d; };
  const block = mk({ type: 'tower', name: 'Mall Block', code: 'PGM-M', path: 'Mall Block', level: 0 });
  for (const [fc, fn] of [['LG', 'Lower Ground'], ['G', 'Ground Floor'], ['F1', 'First Floor'], ['F2', 'Second Floor'], ['F3', 'Third Floor']]) {
    const fl = mk({ type: 'floor', parentId: block._id, name: fn, code: `PGM-${fc}`, path: `Mall Block / ${fn}`, level: 1 });
    for (const [zc, zn] of [['ATR', 'Atrium'], ['N', 'North Wing'], ['S', 'South Wing'], ['FC', 'Food Court']]) mk({ type: 'zone', parentId: fl._id, name: zn, code: `PGM-${fc}-${zc}`, path: `Mall Block / ${fn} / ${zn}`, level: 2 });
  }
  for (const [code, name] of [['PGM-BSMT', 'Basement Parking'], ['PGM-UTIL', 'Utility Yard']]) mk({ type: 'area', name, code, path: name, level: 0 });
  await M.Location.insertMany(locs);
  const zones = locs.filter((l) => l.type === 'zone');
  const tenants = await M.Tenant.insertMany([['Urban Threads', 'PGM-G-N'], ['Spice Route Food Court', 'PGM-F3-FC'], ['CineMax Screens', 'PGM-F3-S'], ['Tech Galaxy Store', 'PGM-F1-N']]
    .map(([name, u]) => ({ ...P, name, units: [loc[u]._id], contacts: [{ name: 'Store manager', phone: '9000000001' }] })));

  const SPEC = [
    ['ENG', 'Engineering Supervisor', ['HVAC', 'Electrical'], 1, 'GEN'], ['ENG', 'HVAC Technician', ['HVAC'], 3, 'ROT4'], ['ENG', 'Electrician', ['Electrical'], 3, 'ROT4'], ['ENG', 'Plumber', ['Plumbing'], 1, 'ROT4'],
    ['HK', 'Housekeeping Supervisor', [], 1, 'GEN'], ['HK', 'Housekeeping Associate', [], 13, 'ROT2', 'VEN-HKC'], ['SEC', 'Security Supervisor', [], 1, 'GEN'], ['SEC', 'Security Guard', [], 11, 'ROT3', 'VEN-SEC'],
    ['HD', 'Helpdesk Executive', [], 2, 'ROT2'], ['HSE', 'HSE Officer', ['Safety'], 1, 'GEN'], ['ADM', 'Storekeeper', [], 1, 'GEN'], ['FM', 'Property Manager', [], 1, 'GEN'], ['FM', 'Facility Executive', [], 1, 'GEN'],
  ];
  const emps = [];
  const count = {};
  for (const [dc, designation, skills, n, pattern, vend] of SPEC) {
    for (let i = 0; i < n; i++) {
      count[dc] = (count[dc] || 0) + 1;
      emps.push(new M.Employee({ ...P, code: `PG-${dc}-${String(count[dc]).padStart(3, '0')}`, name: `${pick(FIRST)} ${pick(LAST)}`, departmentId: dept[dc]._id, designation, skills, employmentType: vend ? 'contract' : 'permanent', contractorVendorId: vend ? vendor[vend]._id : undefined, shiftGroup: pattern, mobile: `9${String(800000000 + emps.length * 7717).slice(0, 9)}`, joiningDate: istAt(addDays(today, -int(60, 900))), status: 'active' }));
    }
  }
  const byDesig = (d) => emps.filter((e) => e.designation === d);
  const pm = byDesig('Property Manager')[0];
  const heads = { ENG: byDesig('Engineering Supervisor')[0], HK: byDesig('Housekeeping Supervisor')[0], SEC: byDesig('Security Supervisor')[0], HSE: byDesig('HSE Officer')[0], HD: pm, ADM: pm, FM: pm };
  const codeOf = new Map(depts.map((d) => [String(d._id), d.code]));
  for (const e of emps) {
    const h = heads[codeOf.get(String(e.departmentId))];
    if (!e._id.equals(pm._id)) e.supervisorId = h && !h._id.equals(e._id) ? h._id : pm._id;
  }
  pm.name = 'Kavitha Rao';
  const users = [
    new M.User({ email: 'pm.mall@primespace.demo', name: pm.name, passwordHash, roleIds: [role.property_manager], propertyIds: [property._id], departmentIds: [dept.FM._id], employeeId: pm._id, isDemo: true }),
    new M.User({ email: 'mall.supervisor@primespace.demo', name: heads.ENG.name, passwordHash, roleIds: [role.supervisor], propertyIds: [property._id], departmentIds: [dept.ENG._id], employeeId: heads.ENG._id, isDemo: true }),
    ...emps.filter((e) => e.departmentId.equals(dept.ENG._id) && e !== heads.ENG).map((e) => new M.User({ email: `${e.code.toLowerCase()}@primespace.demo`, name: e.name, passwordHash, roleIds: [role.technician], propertyIds: [property._id], departmentIds: [dept.ENG._id], employeeId: e._id })),
  ];
  users.forEach((u) => { const e = emps.find((x) => x._id.equals(u.employeeId)); if (e) e.userId = u._id; });
  await M.Employee.insertMany(emps);
  await M.User.insertMany(users);
  const techs = users.filter((u) => u.roleIds.some((r) => r.equals(role.technician)));

  const ROT = { ROT4: ['A', 'B', 'C', 'GEN'], ROT3: ['A', 'B', 'C'], ROT2: ['A', 'B'] };
  const rosters = [];
  for (let d = -30; d <= 6; d++) {
    const date = addDays(today, d);
    const dow = istAt(date, '12:00').getUTCDay();
    const week = Math.floor((istAt(date, '12:00') / DAY_MS + 3) / 7);
    emps.forEach((e, idx) => {
      const off = e.shiftGroup === 'GEN' ? dow === 0 : dow === (idx * 3) % 7;
      const code = ROT[e.shiftGroup] ? ROT[e.shiftGroup][(idx + week) % ROT[e.shiftGroup].length] : e.shiftGroup;
      rosters.push({ ...P, employeeId: e._id, departmentId: e.departmentId, date, shiftId: off ? null : shift[code]._id, isWeeklyOff: off, published: true });
    });
  }
  await M.Roster.insertMany(rosters);
  for (let d = -30; d <= 0; d++) await simulateAttendance(property, d < 0 ? new Date(Math.min(+istAt(addDays(today, d + 1), '07:00'), +now)) : now);

  const assets = [];
  const A = (code, name, cat, locCode, criticality, extra = {}) => { const a = new M.Asset({ ...P, code, name, categoryId: acats[cat]._id, locationId: loc[locCode]._id, departmentId: dept.ENG._id, criticality, status: 'running', installDate: istAt(addDays(today, -int(400, 1500))), ...extra }); a.$locals.cat = cat; assets.push(a); };
  A('PG-DG-01', 'Diesel generator 1 (1000 kVA)', 'DG', 'PGM-UTIL', 'critical', { capacity: '1000 kVA', runHours: 640 });
  A('PG-DG-02', 'Diesel generator 2 (1000 kVA)', 'DG', 'PGM-UTIL', 'critical', { capacity: '1000 kVA', runHours: 702 });
  A('PG-CH-01', 'Air-cooled chiller 1 (400 TR)', 'CHILLER', 'PGM-UTIL', 'critical', { capacity: '400 TR' });
  A('PG-CH-02', 'Air-cooled chiller 2 (400 TR)', 'CHILLER', 'PGM-UTIL', 'critical', { capacity: '400 TR' });
  for (const fc of ['LG', 'G', 'F1', 'F2', 'F3']) for (const w of ['N', 'S']) A(`PG-AHU-${fc}-${w}`, `AHU ${fc} ${w === 'N' ? 'North' : 'South'}`, 'AHU', `PGM-${fc}-${w}`, 'high', { capacity: '15000 CFM' });
  for (let i = 1; i <= 4; i++) A(`PG-LIFT-0${i}`, `Passenger lift ${i}`, 'LIFT', 'PGM-G-ATR', 'high', { capacity: '16 persons' });
  for (let i = 1; i <= 6; i++) A(`PG-ESC-0${i}`, `Escalator ${i}`, 'LIFT', `PGM-${['G', 'F1', 'F2'][i % 3]}-ATR`, 'high', { status: i === 4 ? 'breakdown' : 'running' });
  A('PG-TR-01', 'Transformer 1 (1600 kVA)', 'TRANSFORMER', 'PGM-UTIL', 'critical');
  A('PG-TR-02', 'Transformer 2 (1600 kVA)', 'TRANSFORMER', 'PGM-UTIL', 'critical');
  for (const c of ['PUMP', 'HYD', 'FAP']) A(`PG-FIRE-${c}`, `Fire ${c === 'PUMP' ? 'pump set' : c === 'HYD' ? 'hydrant system' : 'alarm panel'}`, 'FIRE', 'PGM-BSMT', 'critical');
  await M.Asset.insertMany(assets);

  const FREQ = { DG: 'weekly', CHILLER: 'monthly', AHU: 'monthly', TRANSFORMER: 'quarterly', LIFT: 'monthly', FIRE: 'monthly' };
  const schedules = [];
  const history = [];
  assets.forEach((a, i) => {
    const cat = a.$locals.cat;
    const freq = FREQ[cat];
    const offsets = freq === 'weekly' ? [0, 7, 14, 21].map((k) => -(1 + (i % 7) + k)) : freq === 'monthly' ? [-(1 + ((i * 5) % 28))] : [-(4 + i)];
    const tech = techs[i % techs.length];
    const s = new M.PpmSchedule({ ...P, title: `${tpls[cat].name} – ${a.code}`, assetId: a._id, templateId: tpls[cat]._id, frequency: freq, departmentId: dept.ENG._id, assigneeIds: [tech._id], startDate: istAt(addDays(today, -365)), nextDueDate: addFreq(istAt(addDays(today, Math.max(...offsets)), '00:00'), freq), active: true });
    schedules.push(s);
    offsets.forEach((o) => history.push({ s, a, cat, tech, planned: istAt(addDays(today, o), '00:00') }));
  });
  await M.PpmSchedule.insertMany(schedules);
  const missed = new Set(history.map((_, i) => i).sort(() => rand() - 0.5).slice(0, Math.round(history.length * 0.12)));
  await M.WorkOrder.insertMany(history.map((h, i) => {
    const done = !missed.has(i);
    const at = new Date(+h.planned + int(10, 15) * H);
    return { ...P, number: num('WO'), type: 'ppm', title: h.s.title, assetId: h.a._id, scheduleId: h.s._id, locationId: h.a.locationId, departmentId: dept.ENG._id, assigneeIds: [h.tech._id], status: done ? 'verified' : 'assigned', priority: 'P3', plannedDate: h.planned, completedAt: done ? at : undefined, verifiedAt: done ? at : undefined, checklist: tpls[h.cat].items.map((it) => ({ ...it.toObject(), _id: undefined, value: done ? (it.type === 'yesno' ? true : undefined) : undefined })) };
  }));

  const rules = Object.fromEntries(slaPolicy.rules.map((r) => [r.priority, r]));
  const cat = Object.fromEntries(tcats.map((c) => [c.code, c]));
  const MIX = ['HVAC', 'HVAC', 'HVAC', 'ELEC', 'ELEC', 'PLUMB', 'HK', 'HK', 'HK', 'SEC', 'LIFT', 'CIVIL'];
  const tickets = [];
  for (let i = 0; i < 60; i++) {
    const code = pick(MIX);
    const c = cat[code];
    const z = pick(zones);
    const pr = ['HVAC', 'LIFT', 'SEC'].includes(code) ? 'P2' : c.defaultPriority;
    const r = rules[pr];
    const createdAt = new Date(+now - int(26, 29 * 24) * H);
    const late = i % 10 === 3;
    const resolvedAt = new Date(+createdAt + (late ? r.resolutionMin + int(30, 200) : r.resolutionMin * (0.25 + rand() * 0.6)) * MIN);
    const t = new M.Ticket({ ...P, number: num('TKT'), source: 'helpdesk', categoryId: c._id, locationId: z._id, description: pick(['Area too warm', 'Lights not working in corridor', 'Washroom needs cleaning', 'Water leakage near store', 'Escalator making noise', 'Parking access issue']), priority: pr, suggestedPriority: pr, status: 'closed', assignedDeptId: dept[c.departmentCode]?._id || dept.FM._id, assigneeId: techs[i % techs.length]._id, closedAt: new Date(+resolvedAt + 3 * H), sla: { policyId: slaPolicy._id, startedAt: createdAt, responseDue: new Date(+createdAt + r.responseMin * MIN), resolutionDue: new Date(+createdAt + r.resolutionMin * MIN), respondedAt: new Date(+createdAt + r.responseMin * 0.5 * MIN), resolvedAt, pausedMin: 0, resolutionBreached: late }, tenantConfirmation: { status: 'confirmed', rating: late ? 3 : pick([4, 5]), at: resolvedAt }, history: [{ status: 'new', at: createdAt, byName: 'Helpdesk' }, { status: 'closed', at: resolvedAt, byName: 'System' }] });
    t.createdAt = createdAt;
    tickets.push(t);
  }
  const OPEN = [['LIFT', 'PGM-F1-ATR', 'Escalator 4 stopped with a jerk — cordoned off', 'P1', 'in_progress', 70], ['HVAC', 'PGM-F3-FC', 'Food court too warm during lunch hours', 'P2', 'assigned', 90], ['HK', 'PGM-G-ATR', 'Spillage near the atrium fountain', 'P4', 'new', 15], ['ELEC', 'PGM-BSMT', 'Basement lights flickering in zone B2', 'P3', 'acknowledged', 200], ['PLUMB', 'PGM-F2-S', 'Washroom flush not working', 'P3', 'in_progress', 300], ['SEC', 'PGM-BSMT', 'Boom barrier at exit gate stuck open', 'P2', 'acknowledged', 45], ['HVAC', 'PGM-LG-N', 'AHU noise near the hypermarket entrance', 'P3', 'new', 30], ['CIVIL', 'PGM-F1-N', 'Floor tile cracked outside Tech Galaxy', 'P4', 'assigned', 900], ['HK', 'PGM-F3-FC', 'Garbage not cleared at food court', 'P4', 'new', 25]];
  for (const [code, lc, description, pr, status, age] of OPEN) {
    const c = cat[code];
    const r = rules[pr];
    const createdAt = new Date(+now - age * MIN);
    const t = new M.Ticket({ ...P, number: num('TKT'), source: 'helpdesk', categoryId: c._id, locationId: loc[lc]._id, assetId: code === 'LIFT' ? assets.find((a) => a.code === 'PG-ESC-04')._id : undefined, description, priority: pr, suggestedPriority: pr, status, assignedDeptId: dept[c.departmentCode]?._id || dept.FM._id, assigneeId: status === 'new' ? undefined : techs[0]._id, escalationLevel: age / (r.resolutionMin) >= 0.75 ? 1 : 0, sla: { policyId: slaPolicy._id, startedAt: createdAt, responseDue: new Date(+createdAt + r.responseMin * MIN), resolutionDue: new Date(+createdAt + r.resolutionMin * MIN), respondedAt: ['acknowledged', 'in_progress'].includes(status) ? new Date(+createdAt + Math.min(r.responseMin, age) * 0.5 * MIN) : undefined, pausedMin: 0, responseBreached: status === 'new' && age > r.responseMin }, history: [{ status: 'new', at: createdAt, byName: 'Helpdesk' }] });
    t.createdAt = createdAt;
    tickets.push(t);
  }
  await M.Ticket.insertMany(tickets);

  const store = await M.Store.create({ ...P, name: 'Mall Store', code: 'MALL', type: 'main' });
  const lowNames = new Set(['LED tube 20W', 'Floor cleaner 5 L', 'Garbage bags large (pack)']);
  const stockItems = itemDocs.filter((it) => ['electrical_spares', 'housekeeping', 'chemicals', 'hvac_filters'].includes(it.category)).slice(0, 18);
  await M.StockBalance.insertMany(stockItems.map((it) => { const qty = lowNames.has(it.name) ? Math.max(1, it.reorderLevel - 2) : it.reorderLevel + int(4, 20); return { ...P, storeId: store._id, itemId: it._id, qty, value: qty * it.unitCost }; }));
  await M.StockLedger.insertMany(stockItems.map((it) => ({ ...P, storeId: store._id, itemId: it._id, type: 'opening', qty: lowNames.has(it.name) ? Math.max(1, it.reorderLevel - 2) : 10, rate: it.unitCost, refType: 'opening', balanceAfter: 10, at: istAt(addDays(today, -35)) })));

  const lifts = assets.filter((a) => a.code.startsWith('PG-LIFT') || a.code.startsWith('PG-ESC'));
  await M.Amc.create({ ...P, name: 'Lift & escalator AMC', vendorId: vendor['VEN-LFT']._id, assetIds: lifts.map((a) => a._id), type: 'comprehensive', visitFrequency: 'monthly', start: istAt(addDays(today, -315)), end: istAt(addDays(today, 50)), value: 1080000, status: 'expiring' });
  await M.ReportSchedule.create({ ...P, type: 'daily', time: '08:00', recipients: ['mall.reports@primegalleria.example'], sendOnSignOff: true });

  const snaps = [];
  for (let d = -30; d <= -1; d++) {
    const w = Math.sin(d / 4);
    const v = { attendance: 92 + w * 1.5, sla: 90.5 + w * 1.5, ppm: 88 + w * 2, open_complaints: Math.round(9 + w * 3), critical_complaints: int(0, 2), amc_due: 0, inventory_alerts: int(2, 4), hse_incidents: 0 };
    const target = { attendance: 95, sla: 95, ppm: 95, open_complaints: 20, critical_complaints: 0, amc_due: 0, inventory_alerts: 0, hse_incidents: 0 };
    snaps.push({ ...P, date: addDays(today, d), values: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { actual: Math.round(x * 10) / 10, target: target[k], variance: Math.round((x - target[k]) * 10) / 10 }])) });
  }
  await M.KpiSnapshot.insertMany(snaps);
  await M.Notification.insertMany(users.filter((u) => u.isDemo).map((u) => ({ userId: u._id, propertyId: property._id, type: 'welcome', title: 'Welcome to Prime Galleria Mall on PrimeSpace IPFM', link: '/help' })));
  return { property, users: users.length, employees: emps.length, assets: assets.length, tickets: tickets.length };
}
