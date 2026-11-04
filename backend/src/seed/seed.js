import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import * as M from '../models/index.js';
import { SYSTEM_ROLES } from '../constants/permissions.js';
import { connectDb } from '../config/db.js';
import { als, istDate, istAt, addDays, DAY_MS } from '../lib/context.js';
import { slaProgress } from '../lib/sla.js';
import { simulateAttendance } from './simulate.js';
import { generatePpm, addFreq } from '../modules/workorders.js';
import { generateReport } from '../modules/reports.js';
import { todaySummary } from '../modules/attendance.js';
import { logger } from '../lib/logger.js';
import { DEFAULT_APPROVAL_RULES } from '../lib/approvals.js';
import { seedMall } from './mall.js';

const PASSWORD = 'Demo@123';
const H = 36e5;
const MIN = 6e4;
let state = 42;
const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

const FIRST = ['Ravi', 'Suresh', 'Anil', 'Kiran', 'Prakash', 'Venkat', 'Srinivas', 'Mahesh', 'Ramesh', 'Naveen', 'Arjun', 'Vikram', 'Rahul', 'Sandeep', 'Manoj', 'Rajesh', 'Harish', 'Ganesh', 'Sunil', 'Ajay', 'Lakshmi', 'Priya', 'Swathi', 'Divya', 'Kavya', 'Anitha', 'Padma', 'Sravani', 'Deepika', 'Meena', 'Shilpa', 'Bhavani', 'Rekha', 'Sunitha', 'Madhavi', 'Pooja', 'Farhan', 'Imran', 'Salman', 'Joseph'];
const LAST = ['Reddy', 'Rao', 'Kumar', 'Naidu', 'Sharma', 'Varma', 'Goud', 'Yadav', 'Chowdary', 'Shaik', 'Patel', 'Singh', 'Nair', 'Iyer', 'Prasad', 'Babu', 'Mohammed', 'Das', 'Pillai', 'Joshi'];

const GO_LIVE = [
  [1, 'Property, locations and departments set up', true], [1, 'Users and roles created', true], [1, 'Masters imported (employees, assets, items, vendors)', true],
  [2, 'Attendance, helpdesk, PPM and inventory live', true], [2, 'Tenant portal launched to all tenants', true], [3, 'HSE, KPI dashboard and client reports live', true],
  [4, 'UAT signed off by the Property Manager', false], [4, 'KPI baseline captured (first 30 days)', false], [5, 'First monthly review with the client', false],
].map(([phase, task, done]) => ({ phase, task, done }));

const SOPS = [
  ['AHU filter cleaning and belt replacement', 'ENG', '1. Raise a permit if working above 2 m.\n2. Switch off the AHU at the local isolator and lock it out.\n3. Remove pre-filters, clean with compressed air or water; replace if torn.\n4. Check belt tension (10–15 mm deflection) and wear; replace worn belts as a matched set.\n5. Clean the drain pan and check the condensate line.\n6. Restart, check supply air temperature (12–18 °C) and motor current.\n7. Record readings and before/after photos in the work order.'],
  ['DG start-up and weekly no-load test', 'ENG', '1. Check fuel, lube oil and coolant levels.\n2. Check battery voltage (24–28.5 V).\n3. Start the DG on no load for 10 minutes.\n4. Record oil pressure (40–60 psi), coolant temperature and run hours.\n5. Report any abnormal noise, smoke or leaks immediately.'],
  ['Chiller start and stop sequence', 'ENG', '1. Start condenser water pump, then cooling tower fans.\n2. Start chilled water pump and confirm flow.\n3. Start the chiller from the panel; watch leaving water temperature (6–8 °C).\n4. To stop: chiller first, then pumps after 10 minutes.'],
  ['Fire alarm response', 'HSE', '1. Acknowledge the panel and identify the zone.\n2. Send the nearest guard and fire technician to verify.\n3. If real: raise the alarm, call 101, start evacuation, inform the PM.\n4. If false: reset after the cause is cleared and log in the occurrence book.'],
  ['Restroom cleaning standard', 'HK', '1. Place the wet-floor sign.\n2. Clean in order: mirrors, basins, urinals, WCs, floor.\n3. Refill soap, tissue and toilet rolls.\n4. Sign the restroom checklist on the door.'],
  ['Security occurrence book entries', 'SEC', 'Record every event with time, location, people involved and action taken. Hand over the book at each shift change with open items highlighted.'],
];

const TEMPLATES = {
  AHU: ['AHU monthly PPM', 0, [['Pre-filter clean and intact', 'yesno'], ['Belt tension and wear OK', 'yesno'], ['Supply air temperature', 'number', 12, 18, '°C'], ['Motor current', 'reading', 5, 18, 'A'], ['Drain pan clear, no stagnant water', 'yesno'], ['Photo of filter after cleaning', 'photo']]],
  DG: ['DG weekly PPM', 1, [['Lube oil pressure', 'number', 40, 60, 'psi'], ['Coolant temperature', 'number', 70, 95, '°C'], ['Battery voltage', 'number', 24, 28.5, 'V'], ['Fuel level', 'reading', 40, 100, '%'], ['10-minute no-load run completed', 'yesno']]],
  CHILLER: ['Chiller monthly PPM', 2, [['Leaving chilled water temperature', 'number', 6, 8, '°C'], ['Condenser pressure', 'number', 120, 180, 'psi'], ['Compressor oil level OK', 'yesno'], ['Current per phase', 'reading', 200, 450, 'A']]],
  TRANSFORMER: ['Transformer quarterly PPM', null, [['Oil temperature', 'number', 30, 75, '°C'], ['Winding temperature', 'number', 30, 90, '°C'], ['Silica gel is blue', 'yesno'], ['Oil level OK', 'yesno']]],
  PUMP: ['Pump monthly PPM', null, [['Discharge pressure', 'number', 2, 6, 'bar'], ['No abnormal noise or vibration', 'yesno'], ['Gland leakage within limit', 'yesno']]],
  LIFT: ['Lift monthly PPM', null, [['Door operation smooth', 'yesno'], ['Alarm and intercom working', 'yesno'], ['Levelling accurate', 'yesno'], ['Machine room temperature', 'number', 15, 40, '°C']]],
  STP: ['STP weekly PPM', null, [['Inlet pH', 'number', 6.5, 8.5, 'pH'], ['MLSS', 'reading', 2500, 4000, 'mg/L'], ['Blowers running', 'yesno'], ['Treated water clear', 'yesno']]],
  FIRE: ['Fire system monthly PPM', 3, [['Jockey pump auto-start works', 'yesno'], ['Header pressure', 'number', 7, 10, 'kg/cm²'], ['Panel healthy, no faults', 'yesno'], ['Hydrant valves accessible', 'yesno']]],
};
const FREQ = { DG: 'weekly', CHILLER: 'monthly', AHU: 'monthly', TRANSFORMER: 'quarterly', PUMP: 'monthly', LIFT: 'monthly', STP: 'weekly', FIRE: 'monthly' };

const ITEMS = {
  electrical_spares: [['LED tube 20W', 'Nos', 180], ['LED panel 2x2 36W', 'Nos', 1450], ['MCB 32A DP', 'Nos', 420], ['MCB 16A SP', 'Nos', 210], ['Contactor 40A', 'Nos', 1850], ['Cable 2.5 sq mm (90 m coil)', 'Coil', 2650], ['Cable lug 16 sq mm', 'Nos', 12], ['Insulation tape', 'Roll', 25], ['Starter capacitor 50µF', 'Nos', 340], ['Fuse 63A HRC', 'Nos', 160], ['Ceiling fan regulator', 'Nos', 380], ['Emergency light battery', 'Nos', 650]],
  hvac_filters: [['AHU pre-filter 24x24x2', 'Nos', 950], ['AHU fine filter 24x24x12', 'Nos', 3200], ['V-belt B-52', 'Nos', 480], ['V-belt B-48', 'Nos', 450], ['Refrigerant R-410A (11.3 kg)', 'Cyl', 9800], ['Condensate drain pump', 'Nos', 4200], ['Bearing 6205 ZZ', 'Nos', 260], ['Fan motor capacitor 2.5µF', 'Nos', 140]],
  plumbing: [['PVC pipe 1 inch (3 m)', 'Nos', 320], ['CPVC elbow 1 inch', 'Nos', 35], ['Ball valve 1 inch', 'Nos', 410], ['Flush valve kit', 'Nos', 1650], ['Pillar tap', 'Nos', 890], ['Health faucet', 'Nos', 720], ['Teflon tape', 'Roll', 18], ['Bottle trap 32 mm', 'Nos', 540]],
  chemicals: [['Floor cleaner 5 L', 'Can', 640], ['Glass cleaner 5 L', 'Can', 520], ['Toilet cleaner 5 L', 'Can', 580], ['Disinfectant (QAC) 5 L', 'Can', 1150], ['STP bio-culture 1 kg', 'Kg', 1800], ['Chlorine tablets 1 kg', 'Kg', 420], ['Descaling chemical 20 L', 'Can', 3900], ['RO antiscalant 5 L', 'Can', 2100]],
  ppe: [['Safety helmet', 'Nos', 280], ['Nitrile gloves (box of 100)', 'Box', 690], ['Safety shoes (pair)', 'Pair', 1450], ['Reflective vest', 'Nos', 190], ['Ear plugs (box)', 'Box', 350], ['Safety goggles', 'Nos', 160], ['Full body harness', 'Nos', 3600], ['N95 mask (box of 20)', 'Box', 900]],
  housekeeping: [['Garbage bags large (pack)', 'Pack', 210], ['Tissue rolls (case)', 'Case', 1350], ['Hand soap refill 5 L', 'Can', 560], ['Mop refill', 'Nos', 160], ['Dustbin 60 L', 'Nos', 1250], ['Air freshener refill', 'Nos', 240], ['Microfiber cloth (pack)', 'Pack', 300], ['Toilet roll (case)', 'Case', 1100]],
  general: [['AA batteries (pack)', 'Pack', 150], ['Cable ties (pack)', 'Pack', 90], ['WD-40 spray', 'Nos', 320], ['Padlock 50 mm', 'Nos', 380], ['Marker pens (box)', 'Box', 260], ['Duct tape', 'Roll', 140], ['Rechargeable torch', 'Nos', 690], ['Extension board 4-way', 'Nos', 560]],
};
const LOW_STOCK = ['LED tube 20W', 'MCB 32A DP', 'Floor cleaner 5 L', 'Nitrile gloves (box of 100)', 'PVC pipe 1 inch (3 m)'];

export async function seed({ quiet = false } = {}) {
  state = 42;
  const log = (m) => !quiet && logger.info(m);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));

  const now = new Date();
  const today = istDate();
  const year = now.getFullYear();
  const counters = {};
  const numFor = (code) => (prefix) => {
    const key = `${prefix}-${code}-${year}`;
    counters[key] = (counters[key] || 0) + 1;
    return `${key}-${String(counters[key]).padStart(6, '0')}`;
  };
  const num = numFor('PTP');

  // ── Organisations, roles, SLA, property ──
  await M.Organization.create({ name: 'PrimeSpace Property Services Pvt. Ltd.', type: 'operator', gstin: '36AABCP1234F1Z5', address: 'Madhapur, Hyderabad' });
  const client = await M.Organization.create({ name: 'Prime Tech Park Developers LLP', type: 'client', gstin: '36AAKFP5678K1Z2', address: 'HITEC City, Hyderabad' });
  const orgId = client._id;
  const roles = await M.Role.insertMany(SYSTEM_ROLES.map((r) => ({ ...r, orgId, isSystem: true })));
  const role = Object.fromEntries(roles.map((r) => [r.key, r._id]));
  const slaPolicy = await M.SlaPolicy.create({
    orgId, name: 'Standard 24x7', calendar: '24x7', isDefault: true,
    rules: [['P1', 15, 240], ['P2', 30, 480], ['P3', 120, 1440], ['P4', 240, 4320]].map(([priority, responseMin, resolutionMin]) => ({ priority, responseMin, resolutionMin })),
    escalation: [{ level: 1, afterPct: 75, role: 'supervisor' }, { level: 2, afterPct: 100, role: 'property_manager' }, { level: 3, afterPct: 150, role: 'owner' }],
  });
  const property = await M.Property.create({
    orgId, name: 'Prime Tech Park', code: 'PTP', type: 'tech_park', address: 'Plot 12, HITEC City Phase 2, Madhapur', city: 'Hyderabad', areaSqft: 500000, is24x7: true,
    geoFence: { lat: 17.4474, lng: 78.3762, radiusM: 300, policy: 'flag' }, slaPolicyId: slaPolicy._id, isDemo: true, goLive: GO_LIVE,
    settings: { reportRecipients: ['client.reports@primetechpark.example'], selfieRetentionDays: 90 },
  });
  const P = { orgId, propertyId: property._id };

  const depts = await M.Department.insertMany([['FM', 'Facility Management'], ['ENG', 'Engineering'], ['HK', 'Housekeeping'], ['SEC', 'Security'], ['HSE', 'HSE'], ['HD', 'Helpdesk'], ['HORT', 'Horticulture'], ['ADM', 'Admin']].map(([code, name]) => ({ ...P, code, name })));
  const dept = Object.fromEntries(depts.map((d) => [d.code, d]));
  const shifts = await M.Shift.insertMany([
    { ...P, code: 'GEN', name: 'General', start: '09:00', end: '18:00', breakMin: 60, color: '#00918F' },
    { ...P, code: 'A', name: 'Shift A', start: '06:00', end: '14:00', color: '#3B82F6' },
    { ...P, code: 'B', name: 'Shift B', start: '14:00', end: '22:00', color: '#F59E0B' },
    { ...P, code: 'C', name: 'Shift C', start: '22:00', end: '06:00', crossesMidnight: true, color: '#6366F1' },
  ]);
  const shift = Object.fromEntries(shifts.map((s) => [s.code, s]));
  await M.Holiday.insertMany([['Republic Day', '01-26'], ['Independence Day', '08-15'], ['Gandhi Jayanti', '10-02'], ['Diwali', '11-08'], ['Christmas', '12-25']].map(([name, md]) => ({ ...P, name, date: `${year}-${md}` })));

  // ── Locations: Towers A–C × 10 floors × 5 zones + site areas ──
  const locs = [];
  const loc = {};
  const mk = (doc) => { const d = new M.Location({ ...P, ...doc }); locs.push(d); loc[d.code] = d; return d; };
  for (const t of ['A', 'B', 'C']) {
    const tower = mk({ type: 'tower', name: `Tower ${t}`, code: `PTP-${t}`, path: `Tower ${t}`, level: 0 });
    for (let f = 1; f <= 10; f++) {
      const ff = String(f).padStart(2, '0');
      const floor = mk({ type: 'floor', parentId: tower._id, name: `Floor ${ff}`, code: `PTP-${t}-${ff}`, path: `Tower ${t} / Floor ${ff}`, level: 1 });
      for (const [zc, zn] of [['EW', 'East Wing'], ['WW', 'West Wing'], ['CORE', 'Core'], ['LOBBY', 'Lift Lobby'], ['AHU', 'AHU Room']]) {
        mk({ type: 'zone', parentId: floor._id, name: zn, code: `PTP-${t}-${ff}-${zc}`, path: `Tower ${t} / Floor ${ff} / ${zn}`, level: 2 });
      }
    }
  }
  for (const [code, name] of [['PTP-BSMT', 'Basement Parking'], ['PTP-TERRACE', 'Terrace'], ['PTP-UTILITY', 'Utility Yard'], ['PTP-STP', 'STP Plant Room'], ['PTP-DGYARD', 'DG Yard'], ['PTP-PUMPRM', 'Fire Pump Room']]) mk({ type: 'area', name, code, path: name, level: 0 });
  await M.Location.insertMany(locs);

  // ── SOPs, categories, templates ──
  const sops = await M.Sop.insertMany(SOPS.map(([title, departmentCode, content]) => ({ orgId, title, departmentCode, content, version: '1.0', effectiveDate: istAt(addDays(today, -120)), status: 'approved' })));
  const tcats = await M.TicketCategory.insertMany([
    ['HVAC', 'HVAC', 'ENG', 'P3', ['Not cooling', 'Too cold', 'Water leakage', 'Noise', 'Odour'], sops[0]._id],
    ['ELEC', 'Electrical', 'ENG', 'P3', ['Lights not working', 'Power failure', 'Socket fault', 'Tripping'], null],
    ['PLUMB', 'Plumbing', 'ENG', 'P3', ['Leakage', 'Blockage', 'Low pressure', 'No water'], null],
    ['HK', 'Housekeeping', 'HK', 'P4', ['Cleaning', 'Washroom', 'Pest control', 'Garbage'], sops[4]._id],
    ['SEC', 'Security', 'SEC', 'P2', ['Access', 'Parking', 'Suspicious activity', 'Lost and found'], sops[5]._id],
    ['LIFT', 'Lift', 'ENG', 'P2', ['Stuck', 'Door fault', 'Noise'], null],
    ['CIVIL', 'Civil', 'FM', 'P4', ['Ceiling', 'Flooring', 'Doors and windows', 'Painting'], null],
    ['IT', 'IT & AV', 'ADM', 'P4', ['Signage', 'Wi-Fi', 'Access card'], null],
  ].map(([code, name, departmentCode, defaultPriority, subCategories, sopId]) => ({ orgId, code, name, departmentCode, defaultPriority, subCategories, sopId })));
  const tcat = Object.fromEntries(tcats.map((c) => [c.code, c]));
  const acats = await M.AssetCategory.insertMany([
    ['DG', 'DG sets', 'kva', 'kVA'], ['CHILLER', 'Chillers', 'tr', 'TR'], ['AHU', 'Air handling units', 'cfm', 'CFM'], ['TRANSFORMER', 'Transformers', 'kva', 'kVA'],
    ['PUMP', 'Pumps', 'hp', 'HP'], ['LIFT', 'Lifts', 'persons', 'persons'], ['STP', 'Sewage treatment plant', 'kld', 'KLD'], ['FIRE', 'Fire systems', 'zones', 'zones'],
  ].map(([code, name, key, unit]) => ({ orgId, code, name, customFields: [{ key, label: `Capacity (${unit})`, type: 'number', unit }] })));
  const acat = Object.fromEntries(acats.map((c) => [c.code, c]));
  const tpls = {};
  for (const [code, [name, sopIdx, items]] of Object.entries(TEMPLATES)) {
    tpls[code] = await M.ChecklistTemplate.create({
      orgId, name, appliesTo: 'ppm', categoryCode: code, sopId: sopIdx != null ? sops[sopIdx]._id : undefined,
      items: items.map(([label, type, min, max, unit]) => ({ label, type, min, max, unit, required: type !== 'photo', photoRequired: type === 'photo', autoTicket: type === 'number' })),
    });
  }

  // ── Vendors, tenants ──
  const vendorDefs = [
    ['CoolAir Chiller Services Pvt Ltd', 'VEN-CHL', ['amc', 'service'], 'Kiran Rao'], ['Vertex Lifts & Escalators', 'VEN-LFT', ['amc'], 'Sameer Khan'],
    ['PowerGen DG Care', 'VEN-DG', ['amc'], 'Vinod Reddy'], ['SafeGuard Fire Systems', 'VEN-FIR', ['amc'], 'Anand Iyer'],
    ['AquaPure STP Solutions', 'VEN-STP', ['amc'], 'Lavanya Das'], ['Deccan HVAC Spares', 'VEN-HVS', ['supplier'], 'Mohan Lal'],
    ['SparkleClean Facility Services', 'VEN-HKC', ['manpower'], 'Rita Thomas'], ['Shield Security Services', 'VEN-SEC', ['manpower'], 'Col. R. Singh (Retd)'],
  ];
  const vendors = await M.Vendor.insertMany(vendorDefs.map(([name, code, types, contact], i) => ({
    orgId, name, code, types, gstin: `36AA${String.fromCharCode(65 + i)}FV${1000 + i}K1Z${i}`, pan: `AA${String.fromCharCode(65 + i)}FV${1000 + i}K`,
    contacts: [{ name: contact, phone: `98480${String(10000 + i * 137).slice(0, 5)}`, email: `${code.toLowerCase()}@vendor.example` }],
    bank: { accountName: name, accountNo: `5010023${String(4500 + i * 77).padStart(6, '0')}`, ifsc: 'HDFC0001234', bankName: 'HDFC Bank' },
    documents: [{ name: 'Insurance certificate', type: 'insurance', expiry: istAt(addDays(today, i === 1 ? 40 : 200 + i * 10)) }], rating: 4, status: 'active',
  })));
  const vendor = Object.fromEntries(vendors.map((v) => [v.code, v]));
  const tenants = await M.Tenant.insertMany([
    ['Nimbus Analytics Pvt Ltd', ['PTP-A-05-EW', 'PTP-A-05-WW'], 'Neha Gupta'], ['Vertexa Software', ['PTP-A-06-EW'], 'Arvind Menon'],
    ['Orbit Fintech', ['PTP-B-03-EW', 'PTP-B-03-WW'], 'Sana Qureshi'], ['Kestrel Labs', ['PTP-B-07-WW'], 'Tarun Bhatia'],
    ['Saffron Health IT', ['PTP-C-02-EW'], 'Dr. Meera Pillai'], ['Lumen Consulting', ['PTP-C-09-EW', 'PTP-C-09-WW'], 'Rahul Verma'],
  ].map(([name, units, contact]) => ({ ...P, name, units: units.map((c) => loc[c]._id), contacts: [{ name: contact, email: `${contact.split(' ')[0].toLowerCase().replace(/\W/g, '')}@tenant.example`, phone: '9000000000' }], leaseStart: istAt(addDays(today, -400)), leaseEnd: istAt(addDays(today, 700)) })));

  // ── Employees (125) ──
  const SPEC = [
    ['ENG', 'Engineering Supervisor', ['HVAC', 'Electrical'], 1, 'GEN'], ['ENG', 'HVAC Technician', ['HVAC'], 7, 'ROT4'], ['ENG', 'Electrician', ['Electrical'], 8, 'ROT4'],
    ['ENG', 'Plumber', ['Plumbing'], 5, 'ROT4'], ['ENG', 'Fire Technician', ['Fire'], 4, 'ROT4'],
    ['HK', 'Housekeeping Supervisor', [], 1, 'GEN'], ['HK', 'Housekeeping Associate', [], 39, 'ROT2', 'VEN-HKC'],
    ['SEC', 'Security Supervisor', [], 1, 'GEN'], ['SEC', 'Security Guard', [], 34, 'ROT3', 'VEN-SEC'],
    ['HD', 'Helpdesk Supervisor', [], 1, 'GEN'], ['HD', 'Helpdesk Executive', [], 5, 'ROT4'],
    ['HSE', 'HSE Officer', ['Safety'], 1, 'GEN'], ['HSE', 'Safety Steward', ['Safety'], 2, 'ROT2'],
    ['HORT', 'Horticulture Supervisor', [], 1, 'GEN'], ['HORT', 'Gardener', [], 7, 'A', 'VEN-HKC'],
    ['ADM', 'Admin Supervisor', [], 1, 'GEN'], ['ADM', 'Storekeeper', [], 1, 'GEN'], ['ADM', 'Procurement Officer', [], 1, 'GEN'], ['ADM', 'Admin Executive', [], 1, 'GEN'],
    ['FM', 'Property Manager', [], 1, 'GEN'], ['FM', 'Facility Executive', [], 3, 'GEN'],
  ];
  const emps = [];
  const usedNames = new Set();
  const deptCount = {};
  for (const [dc, designation, skills, count, pattern, vend] of SPEC) {
    for (let i = 0; i < count; i++) {
      let name;
      do name = `${pick(FIRST)} ${pick(LAST)}`; while (usedNames.has(name));
      usedNames.add(name);
      deptCount[dc] = (deptCount[dc] || 0) + 1;
      emps.push(new M.Employee({
        ...P, code: `PS-${dc}-${String(deptCount[dc]).padStart(3, '0')}`, name, departmentId: dept[dc]._id, designation, skills,
        employmentType: vend ? 'contract' : 'permanent', contractorVendorId: vend ? vendor[vend]._id : undefined, shiftGroup: pattern,
        mobile: `9${String(700000000 + emps.length * 7919).slice(0, 9)}`, joiningDate: istAt(addDays(today, -int(90, 1500))), status: 'active',
        emergencyContact: { name: `${pick(FIRST)} ${name.split(' ')[1]}`, phone: '9100000000' },
      }));
    }
  }
  const byDesig = (d) => emps.filter((e) => e.designation === d);
  const E = {
    pm: byDesig('Property Manager')[0], engSup: byDesig('Engineering Supervisor')[0], hkSup: byDesig('Housekeeping Supervisor')[0], secSup: byDesig('Security Supervisor')[0],
    hdSup: byDesig('Helpdesk Supervisor')[0], hortSup: byDesig('Horticulture Supervisor')[0], admSup: byDesig('Admin Supervisor')[0], fmSup: byDesig('Facility Executive')[0],
    helpdesk: byDesig('Helpdesk Executive')[0], hvac: byDesig('HVAC Technician')[0], store: byDesig('Storekeeper')[0], proc: byDesig('Procurement Officer')[0], hse: byDesig('HSE Officer')[0],
  };
  E.hvac.name = 'Ravi Kumar';
  E.pm.name = 'Lakshmi Narayanan';
  E.engSup.name = 'Suresh Reddy';
  // Reporting lines for the org chart: staff → department head → Property Manager.
  const heads = { ENG: E.engSup, HK: E.hkSup, SEC: E.secSup, HD: E.hdSup, HORT: E.hortSup, ADM: E.admSup, HSE: E.hse, FM: E.pm };
  const deptCode = new Map(depts.map((d) => [String(d._id), d.code]));
  for (const e of emps) {
    const h = heads[deptCode.get(String(e.departmentId))];
    if (!e._id.equals(E.pm._id)) e.supervisorId = h && !h._id.equals(e._id) ? h._id : E.pm._id;
  }

  // ── Users (one per role + every engineering technician) ──
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const userDefs = [
    ['admin@primespace.demo', 'Aarav Mehta', 'super_admin'], ['owner@primespace.demo', 'Rohan Kapoor', 'owner'],
    ['pm@primespace.demo', E.pm, 'property_manager', 'FM'], ['eng.supervisor@primespace.demo', E.engSup, 'supervisor', 'ENG'],
    ['hk.supervisor@primespace.demo', E.hkSup, 'supervisor', 'HK'], ['sec.supervisor@primespace.demo', E.secSup, 'supervisor', 'SEC'],
    ['helpdesk.supervisor@primespace.demo', E.hdSup, 'supervisor', 'HD'], ['hort.supervisor@primespace.demo', E.hortSup, 'supervisor', 'HORT'],
    ['admin.supervisor@primespace.demo', E.admSup, 'supervisor', 'ADM'], ['fm.supervisor@primespace.demo', E.fmSup, 'supervisor', 'FM'],
    ['helpdesk@primespace.demo', E.helpdesk, 'helpdesk', 'HD'], ['hvac.tech@primespace.demo', E.hvac, 'technician', 'ENG'],
    ['store@primespace.demo', E.store, 'storekeeper', 'ADM'], ['procurement@primespace.demo', E.proc, 'procurement', 'ADM'],
    ['hse@primespace.demo', E.hse, 'hse_officer', 'HSE'], ['vendor@primespace.demo', 'CoolAir Service Desk', 'vendor'],
    ['tenant@primespace.demo', 'Neha Gupta', 'tenant'], ['auditor@primespace.demo', 'Meera Krishnan', 'auditor'],
  ];
  const users = [];
  for (const [email, who, rk, dc] of userDefs) {
    const emp = typeof who === 'object' ? who : null;
    const u = new M.User({
      email, name: emp ? emp.name : who, passwordHash, roleIds: [role[rk]], propertyIds: [property._id], departmentIds: dc ? [dept[dc]._id] : [],
      employeeId: emp?._id, mobile: emp?.mobile, isDemo: true,
      vendorId: rk === 'vendor' ? vendor['VEN-CHL']._id : undefined, tenantId: rk === 'tenant' ? tenants[0]._id : undefined,
    });
    if (emp) emp.userId = u._id;
    users.push(u);
  }
  for (const e of emps.filter((x) => x.departmentId.equals(dept.ENG._id) && !x.userId)) {
    const u = new M.User({ email: `${e.code.toLowerCase()}@primespace.demo`, name: e.name, passwordHash, roleIds: [role.technician], propertyIds: [property._id], departmentIds: [dept.ENG._id], employeeId: e._id, mobile: e.mobile });
    e.userId = u._id;
    users.push(u);
  }
  await M.Employee.insertMany(emps);
  await M.User.insertMany(users);
  const U = Object.fromEntries(users.map((u) => [u.email.split('@')[0], u]));
  const techUser = (desig, i) => users.find((u) => String(u.employeeId) === String(byDesig(desig)[i]?._id));
  await M.Department.updateOne({ _id: dept.ENG._id }, { headUserId: U['eng.supervisor']._id });
  await M.Department.updateOne({ _id: dept.FM._id }, { headUserId: U.pm._id });

  // ── Rosters (30 days back, 6 ahead) ──
  const ROT = { ROT4: ['A', 'B', 'C', 'GEN'], ROT3: ['A', 'B', 'C'], ROT2: ['A', 'B'] };
  const rosters = [];
  for (let d = -30; d <= 6; d++) {
    const date = addDays(today, d);
    const dow = istAt(date, '12:00').getUTCDay();
    const week = Math.floor((istAt(date, '12:00') / DAY_MS + 3) / 7);
    emps.forEach((e, idx) => {
      const isDemoTech = e._id.equals(E.hvac._id);
      const pattern = isDemoTech ? 'GEN' : e.shiftGroup;
      const off = pattern === 'GEN' ? dow === 0 : dow === (idx * 3) % 7;
      const code = ROT[pattern] ? ROT[pattern][(idx + week) % ROT[pattern].length] : pattern;
      rosters.push({ ...P, employeeId: e._id, departmentId: e.departmentId, date, shiftId: off && !(isDemoTech && d === 0) ? null : shift[code]._id, isWeeklyOff: off && !(isDemoTech && d === 0), published: d <= 6 });
    });
  }
  await M.Roster.insertMany(rosters);

  // ── Attendance: demo technician checked in; everyone else simulated ──
  await M.Attendance.create({ ...P, employeeId: E.hvac._id, departmentId: dept.ENG._id, date: today, shiftId: shift.GEN._id, status: 'present', checkIn: { time: new Date(Math.min(+now - 20 * MIN, +istAt(today, '08:56'))), source: 'mobile', lat: 17.4476, lng: 78.3765, insideFence: true, distanceM: 25 } });
  for (let d = -30; d <= 0; d++) await simulateAttendance(property, d < 0 ? new Date(Math.min(+istAt(addDays(today, d + 1), '07:00'), +now)) : now);
  await als.run({ propertyId: property._id, orgId }, async () => {
    // Pin today's attendance to ~94% of the shifts that have started.
    const s = await todaySummary();
    const target = Math.round(s.planned * 0.94);
    if (s.present > target) {
      const extra = await M.Attendance.find({ date: today, status: 'present', 'checkIn.deviceId': 'DEMO-SIM' }).limit(s.present - target);
      for (const a of extra) await M.Attendance.updateOne({ _id: a._id }, { $set: { status: 'absent', exceptions: ['absent'] }, $unset: { checkIn: 1, checkOut: 1 } });
    }
  });

  // ── Assets ──
  const assetDocs = [];
  const A = (code, name, cat, locCode, crit, extra = {}) => { const a = new M.Asset({ ...P, code, name, categoryId: acat[cat]._id, locationId: loc[locCode]._id, departmentId: dept.ENG._id, criticality: crit, status: 'running', installDate: istAt(addDays(today, -int(700, 2400))), warrantyExpiry: istAt(addDays(today, int(-300, 500))), cost: extra.cost, ...extra, _cat: undefined }); a.$locals.cat = cat; assetDocs.push(a); return a; };
  for (let i = 1; i <= 4; i++) A(`DG-0${i}`, `Diesel generator ${i} (1500 kVA)`, 'DG', 'PTP-DGYARD', 'critical', { make: 'Cummins', model: 'C1500D5', capacity: '1500 kVA', specs: { kva: 1500 }, runHours: 1200 + i * 137, cost: 14500000, serialNo: `DG15-${7340 + i}` });
  for (let i = 1; i <= 3; i++) A(`CH-0${i}`, `Water-cooled chiller ${i} (600 TR)`, 'CHILLER', 'PTP-UTILITY', 'critical', { make: 'Daikin', model: 'WCC-600', capacity: '600 TR', specs: { tr: 600 }, cost: 32000000, status: i === 3 ? 'standby' : 'running' });
  for (const t of ['A', 'B', 'C']) for (let f = 1; f <= 10; f++) { const ff = String(f).padStart(2, '0'); A(`AHU-${t}-${ff}`, `AHU Tower ${t} Floor ${ff}`, 'AHU', `PTP-${t}-${ff}-AHU`, 'high', { make: 'Zeco', model: 'ZAHU-12K', capacity: '12000 CFM', specs: { cfm: 12000 }, cost: 850000 }); }
  for (let i = 1; i <= 4; i++) A(`TR-0${i}`, `Transformer ${i} (2000 kVA)`, 'TRANSFORMER', 'PTP-UTILITY', 'critical', { make: 'Voltamp', capacity: '2000 kVA', specs: { kva: 2000 }, cost: 4200000 });
  ['Domestic water pump 1', 'Domestic water pump 2', 'Flushing water pump 1', 'Flushing water pump 2', 'Sump transfer pump', 'Chilled water pump 1', 'Chilled water pump 2', 'Condenser water pump 1', 'Condenser water pump 2', 'Garden irrigation pump']
    .forEach((n, i) => A(`PMP-${String(i + 1).padStart(2, '0')}`, n, 'PUMP', 'PTP-BSMT', 'normal', { make: 'Kirloskar', capacity: `${[10, 10, 7.5, 7.5, 5, 30, 30, 40, 40, 3][i]} HP`, cost: 180000 }));
  for (const t of ['A', 'B', 'C']) for (let i = 1; i <= 4; i++) A(`LIFT-${t}-0${i}`, `Passenger lift ${t}-0${i}`, 'LIFT', `PTP-${t}-01-LOBBY`, 'high', { make: 'Otis', model: 'Gen2', capacity: '20 persons', specs: { persons: 20 }, cost: 3800000, status: t === 'B' && i === 3 ? 'breakdown' : 'running' });
  A('STP-01', 'Sewage treatment plant (250 KLD)', 'STP', 'PTP-STP', 'high', { capacity: '250 KLD', specs: { kld: 250 }, cost: 9500000 });
  for (const t of ['A', 'B', 'C']) for (const [c, n] of [['PUMP', 'Fire pump set'], ['HYD', 'Hydrant system'], ['SPR', 'Sprinkler system'], ['FAP', 'Fire alarm panel']]) A(`FIRE-${t}-${c}`, `${n} – Tower ${t}`, 'FIRE', c === 'PUMP' ? 'PTP-PUMPRM' : `PTP-${t}-01-CORE`, 'critical', { cost: 1200000 });
  assetDocs.find((a) => a.code === 'DG-02').status = 'breakdown';
  const catOf = new Map(assetDocs.map((a) => [a.code, a.$locals.cat]));
  await M.Asset.insertMany(assetDocs);
  const asset = Object.fromEntries(assetDocs.map((a) => [a.code, a]));

  // ── PPM schedules + 30 days of history (~92% completion) ──
  const skillFor = { AHU: 'HVAC Technician', CHILLER: 'HVAC Technician', DG: 'Electrician', TRANSFORMER: 'Electrician', LIFT: 'Electrician', PUMP: 'Plumber', STP: 'Plumber', FIRE: 'Fire Technician' };
  const schedules = [];
  const ppmHistory = [];
  assetDocs.forEach((a, i) => {
    const cat = catOf.get(a.code);
    const freq = FREQ[cat];
    const tech = techUser(skillFor[cat], (i % byDesig(skillFor[cat]).length) || (skillFor[cat] === 'HVAC Technician' ? 1 : 0));
    const offsets = freq === 'weekly' ? [0, 7, 14, 21].map((k) => -(1 + (i % 7) + k)) : freq === 'monthly' ? [-(1 + ((i * 3) % 28))] : i % 3 === 0 ? [-(3 + (i % 20))] : [];
    const last = offsets.length ? Math.max(...offsets) : -int(10, 60);
    const s = new M.PpmSchedule({ ...P, title: `${TEMPLATES[cat][0]} – ${a.code}`, assetId: a._id, templateId: tpls[cat]._id, frequency: freq, departmentId: dept.ENG._id, assigneeIds: tech ? [tech._id] : [], startDate: istAt(addDays(today, -365)), nextDueDate: addFreq(istAt(addDays(today, last), '00:00'), freq), active: true, sopId: tpls[cat].sopId });
    schedules.push(s);
    for (const o of offsets) ppmHistory.push({ s, a, cat, tech, planned: istAt(addDays(today, o), '00:00') });
  });
  await M.PpmSchedule.insertMany(schedules);
  const notDone = new Set(ppmHistory.map((_, i) => i).sort(() => rand() - 0.5).slice(0, Math.round(ppmHistory.length * 0.08)));
  const valueFor = (it) => (it.type === 'yesno' ? true : it.type === 'photo' ? undefined : it.type === 'text' ? 'OK' : Math.round(((it.min ?? 0) + ((it.max ?? 100) - (it.min ?? 0)) * (0.3 + rand() * 0.4)) * 10) / 10);
  await M.WorkOrder.insertMany(ppmHistory.sort((x, y) => x.planned - y.planned).map((h, i) => {
    const done = !notDone.has(i);
    const completedAt = new Date(+h.planned + int(10, 16) * H);
    return {
      ...P, number: num('WO'), type: 'ppm', title: h.s.title, assetId: h.a._id, scheduleId: h.s._id, locationId: h.a.locationId, departmentId: dept.ENG._id,
      assigneeIds: h.tech ? [h.tech._id] : [], status: done ? 'verified' : 'assigned', priority: 'P3', plannedDate: h.planned,
      startedAt: done ? new Date(+completedAt - 50 * MIN) : undefined, completedAt: done ? completedAt : undefined, verifiedAt: done ? new Date(+completedAt + 2 * H) : undefined, verifiedBy: done ? U['eng.supervisor']._id : undefined,
      checklist: tpls[h.cat].items.map((it) => ({ ...it.toObject(), _id: undefined, value: done ? valueFor(it) : undefined, deviation: false })),
      findings: done ? 'All parameters within limits.' : undefined, history: [{ status: 'scheduled', byName: 'Scheduler', at: h.planned }, ...(done ? [{ status: 'completed', byName: h.tech?.name, at: completedAt }, { status: 'verified', byName: E.engSup.name, at: new Date(+completedAt + 2 * H) }] : [])],
    };
  }));

  // ── Daily critical-asset log sheets (FR-4.5): 7 days of DG, chiller and transformer readings ──
  const DAILY = {
    DG: ['DG daily log', [['Run hours', 'reading', null, null, 'h'], ['Fuel level', 'reading', 40, 100, '%'], ['Battery voltage', 'number', 24, 28.5, 'V'], ['No oil or fuel leaks', 'yesno']]],
    CHILLER: ['Chiller daily log', [['Chilled water leaving temperature', 'number', 6, 8, '°C'], ['Chilled water entering temperature', 'number', 11, 14, '°C'], ['Condenser pressure', 'number', 120, 180, 'psi'], ['Running current', 'reading', 200, 450, 'A']]],
    TRANSFORMER: ['Transformer daily log', [['Oil temperature', 'number', 30, 75, '°C'], ['Winding temperature', 'number', 30, 90, '°C'], ['Load current', 'reading', 200, 2400, 'A'], ['No abnormal sound or smell', 'yesno']]],
  };
  const dailyTpl = {};
  for (const [cat, [name, items]] of Object.entries(DAILY)) {
    dailyTpl[cat] = await M.ChecklistTemplate.create({ orgId, name, appliesTo: 'daily_check', categoryCode: cat, items: items.map(([label, type, min, max, unit]) => ({ label, type, min, max, unit, required: true, autoTicket: type === 'number' })) });
  }
  const dailySchedules = assetDocs.filter((a) => DAILY[catOf.get(a.code)]).map((a, i) => {
    const cat = catOf.get(a.code);
    const tech = cat === 'CHILLER' ? techUser('HVAC Technician', 1) : techUser('Electrician', i % 8);
    return new M.PpmSchedule({ ...P, kind: 'daily_check', title: `${DAILY[cat][0]} – ${a.code}`, assetId: a._id, templateId: dailyTpl[cat]._id, frequency: 'daily', departmentId: dept.ENG._id, assigneeIds: [tech._id], startDate: istAt(addDays(today, -7)), nextDueDate: istAt(today, '00:00'), active: true });
  });
  await M.PpmSchedule.insertMany(dailySchedules);
  const dailyWos = [];
  const meterRows = [];
  for (let d = -7; d <= -1; d++) {
    for (const s of dailySchedules) {
      const a = assetDocs.find((x) => x._id.equals(s.assetId));
      const cat = catOf.get(a.code);
      const at = new Date(+istAt(addDays(today, d), '07:15') + int(0, 80) * MIN);
      const woId = new mongoose.Types.ObjectId();
      const checklist = dailyTpl[cat].items.map((it) => {
        const value = it.label === 'Run hours' ? Math.round(((a.runHours || 1000) + d * 0.4) * 10) / 10 : valueFor(it);
        if (typeof value === 'number') meterRows.push({ ...P, assetId: a._id, type: it.unit === 'h' ? 'run_hours' : it.unit === '°C' ? 'temperature' : /fuel/i.test(it.label) ? 'dg_fuel' : 'other', label: it.label, value, unit: it.unit, readAt: at, workOrderId: woId });
        return { ...it.toObject(), _id: undefined, value, deviation: false };
      });
      dailyWos.push({ _id: woId, ...P, number: num('WO'), type: 'daily_check', title: s.title, assetId: a._id, scheduleId: s._id, locationId: a.locationId, departmentId: dept.ENG._id, assigneeIds: s.assigneeIds, status: 'closed', priority: 'P3', plannedDate: istAt(addDays(today, d), '00:00'), startedAt: at, completedAt: at, checklist, history: [{ status: 'closed', byName: 'Technician', at }] });
    }
  }
  await M.WorkOrder.insertMany(dailyWos);
  await M.MeterReading.insertMany(meterRows);

  // ── Inventory: stores, items, balances, ledger ──
  const stores = await M.Store.insertMany([{ ...P, name: 'Main Store', code: 'MAIN', type: 'main' }, { ...P, name: 'Engineering Store', code: 'ENG', type: 'engineering' }]);
  const itemDocs = [];
  let n = 0;
  for (const [category, list] of Object.entries(ITEMS)) {
    for (const [name, uom, cost] of list) {
      n++;
      const reorder = int(4, 12);
      itemDocs.push(new M.Item({
        orgId, code: `ITM-${String(n).padStart(3, '0')}`, name, category, uom, unitCost: cost, gstPct: 18, hsn: String(84000000 + n * 13),
        minLevel: Math.ceil(reorder / 2), reorderLevel: { 'AHU pre-filter 24x24x2': 6, 'V-belt B-52': 2 }[name] ?? reorder, reorderQty: reorder * 3, maxLevel: reorder * 5,
        preferredVendorId: category === 'hvac_filters' ? vendor['VEN-HVS']._id : undefined, binLocation: `R${int(1, 8)}-S${int(1, 5)}`, isChemical: category === 'chemicals',
      }));
    }
  }
  await M.Item.insertMany(itemDocs);
  const itemBy = (nm) => itemDocs.find((i) => i.name === nm);
  const balances = [];
  const ledger = [];
  for (const it of itemDocs) {
    const store = ['electrical_spares', 'hvac_filters', 'plumbing'].includes(it.category) ? stores[1] : stores[0];
    let qty = LOW_STOCK.includes(it.name) ? Math.max(1, it.reorderLevel - int(1, 3)) : it.reorderLevel + int(3, 25);
    if (it.name === 'AHU pre-filter 24x24x2') qty = 8;
    if (it.name === 'V-belt B-52') qty = 5;
    const issued = rand() < 0.4 ? int(2, 8) : 0;
    const opening = qty + issued;
    ledger.push({ ...P, storeId: store._id, itemId: it._id, type: 'opening', qty: opening, rate: it.unitCost, refType: 'opening', balanceAfter: opening, at: istAt(addDays(today, -35)), note: 'Opening stock' });
    if (issued) ledger.push({ ...P, storeId: store._id, itemId: it._id, type: 'issue', qty: -issued, rate: it.unitCost, refType: 'MaterialIssue', balanceAfter: qty, at: istAt(addDays(today, -int(2, 25)), '11:00'), note: 'Issued for maintenance' });
    balances.push({ ...P, storeId: store._id, itemId: it._id, qty, value: qty * it.unitCost, batches: it.isChemical ? [{ batchNo: `B${int(1000, 9999)}`, expiry: istAt(addDays(today, it.name.startsWith('Disinfectant') ? 20 : int(90, 400))), qty }] : [] });
  }
  await M.StockBalance.insertMany(balances);
  await M.StockLedger.insertMany(ledger);

  // ── Tickets: 120 closed in the last 30 days (96% within SLA) + 18 open ──
  const rule = Object.fromEntries(slaPolicy.rules.map((r) => [r.priority, r]));
  const zones = locs.filter((l) => l.type === 'zone' && !l.code.endsWith('-AHU'));
  const CAT_MIX = ['HVAC', 'HVAC', 'HVAC', 'HVAC', 'HVAC', 'HVAC', 'ELEC', 'ELEC', 'ELEC', 'ELEC', 'PLUMB', 'PLUMB', 'PLUMB', 'HK', 'HK', 'HK', 'SEC', 'LIFT', 'CIVIL', 'IT'];
  const DESC = { HVAC: ['Area too warm', 'AC not cooling in meeting room', 'Water dripping from AC vent', 'AC noise near workstations'], ELEC: ['Lights not working', 'Power socket not working', 'MCB tripping frequently'], PLUMB: ['Tap leaking in washroom', 'WC flush not working', 'Low water pressure'], HK: ['Washroom needs cleaning', 'Garbage not cleared', 'Pantry floor sticky'], SEC: ['Visitor access issue at turnstile', 'Parking slot occupied'], LIFT: ['Lift door closing slowly', 'Lift making noise'], CIVIL: ['Door closer broken', 'Floor tile cracked'], IT: ['Lobby signage not updating'] };
  const assigneeFor = (code, k) => ({ HVAC: techUser('HVAC Technician', 1 + (k % 6)), ELEC: techUser('Electrician', k % 8), PLUMB: techUser('Plumber', k % 5), LIFT: techUser('Electrician', k % 8), HK: U['hk.supervisor'], SEC: U['sec.supervisor'], CIVIL: U['fm.supervisor'], IT: U['admin.supervisor'] }[code]);
  const breached = new Set([7, 33, 58, 81, 104]);
  const tickets = [];
  const ticketWos = [];
  const hist = (status, at, byName, note) => ({ status, at, byName, note });
  for (let i = 0; i < 120; i++) {
    const code = pick(CAT_MIX);
    const cat = tcat[code];
    const createdAt = new Date(+now - int(26, 29 * 24) * H - int(0, 59) * MIN);
    let z = pick(zones);
    let a = null;
    if (code === 'HVAC') { const fl = z.code.split('-').slice(0, 3).join('-'); a = asset[`AHU-${fl.split('-')[1]}-${fl.split('-')[2]}`]; }
    if (code === 'LIFT') { a = asset[`LIFT-${pick(['A', 'B', 'C'])}-0${int(1, 4)}`]; z = loc[locs.find((l) => l._id.equals(a.locationId)).code]; }
    const priority = code === 'HVAC' || code === 'LIFT' || code === 'SEC' ? 'P2' : cat.defaultPriority;
    const r = rule[priority];
    const isBreach = breached.has(i);
    const respondedAt = new Date(+createdAt + r.responseMin * (0.3 + rand() * 0.5) * MIN);
    const resolvedAt = isBreach ? new Date(+createdAt + (r.resolutionMin + int(30, 180)) * MIN) : new Date(+createdAt + r.resolutionMin * (0.2 + rand() * 0.6) * MIN);
    const closedAt = new Date(+resolvedAt + int(1, 20) * H);
    const tech = assigneeFor(code, i);
    const tenant = tenants.find((t) => t.units.some((u) => String(u) === String(z._id)));
    const t = new M.Ticket({
      ...P, number: num('TKT'), source: tenant ? 'tenant_portal' : pick(['helpdesk', 'helpdesk', 'mobile']), categoryId: cat._id, subCategory: pick(cat.subCategories),
      locationId: z._id, assetId: a?._id, description: pick(DESC[code]), reporterId: tenant ? U.tenant._id : U.helpdesk._id, tenantId: tenant?._id,
      priority, suggestedPriority: priority, status: 'closed', assignedDeptId: dept[cat.departmentCode]._id, assigneeId: tech?._id, closedAt,
      sla: { policyId: slaPolicy._id, startedAt: createdAt, responseDue: new Date(+createdAt + r.responseMin * MIN), resolutionDue: new Date(+createdAt + r.resolutionMin * MIN), respondedAt, resolvedAt, pausedMin: 0, responseBreached: false, resolutionBreached: isBreach },
      tenantConfirmation: { status: 'confirmed', rating: isBreach ? 3 : pick([4, 5, 5]), at: closedAt }, resolutionNotes: 'Attended and resolved.',
      history: [hist('new', createdAt, 'Helpdesk'), hist('assigned', new Date(+respondedAt - 2 * MIN), E.engSup.name), hist('acknowledged', respondedAt, tech?.name), hist('in_progress', new Date(+respondedAt + 5 * MIN), tech?.name), hist('resolved', resolvedAt, E.engSup.name), hist('tenant_confirmed', closedAt, 'Tenant'), hist('closed', closedAt, 'System')],
    });
    t.createdAt = createdAt;
    t.updatedAt = closedAt;
    if (a) {
      const filter = itemBy('AHU pre-filter 24x24x2');
      const wo = { ...P, number: num('WO'), type: 'breakdown', title: t.description, ticketId: t._id, assetId: a._id, locationId: t.locationId, departmentId: t.assignedDeptId, assigneeIds: tech ? [tech._id] : [], status: 'closed', priority, plannedDate: createdAt, startedAt: respondedAt, completedAt: new Date(+resolvedAt - 30 * MIN), verifiedAt: resolvedAt, verifiedBy: U['eng.supervisor']._id, downtimeMin: Math.round((resolvedAt - createdAt) / MIN), findings: 'Fault rectified and tested.', partsUsed: code === 'HVAC' && rand() < 0.5 ? [{ itemId: filter._id, name: filter.name, qty: 1, cost: filter.unitCost }] : [] };
      t.workOrderId = new mongoose.Types.ObjectId();
      ticketWos.push({ _id: t.workOrderId, ...wo });
    }
    tickets.push(t);
  }
  const OPEN = [
    ['ELEC', 'PTP-DGYARD', 'DG-02', 'DG-02 failed to start during the weekly no-load test', 'P1', 'assigned', 50, techUser('Electrician', 0)],
    ['LIFT', 'PTP-B-01-LOBBY', 'LIFT-B-03', 'Lift B-03 stuck between floors 6 and 7 — passengers rescued, lift shut down', 'P1', 'in_progress', 95, techUser('Electrician', 1)],
    ['HVAC', 'PTP-B-04-EW', 'AHU-B-04', 'East wing too warm (27 °C) since morning', 'P2', 'acknowledged', 140, techUser('HVAC Technician', 2)],
    ['HVAC', 'PTP-C-08-WW', 'AHU-C-08', 'AHU C-08 making a loud rattling noise', 'P2', 'in_progress', 300, techUser('HVAC Technician', 3), { awaiting: true }],
    ['PLUMB', 'PTP-A-03-CORE', null, 'Washroom tap leaking continuously', 'P3', 'assigned', 200, techUser('Plumber', 0)],
    ['PLUMB', 'PTP-C-02-WW', null, 'Water seepage below the pantry sink', 'P3', 'on_hold', 900, techUser('Plumber', 1), { hold: 'Awaiting spares: pantry bottle trap' }],
    ['ELEC', 'PTP-B-07-EW', null, 'Two LED panels flickering over the workstation bay', 'P3', 'in_progress', 400, techUser('Electrician', 2)],
    ['ELEC', 'PTP-A-09-LOBBY', null, 'Lift lobby lights not working', 'P3', 'new', 35, null],
    ['HK', 'PTP-A-06-CORE', null, 'Washroom needs cleaning — soap dispenser empty', 'P4', 'assigned', 120, U['hk.supervisor']],
    ['HK', 'PTP-C-01-LOBBY', null, 'Coffee spillage in the main lobby near reception', 'P4', 'new', 20, null],
    ['SEC', 'PTP-BSMT', null, 'Unknown car parked in tenant reserved slot B-112', 'P2', 'acknowledged', 60, U['sec.supervisor']],
    ['CIVIL', 'PTP-B-03-WW', null, 'Ceiling tile damaged after an AC leak', 'P4', 'on_hold', 2000, U['fm.supervisor'], { hold: 'Awaiting tenant access to the cabin' }],
    ['HVAC', 'PTP-A-02-EW', 'AHU-A-02', 'AHU A-02 filter choke alarm', 'P2', 'resolved', 600, techUser('HVAC Technician', 2)],
    ['PLUMB', 'PTP-B-09-CORE', null, 'Low water pressure in the gents washroom', 'P3', 'resolved', 1500, techUser('Plumber', 0)],
    ['IT', 'PTP-C-05-LOBBY', null, 'Digital signage screen blank in the lobby', 'P4', 'new', 240, null],
    ['HVAC', 'PTP-B-06-EW', 'AHU-B-06', 'Musty odour from the AC vents', 'P3', 'reopened', 2600, techUser('HVAC Technician', 4)],
    ['ELEC', 'PTP-UTILITY', 'TR-03', 'Transformer TR-03 oil temperature alarm (intermittent)', 'P2', 'in_progress', 380, techUser('Electrician', 3)],
    ['HK', 'PTP-B-10-EW', null, 'Pest sighting reported in the pantry', 'P3', 'acknowledged', 180, U['hk.supervisor']],
  ];
  const FLOW = ['new', 'assigned', 'acknowledged', 'in_progress', 'resolved'];
  for (const [code, lc, ac, description, priority, status, ageMin, tech, opt = {}] of OPEN) {
    const cat = tcat[code];
    const createdAt = new Date(+now - ageMin * MIN);
    const r = rule[priority];
    const z = loc[lc];
    const a = ac ? asset[ac] : null;
    const tenant = tenants.find((t) => t.units.some((u) => String(u) === String(z._id)));
    const reached = status === 'on_hold' || status === 'reopened' ? 3 : FLOW.indexOf(status);
    const respondedAt = reached >= 2 ? new Date(+createdAt + Math.min(r.responseMin * 0.6, ageMin * 0.2) * MIN) : undefined;
    const t = new M.Ticket({
      ...P, number: num('TKT'), source: tenant ? 'tenant_portal' : 'helpdesk', categoryId: cat._id, subCategory: cat.subCategories[0], locationId: z._id, assetId: a?._id, description,
      reporterId: tenant ? U.tenant._id : U.helpdesk._id, tenantId: tenant?._id, priority, suggestedPriority: priority, status, assignedDeptId: dept[cat.departmentCode]._id,
      assigneeId: tech?._id, awaitingVerification: Boolean(opt.awaiting), holdReason: opt.hold,
      sla: { policyId: slaPolicy._id, startedAt: createdAt, responseDue: new Date(+createdAt + r.responseMin * MIN), resolutionDue: new Date(+createdAt + r.resolutionMin * MIN), respondedAt, pausedMin: 0 },
      history: [hist('new', createdAt, tenant ? 'Neha Gupta' : E.helpdesk.name, `Raised via ${tenant ? 'tenant portal' : 'helpdesk'}`)],
    });
    t.createdAt = createdAt;
    const step = (s, frac, by, note) => t.history.push(hist(s, new Date(+createdAt + ageMin * frac * MIN), by, note));
    if (reached >= 1) step('assigned', 0.1, E.engSup.name, `Assigned to ${tech?.name}`);
    if (reached >= 2) t.history.push(hist('acknowledged', respondedAt, tech?.name));
    if (reached >= 3) step('in_progress', 0.3, tech?.name);
    if (status === 'on_hold') { step('on_hold', 0.5, tech?.name, opt.hold); t.sla.pausedAt = new Date(+createdAt + ageMin * 0.5 * MIN); }
    if (status === 'resolved') { step('resolved', 0.8, E.engSup.name, 'Verified by supervisor'); t.sla.resolvedAt = new Date(+createdAt + ageMin * 0.8 * MIN); t.tenantConfirmation = { status: 'pending' }; t.resolutionNotes = 'Fixed and tested.'; }
    if (status === 'reopened') { step('resolved', 0.5, E.engSup.name); step('reopened', 0.6, 'Neha Gupta', 'Smell is back after a day'); }
    t.sla.responseBreached = Boolean(respondedAt ? respondedAt > t.sla.responseDue : now > t.sla.responseDue);
    t.sla.resolutionBreached = !t.sla.resolvedAt && !t.sla.pausedAt && now > t.sla.resolutionDue;
    const p = slaProgress(t, now);
    const worst = Math.max(t.sla.respondedAt ? 0 : p.response, t.sla.resolvedAt ? 0 : p.resolution) * 100;
    t.escalationLevel = worst >= 150 ? 3 : worst >= 100 ? 2 : worst >= 75 ? 1 : 0;
    if (tech) {
      const woStatus = { assigned: 'assigned', acknowledged: 'assigned', in_progress: opt.awaiting ? 'completed' : 'in_progress', on_hold: 'on_hold', resolved: 'verified', reopened: 'assigned' }[status];
      t.workOrderId = new mongoose.Types.ObjectId();
      ticketWos.push({
        _id: t.workOrderId, ...P, number: num('WO'), type: a ? 'breakdown' : 'corrective', title: description.slice(0, 80), ticketId: t._id, assetId: a?._id, locationId: z._id, departmentId: t.assignedDeptId,
        assigneeIds: [tech._id], status: woStatus, priority, plannedDate: createdAt, startedAt: reached >= 3 ? new Date(+createdAt + ageMin * 0.3 * MIN) : undefined,
        completedAt: opt.awaiting || status === 'resolved' ? new Date(+createdAt + ageMin * 0.75 * MIN) : undefined, findings: opt.awaiting ? 'Loose fan pulley bolt tightened; bearing greased; noise gone.' : undefined,
        checklist: [{ label: 'Equipment isolated / area made safe', type: 'yesno', required: true, value: opt.awaiting ? true : undefined }, { label: 'Root cause identified', type: 'text', required: true, value: opt.awaiting ? 'Loose pulley bolt' : undefined }, { label: 'Equipment tested and working after repair', type: 'yesno', required: true, value: opt.awaiting ? true : undefined }],
      });
    }
    tickets.push(t);
  }
  await M.Ticket.insertMany(tickets);
  await M.WorkOrder.insertMany(ticketWos);

  // ── Vendors: contracts, AMCs (3 due within 30 days), visits, invoices ──
  const contract = async (v, title, startDays, endDays, value, scope) => M.Contract.create({ ...P, vendorId: vendor[v]._id, number: `CTR-${v.slice(4)}-${year}`, title, scope, start: istAt(addDays(today, startDays)), end: istAt(addDays(today, endDays)), value, paymentTerms: '30 days from invoice', slaTerms: 'Breakdown response within 4 hours, 24x7', penalty: '0.5% of monthly value per missed visit', status: endDays <= 90 ? 'expiring' : 'active' });
  const amcDefs = [
    ['VEN-CHL', 'Chiller AMC – comprehensive', ['CH-01', 'CH-02', 'CH-03'], 'quarterly', 20, 1800000], ['VEN-LFT', 'Lift AMC – 12 lifts', Object.keys(asset).filter((c) => c.startsWith('LIFT')), 'monthly', 12, 1440000],
    ['VEN-DG', 'DG AMC – 4 sets', ['DG-01', 'DG-02', 'DG-03', 'DG-04'], 'monthly', 25, 960000], ['VEN-FIR', 'Fire systems AMC', Object.keys(asset).filter((c) => c.startsWith('FIRE')), 'quarterly', 200, 720000],
    ['VEN-STP', 'STP operation & maintenance', ['STP-01'], 'monthly', 300, 600000],
  ];
  const amcs = [];
  for (const [v, name, codes, freq, endDays, value] of amcDefs) {
    const c = await contract(v, name, endDays - 365, endDays, value, `Preventive maintenance and breakdown support for ${codes.length} asset(s)`);
    const amc = await M.Amc.create({ ...P, name, contractId: c._id, vendorId: vendor[v]._id, assetIds: codes.map((x) => asset[x]._id), type: 'comprehensive', visitFrequency: freq, start: c.start, end: c.end, value, status: endDays <= 90 ? 'expiring' : 'active' });
    await M.Asset.updateMany({ _id: { $in: amc.assetIds } }, { amcId: amc._id });
    amcs.push(amc);
    const step = { monthly: 30, quarterly: 91 }[freq];
    for (let back = step; back <= 100; back += step) {
      const missed = v === 'VEN-DG' && back === 60;
      await M.AmcVisit.create({ ...P, amcId: amc._id, vendorId: vendor[v]._id, plannedDate: istAt(addDays(today, -back)), actualDate: missed ? undefined : istAt(addDays(today, -back + int(0, 2))), technicianName: missed ? undefined : vendor[v].contacts[0].name, findings: missed ? undefined : 'Routine service completed, no major issues.', status: missed ? 'missed' : 'done' });
    }
  }
  await contract('VEN-HKC', 'Housekeeping manpower (40)', -200, 165, 6600000, 'Deploy 40 housekeeping staff across 3 shifts');
  await contract('VEN-SEC', 'Security manpower (35)', -200, 165, 7350000, 'Deploy 35 guards 24x7 with supervisors');
  await contract('VEN-HVS', 'HVAC spares rate contract', -100, 265, 900000, 'Filters, belts and spares at agreed rates');
  for (const [v, contracted] of [['VEN-HKC', 40], ['VEN-SEC', 35]]) {
    for (let d = -6; d <= 0; d++) {
      const present = contracted - int(0, d === 0 ? 3 : 4);
      await M.ContractorDeployment.create({ ...P, vendorId: vendor[v]._id, departmentId: dept[v === 'VEN-HKC' ? 'HK' : 'SEC']._id, date: addDays(today, d), contractedHeadcount: contracted, presentCount: present, status: d === 0 ? 'submitted' : 'approved', approvalLevels: ['supervisor'] });
    }
  }

  // ── Procurement ──
  const filter = itemBy('AHU pre-filter 24x24x2');
  const belt = itemBy('V-belt B-52');
  const pr1 = await M.PurchaseRequest.create({ ...P, number: num('PR'), items: [{ itemId: filter._id, qty: 20, rate: filter.unitCost }, { itemId: belt._id, qty: 10, rate: belt.unitCost }], reason: 'Quarterly AHU filter replacement stock', requestedBy: U.store._id, status: 'ordered', approvalLevels: ['supervisor', 'property_manager'], currentLevel: 1, approvals: [{ by: U['eng.supervisor']._id, byName: E.engSup.name, action: 'approved', level: 'supervisor', at: istAt(addDays(today, -6)) }, { by: U.pm._id, byName: E.pm.name, action: 'approved', level: 'property_manager', at: istAt(addDays(today, -5)) }] });
  await M.PurchaseOrder.create({ ...P, number: num('PO'), prId: pr1._id, vendorId: vendor['VEN-HVS']._id, items: [{ itemId: filter._id, qty: 20, rate: 900, gstPct: 18 }, { itemId: belt._id, qty: 10, rate: 455, gstPct: 18 }], deliveryDate: istAt(addDays(today, 3)), terms: 'Delivery to Engineering Store. Payment 30 days.', status: 'sent', approvalLevels: ['property_manager'], approvals: [{ by: U.pm._id, byName: E.pm.name, action: 'approved', level: 'property_manager', at: istAt(addDays(today, -4)) }] });
  const led = itemBy('LED tube 20W');
  const mcb = itemBy('MCB 32A DP');
  await M.PurchaseRequest.create({ ...P, number: num('PR'), items: [{ itemId: led._id, qty: 60, rate: led.unitCost }, { itemId: mcb._id, qty: 20, rate: mcb.unitCost }], reason: 'Electrical spares below reorder level', requestedBy: U['eng.supervisor']._id, status: 'submitted', approvalLevels: ['supervisor', 'property_manager'], currentLevel: 1, approvals: [{ by: U['eng.supervisor']._id, byName: E.engSup.name, action: 'approved', level: 'supervisor', at: istAt(addDays(today, -1)) }] });
  await M.VendorInvoice.insertMany([
    ['VEN-LFT', 'VL/2026/0912', 120000, 'paid', -40], ['VEN-CHL', 'CA-INV-7781', 150000, 'approved', -12], ['VEN-HKC', 'SC/OCT/118', 550000, 'verified', -5], ['VEN-DG', 'PG-2219', 80000, 'submitted', -2],
  ].map(([v, number, amount, status, d]) => ({ ...P, vendorId: vendor[v]._id, number, invoiceDate: istAt(addDays(today, d)), amount, gst: amount * 0.18, total: amount * 1.18, status, paymentRef: status === 'paid' ? 'NEFT-UTR-88231' : undefined })));

  // ── Leave / OT ──
  const hvac3 = byDesig('HVAC Technician')[3];
  const guard = byDesig('Security Guard')[2];
  await M.LeaveRequest.insertMany([
    { ...P, employeeId: hvac3._id, departmentId: dept.ENG._id, type: 'casual', from: istAt(addDays(today, 3)), to: istAt(addDays(today, 4)), days: 2, reason: 'Family function', status: 'submitted', approvalLevels: ['supervisor'] },
    { ...P, employeeId: guard._id, departmentId: dept.SEC._id, type: 'sick', from: istAt(addDays(today, -2)), to: istAt(addDays(today, -2)), days: 1, reason: 'Fever', status: 'approved', approvalLevels: ['supervisor'] },
  ]);
  await M.OvertimeRequest.create({ ...P, employeeId: byDesig('Electrician')[1]._id, departmentId: dept.ENG._id, date: istAt(addDays(today, -1)), hours: 3, reason: 'Lift B-03 rescue and shutdown', status: 'submitted', approvalLevels: ['supervisor'] });

  // ── HSE ──
  const monthStart = istAt(`${today.slice(0, 7)}-01`, '00:00');
  const incAt = new Date(Math.min(+now - 10 * MIN, Math.max(+monthStart + 2 * H, +now - 4 * DAY_MS)));
  const capa1 = new M.Capa({ ...P, number: num('CAPA'), sourceType: 'incident', kind: 'corrective', action: 'Place anti-slip mats and wet-floor signs at Tower B lobby entrances during rain', ownerId: U['hk.supervisor']._id, dueDate: istAt(addDays(today, 3)), status: 'in_progress' });
  const inc = await M.Incident.create({ ...P, number: num('INC'), title: 'Visitor slipped on wet floor at Tower B lobby', type: 'injury', severity: 'minor', occurredAt: incAt, locationId: loc['PTP-B-01-LOBBY']._id, people: ['Visitor (Orbit Fintech guest)'], description: 'Floor was wet after rain; no wet-floor sign in place. Minor knee bruise, first aid given.', immediateAction: 'First aid given; area cordoned and dried.', rootCause: 'No anti-slip mat and missing wet-floor sign at the entrance during rain.', status: 'capa', capaIds: [capa1._id], reportedBy: U['sec.supervisor']._id, history: [hist('reported', incAt, E.secSup.name), hist('immediate_action', new Date(+incAt + 20 * MIN), E.hse.name), hist('investigation', new Date(+incAt + 3 * H), E.hse.name), hist('capa', new Date(+incAt + 5 * H), E.hse.name)] });
  capa1.sourceId = inc._id;
  await capa1.save();
  await M.Incident.create({ ...P, number: num('INC'), title: 'Electrical panel sparking in B-basement', type: 'electrical', severity: 'major', occurredAt: istAt(addDays(today, -45)), locationId: loc['PTP-BSMT']._id, description: 'Loose termination at sub-panel caused sparking; panel isolated.', immediateAction: 'Panel isolated', rootCause: 'Loose termination', correctiveAction: 'Thermography of all panels', verificationNote: 'Thermography done, no hot spots', status: 'closed', reportedBy: U['eng.supervisor']._id });
  await M.Capa.insertMany([
    { ...P, number: num('CAPA'), sourceType: 'inspection', kind: 'corrective', action: 'Refill 3 expired fire extinguishers in Tower C', ownerId: U.hse._id, dueDate: istAt(addDays(today, -2)), status: 'open' },
    { ...P, number: num('CAPA'), sourceType: 'observation', kind: 'preventive', action: 'Install guard rail on terrace edge near chiller cooling tower', ownerId: U.pm._id, dueDate: istAt(addDays(today, 10)), status: 'open' },
    { ...P, number: num('CAPA'), sourceType: 'audit', kind: 'preventive', action: 'Conduct quarterly mock fire drill for Tower A', ownerId: U.hse._id, dueDate: istAt(addDays(today, -10)), status: 'done', evidence: [] },
  ]);
  await M.Inspection.insertMany([
    ['Fire extinguisher inspection – Tower A', 'fire_extinguisher', -20, 'done', 92], ['Emergency exit inspection – all towers', 'emergency_exit', -14, 'done', 100], ['Electrical panel inspection – basement', 'electrical_panel', -9, 'done', 88],
    ['Housekeeping safety walk – Tower B', 'housekeeping_safety', -3, 'done', 95], ['Fire extinguisher inspection – Tower C', 'fire_extinguisher', 0, 'scheduled'], ['Work at height check – terrace', 'work_at_height', 4, 'scheduled'],
  ].map(([title, type, d, status, score]) => ({ ...P, title, type, scheduledDate: istAt(addDays(today, d), '11:00'), status, score, doneAt: status === 'done' ? istAt(addDays(today, d), '12:00') : undefined, doneBy: status === 'done' ? U.hse._id : undefined, findings: status === 'done' ? 'Minor observations noted.' : undefined })));
  await M.Observation.insertMany([
    ['unsafe_condition', 'Cable lying across walkway in B-basement', 3, 3], ['unsafe_act', 'Technician working on ladder without helper', 4, 4], ['unsafe_condition', 'Fire exit door blocked by cartons at A-07', 3, 5],
    ['unsafe_condition', 'Missing manhole cover near STP', 2, 5], ['unsafe_act', 'Housekeeping staff not wearing gloves with chemicals', 4, 2], ['unsafe_condition', 'Loose handrail on Tower C staircase', 2, 3],
    ['unsafe_condition', 'Oil spill near DG yard', 3, 3], ['unsafe_act', 'Guard using phone while on patrol duty', 3, 1], ['unsafe_condition', 'Emergency light not working at B-09 stairs', 2, 4], ['unsafe_condition', 'Water leakage near electrical room', 3, 4],
  ].map(([type, description, likelihood, severity], i) => ({ ...P, type, description, likelihood, severity, riskScore: likelihood * severity, status: i < 6 ? 'open' : 'closed', createdBy: U.hse._id })));
  await M.Compliance.insertMany([
    ['Fire NOC', 'Telangana State Disaster Response & Fire Services', 'FIRE/HYD/2025/4471', -300, 430], ['Lift licence (12 lifts)', 'Electrical Inspectorate, Telangana', 'LIFT/RR/2026/0912', -200, 165],
    ['DG pollution consent', 'Telangana State Pollution Control Board', 'TSPCB/CFO/DG/8812', -330, 35], ['STP consent to operate', 'Telangana State Pollution Control Board', 'TSPCB/CFO/STP/3321', -320, 45],
    ['Electrical inspector certificate', 'Chief Electrical Inspector to Govt.', 'CEIG/HT/2026/118', -100, 265], ['Occupancy certificate', 'GHMC', 'GHMC/OC/2019/552', -2200, 3000],
  ].map(([name, authority, certificateNo, from, to]) => ({ ...P, name, authority, certificateNo, validFrom: istAt(addDays(today, from)), validTo: istAt(addDays(today, to)), ownerId: U.hse._id })));
  await M.Permit.insertMany([
    { ...P, number: num('PTW'), type: 'hot_work', locationId: loc['PTP-TERRACE']._id, workDescription: 'Welding of cooling tower support bracket', requestedBy: U['eng.supervisor']._id, contractor: 'In-house', validFrom: istAt(today, '10:00'), validTo: istAt(today, '17:00'), precautions: 'Fire extinguisher at site, fire watch for 30 minutes after work', status: 'requested', approvalLevels: ['hse_officer'] },
    { ...P, number: num('PTW'), type: 'electrical_isolation', locationId: loc['PTP-UTILITY']._id, workDescription: 'TR-03 oil sampling under shutdown', requestedBy: U['eng.supervisor']._id, validFrom: istAt(addDays(today, -1), '22:00'), validTo: istAt(today, '06:00'), status: 'closed', approvalLevels: ['hse_officer'] },
  ]);
  await M.Training.insertMany([
    { ...P, type: 'fire_drill', topic: 'Quarterly fire evacuation drill – Tower A', date: istAt(addDays(today, -18)), trainer: E.hse.name, attendees: emps.slice(0, 40).map((e) => e._id), durationMin: 45 },
    { ...P, type: 'toolbox_talk', topic: 'Working safely on ladders', date: istAt(addDays(today, -6)), trainer: E.engSup.name, attendees: emps.filter((e) => e.departmentId.equals(dept.ENG._id)).map((e) => e._id), durationMin: 20 },
    { ...P, type: 'induction', topic: 'Chemical handling and MSDS for housekeeping', date: istAt(addDays(today, -2)), trainer: E.hse.name, attendees: emps.filter((e) => e.departmentId.equals(dept.HK._id)).slice(0, 20).map((e) => e._id), durationMin: 30 },
  ]);

  // ── KPI definitions + 30 days of snapshots ──
  const KPIS = [
    ['attendance', 'Staff Attendance', '%', 'higher', 95, 90, 'Present ÷ rostered staff whose shift has started today', 'Admin / HR'],
    ['sla', 'SLA Compliance', '%', 'higher', 95, 90, 'Tickets resolved within response and resolution SLA ÷ tickets resolved (last 30 days)', 'Helpdesk'],
    ['ppm', 'PPM Completion', '%', 'higher', 95, 90, 'PPM work orders completed ÷ planned (last 30 days)', 'Engineering'],
    ['open_complaints', 'Open Complaints', 'count', 'lower', 20, 30, 'Tickets not yet confirmed or closed', 'Helpdesk'],
    ['critical_complaints', 'Critical Complaints', 'count', 'lower', 0, 2, 'Open P1 tickets', 'Engineering'],
    ['amc_due', 'AMC Due', 'count', 'lower', 0, 3, 'AMCs ending in the next 30 days', 'Facility Management'],
    ['inventory_alerts', 'Inventory Alerts', 'count', 'lower', 0, 5, 'Store items at or below reorder level', 'Stores'],
    ['hse_incidents', 'HSE Incidents', 'count', 'lower', 0, 1, 'Incidents reported this month', 'HSE'],
  ];
  await M.KpiDefinition.insertMany(KPIS.map(([code, name, unit, direction, target, amberAt, formula, responsibility], order) => ({ orgId, code, name, unit, direction, target, amberAt, redAt: amberAt, formula, responsibility, order })));
  const snaps = [];
  for (let d = -30; d <= -1; d++) {
    const wave = Math.sin(d / 3);
    const v = { attendance: 93.6 + wave * 1.4 + rand() * 0.8, sla: 95.6 + wave + rand(), ppm: 91.5 + wave * 1.5 + rand(), open_complaints: Math.round(18 + wave * 4 + rand() * 3), critical_complaints: int(0, 3), amc_due: d > -10 ? 3 : 2, inventory_alerts: int(3, 6), hse_incidents: d >= -4 ? 1 : 0 };
    const target = { attendance: 95, sla: 95, ppm: 95, open_complaints: 20, critical_complaints: 0, amc_due: 0, inventory_alerts: 0, hse_incidents: 0 };
    snaps.push({ ...P, date: addDays(today, d), values: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { actual: Math.round(x * 10) / 10, target: target[k], variance: Math.round((x - target[k]) * 10) / 10 }])) });
  }
  await M.KpiSnapshot.insertMany(snaps);

  // ── Daily ops: action items, logs, notifications ──
  await M.ActionItem.insertMany([
    ['Close DG-02 breakdown and share RCA with client', U['eng.supervisor'], 0, 'open'], ['Renew lift AMC before expiry', U.pm, 7, 'in_progress'],
    ['Anti-slip mats for all lobby entrances', U['hk.supervisor'], 3, 'open'], ['Raise PO for electrical spares below reorder level', U.procurement, 2, 'open'],
  ].map(([title, owner, d, status]) => ({ ...P, source: 'daily_review', title, ownerId: owner._id, dueDate: istAt(addDays(today, d), '18:00'), status, createdBy: U.pm._id })));
  await M.ShiftLog.create({ ...P, departmentId: dept.SEC._id, date: today, shiftId: shift.A._id, kind: 'occurrence_book', entries: [{ time: istAt(today, '06:05'), text: 'Shift A took over. 12 guards on post. All CCTV working.', byName: E.secSup.name }, { time: istAt(today, '07:40'), text: 'Water tanker entry at gate 2, vehicle checked.', byName: E.secSup.name }] });
  for (const u of users.filter((x) => x.isDemo)) await M.Notification.create({ userId: u._id, propertyId: property._id, type: 'welcome', title: 'Welcome to PrimeSpace IPFM', body: 'Open the Help Center (? icon) for a 2-minute tour of what you can do.', link: '/help' });

  // ── Approval rules and report schedules (editable in Setup / Reports) ──
  const RULE_TEXT = { purchase_request: 'Supervisor, then PM; owner as well above Rs 1,00,000', purchase_order: 'PM; owner as well above Rs 2,00,000', amc_renewal: 'PM then owner' };
  await M.ApprovalRule.insertMany(Object.entries(DEFAULT_APPROVAL_RULES).map(([entityType, levels]) => ({ orgId, entityType, levels, description: RULE_TEXT[entityType] || 'Single approval', active: true })));
  await M.ReportSchedule.insertMany([
    { ...P, type: 'daily', time: '07:00', recipients: ['client.reports@primetechpark.example'], sendOnSignOff: true, lastRunKey: `daily:${today}` },
    { ...P, type: 'weekly', time: '07:00', dayOfWeek: 1, recipients: ['client.reports@primetechpark.example', 'facilities.head@primetechpark.example'], sendOnSignOff: true },
    { ...P, type: 'monthly', time: '07:00', dayOfMonth: 1, recipients: ['client.reports@primetechpark.example', 'facilities.head@primetechpark.example'], sendOnSignOff: true },
  ]);

  // ── Second demo property (portfolio, property switcher, data isolation) ──
  const mall = await seedMall({ orgId, role, slaPolicy, tcats, acats: acat, tpls, vendor, itemDocs, passwordHash, numFor, today, now, goLive: GO_LIVE });
  await M.User.updateMany({ email: { $in: ['owner@primespace.demo', 'admin@primespace.demo', 'auditor@primespace.demo'] } }, { $addToSet: { propertyIds: mall.property._id } });

  // ── Counters, PPM look-ahead, sample reports ──
  await M.Counter.insertMany(Object.entries(counters).map(([key, seq]) => ({ key, seq })));
  await generatePpm(7);
  await als.run({ propertyId: property._id, orgId }, async () => {
    const weekly = await generateReport('weekly', addDays(today, -1), U.pm);
    Object.assign(weekly, { status: 'signed_off', signedBy: U.pm._id, signedAt: new Date(), commentary: 'Attendance and PPM slightly below target due to shift changes; recovery plan in place.' });
    await weekly.save();
    await generateReport('daily', today, U.pm);
  });

  const summary = { properties: 2, mallTickets: mall.tickets, users: users.length + mall.users, employees: emps.length, locations: locs.length, assets: assetDocs.length, tickets: tickets.length, items: itemDocs.length, vendors: vendors.length, password: PASSWORD };
  log(`Seed complete: ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDb();
  await seed();
  console.log('\nDemo logins (password Demo@123):');
  for (const e of ['admin', 'owner', 'pm', 'eng.supervisor', 'helpdesk', 'hvac.tech', 'store', 'procurement', 'hse', 'vendor', 'tenant', 'auditor', 'pm.mall']) console.log(`  ${e}@primespace.demo`);
  await mongoose.disconnect();
}
