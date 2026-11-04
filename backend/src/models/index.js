import mongoose from 'mongoose';
import { basePlugin } from './plugin.js';
import { encrypt } from '../lib/crypto.js';

const { Schema } = mongoose;
const { ObjectId, Mixed } = Schema.Types;

const ref = (model, extra = {}) => ({ type: ObjectId, ref: model, ...extra });
const en = (values, def) => ({ type: String, enum: values, ...(def !== undefined && { default: def }) });
const req = (type = String, extra = {}) => ({ type, required: true, ...extra });
const UNIQUE = { unique: true, partialFilterExpression: { isDeleted: false } };

const history = [{ status: String, by: ref('User'), byName: String, at: { type: Date, default: Date.now }, note: String }];
const approvalFields = {
  approvals: [{ by: ref('User'), byName: String, action: String, level: String, comment: String, at: { type: Date, default: Date.now } }],
  approvalLevels: [String],
  currentLevel: { type: Number, default: 0 },
};
const docs = [{ name: String, type: { type: String }, number: String, url: String, expiry: Date }];

function model(name, fields, { scope = 'property', indexes = [], setup, collection } = {}) {
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new Schema(fields, collection ? { collection } : {});
  schema.plugin(basePlugin, { scope });
  indexes.forEach(([spec, opts]) => schema.index(spec, opts));
  setup?.(schema);
  return mongoose.model(name, schema);
}

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const TICKET_STATUSES = ['new', 'assigned', 'acknowledged', 'in_progress', 'on_hold', 'resolved', 'tenant_confirmed', 'closed', 'reopened', 'cancelled'];
export const OPEN_TICKET = ['new', 'assigned', 'acknowledged', 'in_progress', 'on_hold', 'reopened', 'resolved'];
export const WO_STATUSES = ['scheduled', 'assigned', 'in_progress', 'on_hold', 'completed', 'verified', 'closed', 'cancelled'];
export const WO_OPEN = ['scheduled', 'assigned', 'in_progress', 'on_hold'];
export const WO_DONE = ['completed', 'verified', 'closed'];
const APPROVAL_STATUS = en(['draft', 'submitted', 'approved', 'rejected', 'cancelled'], 'submitted');

// ── M1 Property & location setup ───────────────────────────────────────────
export const Organization = model('Organization', {
  name: req(), type: en(['operator', 'client'], 'client'), gstin: String, logo: String, address: String, settings: Mixed,
}, { scope: 'none' });

export const Property = model('Property', {
  name: req(), code: req(String, { uppercase: true, trim: true }), type: en(['mall', 'tech_park', 'commercial'], 'tech_park'),
  address: String, city: String, areaSqft: Number, is24x7: { type: Boolean, default: true },
  operatingHours: { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' } },
  timezone: { type: String, default: 'Asia/Kolkata' }, logo: String,
  geoFence: { type: en(['circle', 'polygon'], 'circle'), lat: Number, lng: Number, radiusM: { type: Number, default: 300 }, polygon: { type: [[Number]], default: undefined }, policy: en(['flag', 'block'], 'flag') },
  slaPolicyId: ref('SlaPolicy'),
  approvalLimits: { prOwnerAbove: { type: Number, default: 100000 }, poOwnerAbove: { type: Number, default: 200000 } },
  goLive: [{ phase: Number, task: String, done: Boolean, owner: String }],
  settings: { reportRecipients: [String], payrollWebhookUrl: String, selfieRetentionDays: { type: Number, default: 90 } },
  isDemo: Boolean, status: en(['active', 'inactive'], 'active'),
}, { scope: 'none', indexes: [[{ orgId: 1, code: 1 }, UNIQUE]] });

export const Location = model('Location', {
  parentId: ref('Location'), type: en(['tower', 'floor', 'zone', 'room', 'area'], 'zone'),
  name: req(), code: req(String, { uppercase: true, trim: true }), path: String, level: Number,
}, { indexes: [[{ propertyId: 1, code: 1 }, UNIQUE], [{ path: 1 }]] });

export const Department = model('Department', {
  name: req(), code: req(String, { uppercase: true }), headUserId: ref('User'), description: String,
}, { indexes: [[{ propertyId: 1, code: 1 }, UNIQUE]] });

export const Tenant = model('Tenant', {
  name: req(), units: [ref('Location')], contacts: [{ name: String, phone: String, email: String }],
  leaseStart: Date, leaseEnd: Date, status: en(['active', 'inactive'], 'active'),
});

export const Shift = model('Shift', {
  name: req(), code: req(String, { uppercase: true }), start: req(), end: req(),
  graceMin: { type: Number, default: 10 }, breakMin: { type: Number, default: 30 }, crossesMidnight: Boolean, color: String,
});

export const Holiday = model('Holiday', { name: req(), date: req(String), optional: Boolean });

export const SlaPolicy = model('SlaPolicy', {
  name: req(), calendar: en(['24x7', 'business'], '24x7'), isDefault: Boolean,
  rules: [{ priority: en(PRIORITIES), responseMin: Number, resolutionMin: Number }],
  escalation: [{ level: Number, afterPct: Number, role: String }],
}, { scope: 'org' });

export const TicketCategory = model('TicketCategory', {
  name: req(), code: req(String, { uppercase: true }), subCategories: [String], departmentCode: String,
  defaultPriority: en(PRIORITIES, 'P3'), sopId: ref('Sop'), icon: String,
}, { scope: 'org' });

// ── M2 Users, roles, approvals ─────────────────────────────────────────────
export const Role = model('Role', {
  key: req(), name: req(), description: String, permissions: [String], isSystem: Boolean, layout: en(['office', 'field'], 'office'),
}, { scope: 'org', indexes: [[{ orgId: 1, key: 1 }, UNIQUE]] });

export const User = model('User', {
  name: req(), email: req(String, { lowercase: true, trim: true }), mobile: String,
  passwordHash: { type: String, select: false },
  roleIds: [ref('Role')], propertyIds: [ref('Property')], departmentIds: [ref('Department')],
  employeeId: ref('Employee'), vendorId: ref('Vendor'), tenantId: ref('Tenant'),
  status: en(['active', 'inactive'], 'active'), lastLogin: Date,
  failedAttempts: { type: Number, default: 0 }, lockUntil: Date, tokenVersion: { type: Number, default: 0 },
  resetOtpHash: { type: String, select: false }, resetOtpExpires: { type: Date, select: false },
  notificationPrefs: Mixed, avatar: String, isDemo: Boolean,
}, { scope: 'none', indexes: [[{ email: 1 }, UNIQUE], [{ mobile: 1 }]] });

export const Delegation = model('Delegation', {
  fromUserId: req(ObjectId, { ref: 'User' }), toUserId: req(ObjectId, { ref: 'User' }), from: req(Date), to: req(Date), reason: String, active: { type: Boolean, default: true },
});

// ── M3 Workforce & attendance ──────────────────────────────────────────────
export const Employee = model('Employee', {
  code: req(String, { uppercase: true }), name: req(), photo: String, mobile: String, email: String,
  departmentId: ref('Department'), designation: String, skills: [String],
  employmentType: en(['permanent', 'contract'], 'permanent'), contractorVendorId: ref('Vendor'),
  shiftGroup: String, supervisorId: ref('Employee'), joiningDate: Date, documents: docs,
  emergencyContact: { name: String, phone: String }, status: en(['active', 'inactive', 'exited'], 'active'), userId: ref('User'),
}, { indexes: [[{ propertyId: 1, code: 1 }, UNIQUE], [{ departmentId: 1 }]] });

export const Roster = model('Roster', {
  departmentId: ref('Department'), employeeId: req(ObjectId, { ref: 'Employee' }), date: req(),
  shiftId: ref('Shift'), postLocationId: ref('Location'), isWeeklyOff: Boolean, published: Boolean,
}, { indexes: [[{ employeeId: 1, date: 1 }, UNIQUE], [{ propertyId: 1, date: 1 }]] });

const punch = { time: Date, source: en(['mobile', 'biometric', 'face', 'manual']), lat: Number, lng: Number, selfieUrl: String, deviceId: String, insideFence: Boolean, distanceM: Number, offline: Boolean, syncedAt: Date };
export const Attendance = model('Attendance', {
  employeeId: req(ObjectId, { ref: 'Employee' }), departmentId: ref('Department'), date: req(), shiftId: ref('Shift'),
  checkIn: punch, checkOut: punch, workedMin: Number,
  status: en(['present', 'absent', 'half_day', 'leave', 'weekly_off', 'holiday'], 'present'),
  exceptions: [String], exceptionResolved: Boolean, manualReason: String, approvedBy: ref('User'), locked: Boolean, privacyPurgedAt: Date,
}, { collection: 'attendance', indexes: [[{ employeeId: 1, date: 1 }, UNIQUE], [{ propertyId: 1, date: 1, status: 1 }]] });

export const LeaveRequest = model('LeaveRequest', {
  employeeId: req(ObjectId, { ref: 'Employee' }), departmentId: ref('Department'),
  type: en(['casual', 'sick', 'earned', 'comp_off'], 'casual'), from: req(Date), to: req(Date), days: Number, reason: String,
  status: APPROVAL_STATUS, ...approvalFields,
}, { indexes: [[{ employeeId: 1, status: 1 }]] });

export const OvertimeRequest = model('OvertimeRequest', {
  employeeId: req(ObjectId, { ref: 'Employee' }), departmentId: ref('Department'), date: req(Date), hours: req(Number), reason: String,
  status: APPROVAL_STATUS, ...approvalFields,
});

export const Regularization = model('Regularization', {
  employeeId: req(ObjectId, { ref: 'Employee' }), departmentId: ref('Department'), date: req(),
  requestedIn: Date, requestedOut: Date, reason: req(), status: APPROVAL_STATUS, ...approvalFields,
});

export const ContractorDeployment = model('ContractorDeployment', {
  vendorId: req(ObjectId, { ref: 'Vendor' }), departmentId: ref('Department'), date: req(),
  contractedHeadcount: req(Number), presentCount: req(Number), shortfall: Number, remarks: String,
  status: en(['submitted', 'approved', 'rejected'], 'submitted'), ...approvalFields,
}, {
  indexes: [[{ vendorId: 1, date: 1 }]],
  setup: (s) => s.pre('validate', function () { this.shortfall = Math.max(0, (this.contractedHeadcount || 0) - (this.presentCount || 0)); }),
});

// ── M4 Assets, checklists, PPM, work orders ────────────────────────────────
export const AssetCategory = model('AssetCategory', {
  name: req(), code: req(String, { uppercase: true }), icon: String,
  customFields: [{ key: String, label: String, type: { type: String, default: 'text' }, unit: String }],
}, { scope: 'org' });

export const Asset = model('Asset', {
  code: req(String, { uppercase: true }), name: req(), categoryId: ref('AssetCategory'),
  make: String, model: String, serialNo: String, capacity: String, specs: Mixed,
  locationId: ref('Location'), departmentId: ref('Department'), criticality: en(['critical', 'high', 'normal'], 'normal'),
  installDate: Date, warrantyExpiry: Date, cost: Number, amcId: ref('Amc'),
  status: en(['running', 'standby', 'under_maintenance', 'breakdown', 'decommissioned'], 'running'),
  photos: [String], docs, runHours: Number,
}, { indexes: [[{ propertyId: 1, code: 1 }, UNIQUE], [{ locationId: 1 }], [{ categoryId: 1 }], [{ status: 1 }]] });

export const MeterReading = model('MeterReading', {
  assetId: ref('Asset'), type: en(['energy', 'water', 'dg_fuel', 'run_hours', 'temperature', 'other'], 'energy'),
  label: String, value: req(Number), unit: String, readAt: { type: Date, default: Date.now }, note: String, workOrderId: ref('WorkOrder'),
}, { indexes: [[{ assetId: 1, readAt: -1 }]] });

export const ChecklistTemplate = model('ChecklistTemplate', {
  name: req(), appliesTo: en(['ppm', 'inspection', 'daily_check', 'breakdown'], 'ppm'), categoryCode: String,
  items: [{ label: String, type: en(['yesno', 'number', 'text', 'photo', 'reading'], 'yesno'), min: Number, max: Number, unit: String, required: { type: Boolean, default: true }, photoRequired: Boolean, autoTicket: Boolean }],
  sopId: ref('Sop'),
}, { scope: 'org' });

export const PpmSchedule = model('PpmSchedule', {
  title: String, kind: en(['ppm', 'daily_check'], 'ppm'), assetId: req(ObjectId, { ref: 'Asset' }), templateId: ref('ChecklistTemplate'),
  frequency: en(['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'run_hours'], 'monthly'),
  runHoursInterval: Number, lastRunHours: Number, departmentId: ref('Department'), assigneeIds: [ref('User')],
  startDate: Date, nextDueDate: Date, active: { type: Boolean, default: true }, sopId: ref('Sop'),
}, { indexes: [[{ nextDueDate: 1 }], [{ assetId: 1 }]] });

export const WorkOrder = model('WorkOrder', {
  number: String, type: en(['ppm', 'daily_check', 'breakdown', 'corrective', 'amc_visit', 'inspection'], 'corrective'), title: String, offlineSync: Boolean,
  assetId: ref('Asset'), ticketId: ref('Ticket'), scheduleId: ref('PpmSchedule'), vendorId: ref('Vendor'),
  locationId: ref('Location'), departmentId: ref('Department'), assigneeIds: [ref('User')],
  status: en(WO_STATUSES, 'scheduled'), priority: en(PRIORITIES, 'P3'), plannedDate: Date, startedAt: Date, completedAt: Date,
  checklist: [{ label: String, type: { type: String }, min: Number, max: Number, unit: String, required: Boolean, photoRequired: Boolean, autoTicket: Boolean, value: Mixed, photoUrl: String, deviation: Boolean }],
  findings: String, partsUsed: [{ itemId: ref('Item'), name: String, qty: Number, cost: Number, issueId: ref('MaterialIssue') }],
  beforePhotos: [String], afterPhotos: [String], signature: String,
  verifiedBy: ref('User'), verifiedAt: Date, rejectReason: String, downtimeMin: Number, history,
}, {
  indexes: [
    [{ propertyId: 1, number: 1 }, UNIQUE], [{ status: 1 }], [{ assetId: 1 }], [{ plannedDate: 1 }],
    [{ scheduleId: 1, plannedDate: 1 }, { unique: true, partialFilterExpression: { scheduleId: { $exists: true }, isDeleted: false } }],
  ],
});

// ── M5 Helpdesk ────────────────────────────────────────────────────────────
export const Ticket = model('Ticket', {
  number: String, source: en(['tenant_portal', 'helpdesk', 'mobile', 'qr', 'email', 'checklist', 'bms', 'api'], 'helpdesk'),
  categoryId: ref('TicketCategory'), subCategory: String, locationId: ref('Location'), assetId: ref('Asset'),
  description: req(), photos: [String], reporterId: ref('User'), tenantId: ref('Tenant'),
  priority: en(PRIORITIES, 'P3'), suggestedPriority: String, priorityOverrideReason: String,
  status: en(TICKET_STATUSES, 'new'), assignedDeptId: ref('Department'), assigneeId: ref('User'), vendorId: ref('Vendor'),
  workOrderId: ref('WorkOrder'), resolutionNotes: String, holdReason: String, awaitingVerification: Boolean,
  sla: {
    policyId: ref('SlaPolicy'), startedAt: Date, responseDue: Date, resolutionDue: Date, respondedAt: Date, resolvedAt: Date,
    pausedMin: { type: Number, default: 0 }, pausedAt: Date, responseBreached: Boolean, resolutionBreached: Boolean,
  },
  escalationLevel: { type: Number, default: 0 },
  tenantConfirmation: { status: en(['pending', 'confirmed', 'rejected', 'auto']), rating: Number, comment: String, at: Date },
  history, comments: [{ by: ref('User'), byName: String, text: String, mentions: [ref('User')], at: { type: Date, default: Date.now } }],
  mergedInto: ref('Ticket'), closedAt: Date,
}, { indexes: [[{ propertyId: 1, number: 1 }, UNIQUE], [{ status: 1 }], [{ priority: 1 }], [{ 'sla.resolutionDue': 1 }], [{ assigneeId: 1 }], [{ locationId: 1, categoryId: 1, createdAt: -1 }]] });

// ── M6 Inventory & procurement ─────────────────────────────────────────────
export const ITEM_CATEGORIES = ['electrical_spares', 'hvac_filters', 'plumbing', 'chemicals', 'ppe', 'housekeeping', 'general'];
export const Item = model('Item', {
  code: req(String, { uppercase: true }), name: req(), category: en(ITEM_CATEGORIES, 'general'), uom: { type: String, default: 'Nos' },
  hsn: String, unitCost: { type: Number, default: 0 }, gstPct: { type: Number, default: 18 },
  minLevel: Number, reorderLevel: Number, reorderQty: Number, maxLevel: Number,
  preferredVendorId: ref('Vendor'), binLocation: String, isChemical: Boolean, msdsUrl: String,
}, { scope: 'org', indexes: [[{ orgId: 1, code: 1 }, UNIQUE]] });

export const Store = model('Store', { name: req(), code: String, type: en(['main', 'engineering', 'other'], 'main') });

export const StockBalance = model('StockBalance', {
  storeId: req(ObjectId, { ref: 'Store' }), itemId: req(ObjectId, { ref: 'Item' }),
  qty: { type: Number, default: 0, min: 0 }, value: { type: Number, default: 0 },
  batches: [{ batchNo: String, expiry: Date, qty: Number }],
}, { indexes: [[{ storeId: 1, itemId: 1 }, { unique: true }]] });

export const StockLedger = model('StockLedger', {
  storeId: ref('Store'), itemId: ref('Item'),
  type: en(['opening', 'grn', 'issue', 'return', 'transfer_in', 'transfer_out', 'adjustment', 'count']),
  qty: Number, rate: Number, refType: String, refId: ObjectId, refNumber: String, balanceAfter: Number,
  at: { type: Date, default: Date.now }, note: String, by: ref('User'),
}, { collection: 'stockledger', indexes: [[{ itemId: 1, at: -1 }], [{ refId: 1 }]] });

const lineItems = [{ itemId: ref('Item'), qty: Number, rate: Number, gstPct: Number, reason: String, receivedQty: { type: Number, default: 0 } }];

export const PurchaseRequest = model('PurchaseRequest', {
  number: String, items: lineItems, workOrderId: ref('WorkOrder'), reason: String, requestedBy: ref('User'), estTotal: Number,
  status: en(['draft', 'submitted', 'approved', 'rejected', 'ordered', 'cancelled'], 'submitted'), ...approvalFields,
}, {
  indexes: [[{ number: 1 }], [{ status: 1 }]],
  setup: (s) => s.pre('validate', function () { this.estTotal = (this.items || []).reduce((a, i) => a + (i.qty || 0) * (i.rate || 0), 0); }),
});

export const Quotation = model('Quotation', {
  prId: req(ObjectId, { ref: 'PurchaseRequest' }), vendorId: req(ObjectId, { ref: 'Vendor' }),
  items: [{ itemId: ref('Item'), rate: Number }], total: Number, deliveryDays: Number, fileUrl: String, selected: Boolean, notes: String,
});

export const PurchaseOrder = model('PurchaseOrder', {
  number: String, prId: ref('PurchaseRequest'), vendorId: req(ObjectId, { ref: 'Vendor' }), items: lineItems,
  subTotal: Number, gst: Number, total: Number, deliveryDate: Date, terms: String,
  status: en(['draft', 'submitted', 'approved', 'sent', 'partially_received', 'received', 'closed', 'rejected', 'cancelled'], 'draft'), ...approvalFields,
}, {
  indexes: [[{ number: 1 }], [{ vendorId: 1 }], [{ status: 1 }]],
  setup: (s) => s.pre('validate', function () {
    this.subTotal = (this.items || []).reduce((a, i) => a + (i.qty || 0) * (i.rate || 0), 0);
    this.gst = (this.items || []).reduce((a, i) => a + ((i.qty || 0) * (i.rate || 0) * (i.gstPct ?? 18)) / 100, 0);
    this.total = Math.round((this.subTotal + this.gst) * 100) / 100;
  }),
});

export const Grn = model('Grn', {
  number: String, poId: req(ObjectId, { ref: 'PurchaseOrder' }), storeId: req(ObjectId, { ref: 'Store' }),
  items: [{ itemId: ref('Item'), receivedQty: Number, rejectedQty: Number, reason: String, batchNo: String, expiry: Date }],
  receivedBy: ref('User'), at: { type: Date, default: Date.now }, notes: String,
}, { indexes: [[{ poId: 1 }]] });

export const MaterialIssue = model('MaterialIssue', {
  number: String, storeId: req(ObjectId, { ref: 'Store' }), workOrderId: ref('WorkOrder'), ticketId: ref('Ticket'), departmentId: ref('Department'),
  requestedBy: ref('User'), issuedTo: ref('User'), issuedBy: ref('User'), issuedAt: Date,
  items: [{ itemId: ref('Item'), qty: Number, rate: Number, returnedQty: { type: Number, default: 0 } }],
  status: en(['requested', 'issued', 'partially_returned', 'returned', 'rejected'], 'requested'), totalCost: Number, note: String, rejectReason: String,
}, { indexes: [[{ workOrderId: 1 }], [{ status: 1 }]] });

export const StockCount = model('StockCount', {
  number: String, storeId: req(ObjectId, { ref: 'Store' }),
  lines: [{ itemId: ref('Item'), systemQty: Number, countedQty: Number, variance: Number }],
  status: en(['planned', 'counted', 'approved', 'cancelled'], 'planned'), approvedBy: ref('User'), notes: String,
}, {
  setup: (s) => s.pre('validate', function () { (this.lines || []).forEach((l) => { if (l.countedQty != null) l.variance = l.countedQty - (l.systemQty || 0); }); }),
});

// ── M7 Vendors, contracts, AMC ─────────────────────────────────────────────
export const Vendor = model('Vendor', {
  name: req(), code: String, types: [en(['amc', 'supplier', 'manpower', 'service'])], gstin: String, pan: String, address: String,
  contacts: [{ name: String, phone: String, email: String }],
  bank: { accountName: String, accountNo: { type: String, select: false }, accountNoEnc: { type: String, select: false }, last4: String, ifsc: String, bankName: String },
  documents: docs, rating: Number, status: en(['active', 'inactive', 'blacklisted'], 'active'),
}, {
  scope: 'org',
  indexes: [[{ orgId: 1, gstin: 1 }]],
  setup: (s) => s.pre('validate', function () {
    const acc = this.bank?.accountNo;
    if (acc) {
      this.bank.accountNoEnc = encrypt(acc);
      this.bank.last4 = String(acc).slice(-4);
      this.bank.accountNo = undefined;
    }
  }),
});

export const Contract = model('Contract', {
  vendorId: req(ObjectId, { ref: 'Vendor' }), number: req(), title: String, scope: String, start: req(Date), end: req(Date), value: Number,
  paymentTerms: String, slaTerms: String, penalty: String, docs, status: en(['draft', 'active', 'expiring', 'expired', 'renewed', 'terminated'], 'active'),
}, { indexes: [[{ end: 1 }], [{ vendorId: 1 }]] });

export const Amc = model('Amc', {
  name: req(), contractId: ref('Contract'), vendorId: req(ObjectId, { ref: 'Vendor' }), assetIds: [ref('Asset')],
  type: en(['comprehensive', 'non_comprehensive'], 'comprehensive'), visitFrequency: en(['monthly', 'quarterly', 'half_yearly', 'yearly'], 'quarterly'),
  start: req(Date), end: req(Date), value: Number,
  status: en(['draft', 'active', 'expiring', 'renewal_requested', 'renewed', 'expired'], 'active'), ...approvalFields,
}, { indexes: [[{ end: 1 }]] });

export const AmcVisit = model('AmcVisit', {
  amcId: req(ObjectId, { ref: 'Amc' }), vendorId: ref('Vendor'), plannedDate: req(Date), actualDate: Date, technicianName: String,
  workOrderId: ref('WorkOrder'), reportUrl: String, findings: String, status: en(['scheduled', 'done', 'missed'], 'scheduled'),
}, { indexes: [[{ amcId: 1, plannedDate: 1 }, UNIQUE]] });

export const VendorInvoice = model('VendorInvoice', {
  vendorId: req(ObjectId, { ref: 'Vendor' }), number: req(), poId: ref('PurchaseOrder'), contractId: ref('Contract'),
  invoiceDate: Date, amount: req(Number), gst: Number, total: Number, fileUrl: String,
  status: en(['submitted', 'verified', 'approved', 'paid', 'disputed'], 'submitted'), paymentRef: String, disputeReason: String, history,
}, {
  indexes: [[{ vendorId: 1, status: 1 }]],
  setup: (s) => s.pre('validate', function () { this.total = (this.amount || 0) + (this.gst || 0); }),
});

export const VendorScore = model('VendorScore', {
  vendorId: req(ObjectId, { ref: 'Vendor' }), period: req(), onTimeVisitPct: Number, slaPct: Number, qualityRating: Number, disputes: Number, score: Number,
}, { indexes: [[{ vendorId: 1, period: 1 }]] });

// ── M8 HSE ─────────────────────────────────────────────────────────────────
export const INCIDENT_STAGES = ['reported', 'immediate_action', 'investigation', 'capa', 'verification', 'closed'];
export const Incident = model('Incident', {
  number: String, title: req(), type: en(['injury', 'near_miss', 'fire', 'electrical', 'property_damage', 'environmental', 'security'], 'near_miss'),
  severity: en(['minor', 'major', 'critical'], 'minor'), occurredAt: { type: Date, default: Date.now }, locationId: ref('Location'),
  people: [String], description: String, photos: [String], immediateAction: String, rootCause: String, correctiveAction: String,
  verificationNote: String, lti: Boolean, status: en(INCIDENT_STAGES, 'reported'), capaIds: [ref('Capa')], reportedBy: ref('User'), history,
}, { indexes: [[{ number: 1 }], [{ status: 1 }]] });

export const Inspection = model('Inspection', {
  title: req(), templateId: ref('ChecklistTemplate'), type: en(['fire_extinguisher', 'emergency_exit', 'electrical_panel', 'work_at_height', 'housekeeping_safety', 'other'], 'other'),
  locationId: ref('Location'), scheduledDate: req(Date), doneAt: Date, doneBy: ref('User'),
  results: [{ label: String, value: Mixed, ok: Boolean }], score: Number, findings: String, status: en(['scheduled', 'done', 'overdue'], 'scheduled'),
}, { indexes: [[{ scheduledDate: 1 }]] });

export const Observation = model('Observation', {
  type: en(['unsafe_act', 'unsafe_condition'], 'unsafe_condition'), description: req(), likelihood: { type: Number, min: 1, max: 5, default: 3 },
  severity: { type: Number, min: 1, max: 5, default: 3 }, riskScore: Number, locationId: ref('Location'), photo: String,
  status: en(['open', 'capa', 'closed'], 'open'), capaId: ref('Capa'),
}, { setup: (s) => s.pre('validate', function () { this.riskScore = (this.likelihood || 1) * (this.severity || 1); }) });

export const Capa = model('Capa', {
  number: String, sourceType: en(['incident', 'observation', 'inspection', 'audit'], 'incident'), sourceId: ObjectId,
  kind: en(['corrective', 'preventive'], 'corrective'), action: req(), ownerId: ref('User'), dueDate: Date,
  status: en(['open', 'in_progress', 'done', 'verified', 'closed'], 'open'), evidence: [String], verifiedBy: ref('User'), history,
}, { indexes: [[{ dueDate: 1, status: 1 }]] });

export const Compliance = model('Compliance', {
  name: req(), authority: String, certificateNo: String, validFrom: Date, validTo: req(Date), docUrl: String, ownerId: ref('User'), notes: String,
}, { indexes: [[{ validTo: 1 }]] });

export const Permit = model('Permit', {
  number: String, type: en(['hot_work', 'work_at_height', 'electrical_isolation', 'confined_space'], 'hot_work'), locationId: ref('Location'),
  workDescription: req(), requestedBy: ref('User'), contractor: String, validFrom: req(Date), validTo: req(Date), precautions: String,
  status: en(['requested', 'approved', 'active', 'closed', 'cancelled', 'expired'], 'requested'), ...approvalFields, history,
}, { indexes: [[{ status: 1 }]] });

export const Training = model('Training', {
  type: en(['toolbox_talk', 'fire_drill', 'mock_drill', 'induction', 'other'], 'toolbox_talk'), topic: req(), date: req(Date),
  trainer: String, attendees: [ref('Employee')], durationMin: Number, notes: String,
});

// ── M9–M12 Operations, KPIs, reports, SOPs ─────────────────────────────────
export const Sop = model('Sop', {
  title: req(), departmentCode: String, version: { type: String, default: '1.0' }, fileUrl: String, content: String,
  effectiveDate: Date, ownerId: ref('User'), status: en(['draft', 'approved', 'retired'], 'approved'),
  acknowledgements: [{ userId: ref('User'), at: Date }],
}, { scope: 'org', indexes: [[{ orgId: 1, title: 1 }]] });

export const ActionItem = model('ActionItem', {
  source: en(['daily_review', 'report', 'audit', 'eod', 'other'], 'daily_review'), title: req(), ownerId: ref('User'),
  dueDate: Date, status: en(['open', 'in_progress', 'done', 'cancelled'], 'open'), note: String,
}, { indexes: [[{ ownerId: 1, status: 1 }]] });

export const ShiftLog = model('ShiftLog', {
  departmentId: ref('Department'), date: req(), shiftId: ref('Shift'), kind: en(['shift_log', 'occurrence_book', 'eod'], 'shift_log'),
  entries: [{ time: { type: Date, default: Date.now }, text: String, by: ref('User'), byName: String }],
  handoverTo: ref('User'), pendingItems: [String], nextDayPriorities: [String], closed: Boolean, closureSummary: Mixed,
}, { indexes: [[{ propertyId: 1, date: 1 }]] });

export const KpiDefinition = model('KpiDefinition', {
  code: req(), name: req(), formula: String, target: Number, amberAt: Number, redAt: Number,
  direction: en(['higher', 'lower'], 'higher'), unit: en(['%', 'count'], '%'), responsibility: String, order: Number, baseline: Number,
}, { scope: 'org', indexes: [[{ orgId: 1, code: 1 }, UNIQUE]] });

export const KpiSnapshot = model('KpiSnapshot', { date: req(), values: Mixed }, { indexes: [[{ propertyId: 1, date: 1 }, { unique: true }]] });

export const Report = model('Report', {
  type: en(['daily', 'weekly', 'monthly'], 'daily'), title: String, periodStart: Date, periodEnd: Date, data: Mixed,
  kpis: [{ code: String, name: String, unit: String, target: Number, actual: Number, variance: Number, status: String, responsibility: String, correctiveAction: String }],
  commentary: String, status: en(['draft', 'signed_off', 'sent', 'acknowledged'], 'draft'),
  signedBy: ref('User'), signedAt: Date, sentAt: Date, acknowledgedBy: ref('User'), acknowledgedAt: Date,
  version: { type: Number, default: 1 }, history,
}, { indexes: [[{ propertyId: 1, type: 1, periodStart: 1 }]] });

// ── M13 Notifications, audit, system ───────────────────────────────────────
export const Notification = model('Notification', {
  userId: req(ObjectId, { ref: 'User' }), propertyId: ref('Property'), type: String, title: String, body: String, link: String,
  readAt: Date, channels: [String], dedupeKey: String, deliveries: [{ channel: String, ok: Boolean, info: String, at: Date }],
}, { scope: 'none', indexes: [[{ userId: 1, readAt: 1 }], [{ dedupeKey: 1 }, { unique: true, sparse: true }]] });

export const AuditLog = model('AuditLog', {
  userId: ref('User'), userName: String, action: String, entity: String, entityId: ObjectId,
  before: Mixed, after: Mixed, ip: String, at: { type: Date, default: Date.now },
}, { indexes: [[{ entity: 1, entityId: 1 }], [{ at: -1 }]] });

export const JobRun = model('JobRun', {
  name: String, startedAt: Date, finishedAt: Date, durationMs: Number, ok: Boolean, message: String,
}, { scope: 'none', indexes: [[{ name: 1, startedAt: -1 }]] });

export const Counter = mongoose.models.Counter || mongoose.model('Counter', new Schema({ key: { type: String, unique: true }, seq: { type: Number, default: 0 } }));

// ── Integrations, notifications, configuration ─────────────────────────────
export const PushSubscription = mongoose.models.PushSubscription || mongoose.model('PushSubscription', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true }, endpoint: { type: String, unique: true }, keys: { p256dh: String, auth: String }, userAgent: String,
}, { timestamps: true }));

export const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new Schema({ key: { type: String, unique: true }, value: Mixed }, { timestamps: true }));

export const ReportSchedule = model('ReportSchedule', {
  type: en(['daily', 'weekly', 'monthly'], 'daily'), enabled: { type: Boolean, default: true }, time: { type: String, default: '07:00' },
  dayOfWeek: { type: Number, min: 0, max: 6, default: 1 }, dayOfMonth: { type: Number, min: 1, max: 28, default: 1 },
  recipients: [String], sendOnSignOff: { type: Boolean, default: true }, lastRunKey: String, lastRunAt: Date,
});

export const Comment = model('Comment', {
  entity: req(), entityId: req(ObjectId), text: req(), mentions: [ref('User')], byName: String,
}, { indexes: [[{ entity: 1, entityId: 1, createdAt: 1 }]] });

export const APPROVAL_ENTITIES = ['leave_request', 'overtime_request', 'regularization', 'contractor_deployment', 'purchase_request', 'purchase_order', 'amc_renewal', 'permit'];
export const ApprovalRule = model('ApprovalRule', {
  entityType: req(String, { enum: APPROVAL_ENTITIES }), description: String,
  levels: [{ role: String, minAmount: Number }], active: { type: Boolean, default: true },
}, { scope: 'org', indexes: [[{ orgId: 1, entityType: 1 }, UNIQUE]] });

export const API_SCOPES = ['assets:read', 'readings:write', 'tickets:read', 'tickets:write', 'workorders:read', 'kpis:read', 'stock:read', 'procurement:read', 'attendance:punch'];
export const ApiKey = model('ApiKey', {
  name: req(), prefix: String, keyHash: { type: String, select: false, index: true }, scopes: [{ type: String, enum: API_SCOPES }],
  active: { type: Boolean, default: true }, lastUsedAt: Date, expiresAt: Date,
});
