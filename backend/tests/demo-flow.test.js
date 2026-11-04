// End-to-end check of the slide-14 live demo against a running API on freshly seeded data.
// Usage: npm run seed && npm run dev   (in another terminal)   then: npm run test:demo
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import 'dotenv/config';

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 5080}/api/v1`;
const tokens = {};

async function login(key, email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: email, password: 'Demo@123' }) });
  const j = await r.json();
  assert.ok(j.success, `login ${email}: ${j.error?.message}`);
  tokens[key] = j.data.accessToken;
  return j.data.user;
}

async function call(who, method, path, body, headers = {}) {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  return { status: r.status, ...j };
}
const get = (who, path) => call(who, 'GET', path);
const post = (who, path, body) => call(who, 'POST', path, body);
const kpi = async () => Object.fromEntries((await get('pm', '/dashboard/kpis')).data.tiles.map((t) => [t.code, t.actual]));

const users = {};
const ctx = {};

before(async () => {
  for (const [k, e] of Object.entries({ tenant: 'tenant', helpdesk: 'helpdesk', sup: 'eng.supervisor', tech: 'hvac.tech', store: 'store', pm: 'pm', admin: 'admin' })) users[k] = await login(k, `${e}@primespace.demo`);
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/primespace_ipfm');
});
after(() => mongoose.disconnect());

test('dashboard shows the slide-11 figures on seeded data', async () => {
  const k = await kpi();
  ctx.baseline = k;
  assert.ok(Math.abs(k.attendance - 94) <= 1.5, `attendance ${k.attendance}`);
  assert.equal(Math.round(k.sla), 96);
  assert.equal(Math.round(k.ppm), 92);
  assert.equal(k.open_complaints, 18);
  assert.equal(k.critical_complaints, 2);
  assert.equal(k.amc_due, 3);
  assert.equal(k.inventory_alerts, 5);
  assert.equal(k.hse_incidents, 1);
});

test('1–2. tenant raises "AHU not cooling" on AHU-A-05; P2 suggested, SLA clocks start', async () => {
  const [loc, asset, cat] = await Promise.all([get('tenant', '/locations?search=PTP-A-05-EW'), get('tenant', '/assets?search=AHU-A-05'), get('tenant', '/ticket-categories?search=HVAC')]);
  ctx.asset = asset.data[0];
  const r = await post('tenant', '/tickets', { categoryId: cat.data[0]._id, locationId: loc.data[0]._id, assetId: ctx.asset._id, description: 'AHU not cooling — floor is very warm', subCategory: 'Not cooling' });
  assert.equal(r.status, 201, r.error?.message);
  assert.match(r.data.number, /^TKT-PTP-\d{4}-\d{6}$/);
  assert.equal(r.data.priority, 'P2');
  assert.equal(r.data.source, 'tenant_portal');
  assert.ok(r.data.sla.responseDue && r.data.sla.resolutionDue);
  ctx.ticket = r.data;
  const noReason = await call('helpdesk', 'PATCH', `/tickets/${ctx.ticket._id}/priority`, { priority: 'P1' });
  assert.equal(noReason.status, 400, 'priority override needs a reason');
});

test('3. supervisor sees the HVAC technician first and assigns; WO created; technician acknowledges', async () => {
  const techs = await get('sup', `/tickets/${ctx.ticket._id}/technicians`);
  const demoTech = techs.data.find((x) => x._id === users.tech._id);
  assert.ok(demoTech?.skillMatch && demoTech.onShift, 'HVAC technician listed as skill match and on shift');
  const cmp = (a, b) => (b.skillMatch - a.skillMatch) || (b.onShift - a.onShift) || (a.openJobs - b.openJobs);
  for (let i = 1; i < techs.data.length; i++) assert.ok(cmp(techs.data[i - 1], techs.data[i]) <= 0, 'sorted by skill, shift, load');
  const denied = await post('tech', `/tickets/${ctx.ticket._id}/assign`, { assigneeId: users.tech._id });
  assert.equal(denied.status, 403, 'technician cannot assign');
  const a = await post('sup', `/tickets/${ctx.ticket._id}/assign`, { assigneeId: users.tech._id });
  assert.equal(a.data.status, 'assigned');
  assert.ok(a.data.workOrderId);
  ctx.woId = a.data.workOrderId;
  const ack = await post('tech', `/tickets/${ctx.ticket._id}/acknowledge`);
  assert.equal(ack.data.status, 'acknowledged');
  assert.equal(ack.data.sla.responseBreached, false);
  assert.equal((await post('tech', `/tickets/${ctx.ticket._id}/start`)).data.status, 'in_progress');
});

test('4. parts requested and issued against the WO; ledger updates; reorder alert fires', async () => {
  const [stores, filter, belt] = await Promise.all([get('store', '/stores?search=Engineering'), get('tech', '/items?search=AHU pre-filter'), get('tech', '/items?search=V-belt B-52')]);
  const req = await post('tech', '/material-issues', { storeId: stores.data[0]._id, workOrderId: ctx.woId, items: [{ itemId: filter.data[0]._id, qty: 2 }, { itemId: belt.data[0]._id, qty: 1 }] });
  assert.equal(req.status, 201, req.error?.message);
  const issued = await post('store', `/material-issues/${req.data._id}/issue`);
  assert.equal(issued.data.status, 'issued');
  const ledger = await get('store', `/stock/ledger?itemId=${filter.data[0]._id}`);
  assert.equal(ledger.data[0].type, 'issue');
  assert.equal(ledger.data[0].balanceAfter, 6);
  const tooMuch = await post('store', '/stock/adjust', { storeId: stores.data[0]._id, itemId: filter.data[0]._id, qty: -999, reason: 'test negative stock' });
  assert.equal(tooMuch.status, 409, 'stock can never go negative');
});

test('5. technician completes with evidence; supervisor verifies; ticket Resolved', async () => {
  const wo = await get('tech', `/work-orders/${ctx.woId}`);
  assert.ok(wo.data.partsUsed.length === 2);
  const incomplete = await post('tech', `/work-orders/${ctx.woId}/complete`, { findings: 'x' });
  assert.equal(incomplete.status, 400);
  const done = await post('tech', `/work-orders/${ctx.woId}/complete`, {
    checklist: wo.data.checklist.map((c) => ({ value: c.type === 'yesno' ? true : c.type === 'text' ? 'Clogged filter and worn V-belt' : 15 })),
    findings: 'Clogged pre-filter and worn V-belt replaced; supply air back to 14 °C.',
    beforePhotos: ['/uploads/demo-before.jpg'], afterPhotos: ['/uploads/demo-after.jpg'], signature: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.equal(done.data.status, 'completed', done.error?.message);
  const v = await post('sup', `/tickets/${ctx.ticket._id}/verify`);
  assert.equal(v.data.status, 'resolved');
  assert.equal(v.data.sla.resolutionBreached, false);
});

test('6. tenant confirms with a rating; ticket closes; asset history and KPIs update', async () => {
  const c = await post('tenant', `/tickets/${ctx.ticket._id}/confirm`, { accept: true, rating: 5, comment: 'Cooling restored, thanks!' });
  assert.equal(c.data.status, 'closed');
  const again = await post('tenant', `/tickets/${ctx.ticket._id}/confirm`, { accept: true, rating: 5 });
  assert.equal(again.status, 409, 'illegal transition returns 409');
  const hist = await get('pm', `/assets/${ctx.asset._id}/history`);
  const ev = hist.data.events.find((e) => e.title.startsWith('WO-') && e.kind === 'breakdown' && e.cost > 0);
  assert.ok(ev, 'breakdown with parts cost on the asset timeline');
  assert.ok(ev.downtimeMin >= 0);
  const k = await kpi();
  assert.equal(k.open_complaints, ctx.baseline.open_complaints);
  assert.equal(k.inventory_alerts, ctx.baseline.inventory_alerts + 1);
});

test('access control: tenant cannot read work orders; other property is off limits', async () => {
  assert.equal((await get('tenant', '/work-orders')).status, 403);
  const p = await post('admin', '/properties', { name: 'Isolation Test Mall', code: `ISO${Date.now() % 10000}`, type: 'mall' });
  assert.equal(p.status, 201, p.error?.message);
  const r = await call('pm', 'GET', '/tickets', null, { 'X-Property-Id': p.data._id });
  assert.equal(r.status, 403);
  await call('admin', 'DELETE', `/properties/${p.data._id}`);
});

test('7. breach path: 75% warns the supervisor, 100% escalates to PM, 150% to the owner', async () => {
  const cat = await get('helpdesk', '/ticket-categories?search=Plumbing');
  const loc = await get('helpdesk', '/locations?search=PTP-C-04-CORE');
  const t = (await post('helpdesk', '/tickets', { categoryId: cat.data[0]._id, locationId: loc.data[0]._id, description: 'Breach path test: washroom tap leaking' })).data;
  const Tickets = mongoose.connection.db.collection('tickets');
  const shift = async (pct) => {
    const span = new Date(t.sla.resolutionDue) - new Date(t.sla.startedAt);
    const start = new Date(Date.now() - span * pct);
    await Tickets.updateOne({ _id: new mongoose.Types.ObjectId(t._id) }, { $set: { 'sla.startedAt': start, 'sla.respondedAt': start, 'sla.responseDue': new Date(+start + 60000), 'sla.resolutionDue': new Date(+start + span) } });
    await post('pm', '/admin/jobs/sla-monitor/run');
    return (await get('pm', `/tickets/${t._id}`)).data;
  };
  assert.equal((await shift(0.8)).escalationLevel, 1);
  const l2 = await shift(1.1);
  assert.equal(l2.escalationLevel, 2);
  assert.equal(l2.sla.resolutionBreached, true);
  assert.equal((await shift(1.6)).escalationLevel, 3);
  const notes = await get('sup', '/notifications');
  assert.ok(notes.data.some((n) => n.type === 'sla_warning' && n.title.includes(t.number)));
  await post('helpdesk', `/tickets/${t._id}/cancel`, { reason: 'test cleanup' });
});

// ── Security, field and integration features ──
import { fenceCheck } from '../src/modules/attendance.js';

const BASE = API.replace(/\/api\/v1$/, '');

test('files: uploads are only served through a valid signed link', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([Buffer.from('not-really-a-jpeg')], { type: 'image/jpeg' }), 'evidence.jpg');
  const up = await (await fetch(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.tech}` }, body: fd })).json();
  const url = up.data[0].url;
  assert.match(url, /^\/uploads\/[a-f0-9]{32}\.jpg\?exp=\d+&sig=[\w-]+$/);
  assert.equal((await fetch(BASE + url)).status, 200);
  assert.equal((await fetch(BASE + url.split('?')[0])).status, 403, 'no signature');
  assert.equal((await fetch(BASE + url.replace(/sig=[\w-]{4}/, 'sig=AAAA'))).status, 403, 'tampered signature');
});

test('daily log sheet: completing a check closes it and stores the readings', async () => {
  const sheet = await get('pm', '/work-orders/log-sheet');
  assert.ok(sheet.data.rows.length >= 11, 'one row per DG, chiller and transformer');
  const wo = sheet.data.rows.find((r) => r.status !== 'closed');
  const done = await post('pm', `/work-orders/${wo._id}/complete`, { checklist: wo.checklist.map((c) => ({ value: c.type === 'yesno' ? true : c.min != null ? (c.min + c.max) / 2 : 1500 })) });
  assert.equal(done.data.status, 'closed', done.error?.message);
  const readings = await get('pm', `/assets/${wo.assetId._id}/meter-readings`);
  assert.ok(readings.data.some((r) => r.workOrderId === wo._id && r.label), 'readings linked to the log sheet');
});

test('offline check-out keeps the time it really happened and is flagged', async () => {
  const open = (await get('tech', '/attendance/my')).data.open;
  const checkedIn = +new Date(open.checkIn.time);
  const t = new Date(checkedIn + (Date.now() - 3 * 60000 - checkedIn) / 2).toISOString(); // between check-in and now
  const r = await post('tech', '/attendance/check-out', { lat: 17.4476, lng: 78.3765, clientTime: t });
  assert.equal(r.status, 200, r.error?.message);
  assert.equal(new Date(r.data.checkOut.time).toISOString(), t);
  assert.equal(r.data.checkOut.offline, true);
});

test('approval rules: a purchase request above Rs 1,00,000 also needs the owner', async () => {
  const item = (await get('pm', '/items?search=Refrigerant')).data[0];
  const big = await post('pm', '/purchase-requests', { items: [{ itemId: item._id, qty: 20, rate: 9800 }], reason: 'Approval rule test' });
  assert.deepEqual(big.data.approvalLevels, ['supervisor', 'property_manager', 'owner']);
  const small = await post('pm', '/purchase-requests', { items: [{ itemId: item._id, qty: 1, rate: 9800 }], reason: 'Approval rule test' });
  assert.deepEqual(small.data.approvalLevels, ['supervisor', 'property_manager']);
});

test('PDFs: client report and purchase order download as real PDFs', async () => {
  const paths = [`/reports/${(await get('pm', '/reports?limit=1')).data[0]._id}/pdf`, `/purchase-orders/${(await get('pm', '/purchase-orders?limit=1')).data[0]._id}/pdf`];
  for (const path of paths) {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tokens.pm}` } });
    assert.equal(r.headers.get('content-type'), 'application/pdf', path);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF', path);
  }
});

test('signing off a scheduled report emails it as a PDF and marks it sent', async () => {
  const rep = await post('pm', '/reports/generate', { type: 'daily' });
  const r = await post('pm', `/reports/${rep.data._id}/transition`, { to: 'signed_off' });
  assert.equal(r.data.status, 'sent', r.error?.message);
  assert.match(r.data.history.at(-1).note, /PDF/);
});

test('public API: scoped keys, BMS alarm to ticket with de-duplication, revocation', async () => {
  const k = await post('pm', '/api-keys', { name: 'BMS test', scopes: ['assets:read', 'tickets:write', 'kpis:read'] });
  assert.match(k.data.key, /^ps_[a-f0-9]{48}$/);
  const pub = (method, path, body) => fetch(`${API}/public${path}`, { method, headers: { 'X-API-Key': k.data.key, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  assert.equal((await pub('GET', '/assets/DG-01')).data.code, 'DG-01');
  const alarm = await pub('POST', '/assets/CH-02/alarms', { description: 'High condenser pressure', alarmCode: 'HP-01' });
  assert.equal(alarm.status, 201, alarm.error?.message);
  assert.match(alarm.data.number, /^TKT-PTP-/);
  assert.equal((await pub('POST', '/assets/CH-02/alarms', { description: 'High condenser pressure', alarmCode: 'HP-01' })).data.duplicate, true);
  assert.equal((await pub('GET', '/stock')).status, 403, 'scope not granted');
  assert.equal((await pub('GET', '/kpis')).data.length, 8);
  await call('pm', 'DELETE', `/api-keys/${k.data._id}`);
  assert.equal((await pub('GET', '/assets/DG-01')).status, 401, 'revoked');
});

test('email-to-ticket: known senders get a ticket, unknown senders are ignored', async () => {
  const send = (body) => fetch(`${API}/inbound/email?token=${process.env.INBOUND_EMAIL_TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const good = await send({ from: 'Neha Gupta <tenant@primespace.demo>', subject: 'Water leaking from pantry tap', text: 'Please send someone today.' });
  assert.equal(good.status, 201, good.error?.message);
  assert.equal(good.data.category, 'PLUMB');
  assert.equal((await send({ from: 'stranger@example.com', subject: 'Hello', text: 'x' })).data.accepted, false);
});

test('geo-fence: polygon boundary is saved and used for inside/outside', async () => {
  const pid = users.pm.properties[0]._id;
  const poly = [[17.4466, 78.3752], [17.4484, 78.3752], [17.4484, 78.3774], [17.4466, 78.3774]];
  const r = await call('pm', 'PUT', `/properties/${pid}/geofence`, { type: 'polygon', polygon: poly, policy: 'flag' });
  assert.equal(r.data.geoFence.type, 'polygon', r.error?.message);
  assert.equal(fenceCheck(r.data.geoFence, 17.4475, 78.3763).inside, true);
  assert.equal(fenceCheck(r.data.geoFence, 17.45, 78.38).inside, false);
  await call('pm', 'PUT', `/properties/${pid}/geofence`, { type: 'circle', lat: 17.4474, lng: 78.3762, radiusM: 300, policy: 'flag' });
});

test('comments: @mentions notify the person mentioned', async () => {
  const wo = (await get('pm', '/work-orders?view=open&limit=1')).data[0];
  const c = await post('pm', '/comments', { entity: 'WorkOrder', entityId: wo._id, text: '@Suresh please check this', mentions: [users.sup._id] });
  assert.equal(c.status, 201, c.error?.message);
  assert.ok((await get('sup', '/notifications')).data.some((n) => n.type === 'comment' && n.title.includes('mentioned you')));
});

test('push: the server publishes a VAPID key', async () => {
  assert.ok((await get('tech', '/push/key')).data.publicKey.length > 60);
});

test('self-service attendance: any employee-linked login can check in; a login with no employee record cannot', async () => {
  const my = await get('helpdesk', '/attendance/my');
  assert.equal(my.status, 200, 'helpdesk executive opens My check-in');
  assert.equal(my.data.linked, true);
  const fence = my.data.property.geoFence;
  const r = await post('helpdesk', '/attendance/check-in', { lat: fence.lat, lng: fence.lng, accuracy: 10 });
  assert.ok([200, 409].includes(r.status), `check-in allowed (got ${r.status}: ${r.error?.message})`);
  assert.equal((await post('tenant', '/attendance/check-in', { lat: fence.lat, lng: fence.lng })).status, 403, 'tenant has no employee record');
});

test('managing logins: a PM links a vendor user to its vendor but cannot grant another property', async () => {
  const props = (await get('admin', '/properties')).data;
  const own = props.find((p) => p.code === 'PTP');
  const other = props.find((p) => p.code === 'PGM');
  const role = (await get('pm', '/roles')).data.find((r) => r.key === 'vendor');
  const vendor = (await get('pm', '/vendors')).data[0];
  const body = { name: 'Test Vendor User', email: `vendor.test.${Date.now()}@example.com`, password: 'Vendor@123', roleIds: [role._id], vendorId: vendor._id };
  assert.equal((await post('pm', '/users', { ...body, propertyIds: [other._id] })).status, 403, 'other property refused');
  const ok = await post('pm', '/users', { ...body, propertyIds: [own._id] });
  assert.equal(ok.status, 201, ok.error?.message);
  assert.equal(String(ok.data.vendorId?._id || ok.data.vendorId), vendor._id);
});
