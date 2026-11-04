export const MODULES = {
  property: 'Property setup',
  user: 'Users & roles',
  employee: 'Employees',
  attendance: 'Attendance',
  roster: 'Shift roster',
  leave: 'Leave, overtime & regularisation',
  contractor: 'Contractor workforce',
  asset: 'Assets',
  ppm: 'PPM & checklists',
  workorder: 'Work orders',
  ticket: 'Helpdesk tickets',
  inventory: 'Inventory',
  procurement: 'Procurement',
  vendor: 'Vendors & AMC',
  hse: 'HSE & compliance',
  dashboard: 'KPI dashboard',
  report: 'Client reports',
  sop: 'SOP library',
  daily: 'Daily workflow',
  audit: 'Audit log',
  admin: 'Administration',
};

export const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'assign', 'verify'];
export const ALL_PERMISSIONS = Object.keys(MODULES).flatMap((m) => ACTIONS.map((a) => `${m}:${a}`));

const full = (...mods) => mods.flatMap((m) => ACTIONS.map((a) => `${m}:${a}`));
const p = (mod, ...actions) => actions.map((a) => `${mod}:${a}`);

// System role templates mapped from the permission matrix (section 2). Editable per organisation.
export const SYSTEM_ROLES = [
  {
    key: 'super_admin', name: 'Super Admin', layout: 'office',
    description: 'PrimeSpace HQ / IT: organisations, properties, global masters, role templates and system settings.',
    permissions: ['*'],
  },
  {
    key: 'owner', name: 'Client / Property Owner', layout: 'office',
    description: 'Read-only dashboards and reports; approves high-value POs and AMC renewals; acknowledges client reports.',
    permissions: ['*:read', ...p('procurement', 'approve'), ...p('vendor', 'approve'), ...p('report', 'approve')],
  },
  {
    key: 'property_manager', name: 'Property Manager', layout: 'office',
    description: 'Site head: full site control, approvals, dashboard review, action points and client report sign-off.',
    permissions: ['*:read', ...p('property', 'update'), ...full('user', 'employee', 'attendance', 'roster', 'leave', 'contractor', 'asset', 'ppm', 'workorder', 'ticket', 'inventory', 'procurement', 'vendor', 'hse', 'report', 'sop', 'daily')],
  },
  {
    key: 'supervisor', name: 'Department Supervisor', layout: 'office',
    description: 'Rosters, assigns and verifies work, approves attendance exceptions, leave and overtime for their department.',
    permissions: [
      ...p('property', 'read'), ...p('dashboard', 'read'), ...p('user', 'read'), ...p('employee', 'read', 'update'),
      ...p('attendance', 'read', 'create', 'update', 'approve'), ...full('roster'), ...p('leave', 'read', 'create', 'approve'),
      ...p('contractor', 'read', 'update', 'approve'), ...p('asset', 'read', 'update'), ...p('ppm', 'read', 'create', 'update', 'approve'),
      ...full('workorder'), ...p('ticket', 'read', 'create', 'update', 'assign', 'verify', 'approve'), ...p('inventory', 'read', 'create'),
      ...p('procurement', 'read', 'create'), ...p('vendor', 'read'), ...p('hse', 'read', 'create'), ...p('report', 'read'), ...p('sop', 'read'), ...full('daily'),
    ],
  },
  {
    key: 'helpdesk', name: 'Helpdesk Executive', layout: 'office',
    description: 'Logs and triages tickets, sets priority, tracks SLA and follows up with tenants.',
    permissions: [...p('property', 'read'), ...p('dashboard', 'read'), ...p('user', 'read'), ...p('employee', 'read'), ...p('asset', 'read'), ...p('ppm', 'read'), ...p('workorder', 'read'), ...p('ticket', 'read', 'create', 'update'), ...p('hse', 'create'), ...p('report', 'read'), ...p('sop', 'read'), ...p('daily', 'read', 'create')],
  },
  {
    key: 'technician', name: 'Technician / Field Staff', layout: 'field',
    description: 'Checks in and out, executes PPM and work orders, fills checklists, uploads evidence and requests materials.',
    permissions: [...p('employee', 'read'), ...p('attendance', 'read', 'create'), ...p('leave', 'read', 'create'), ...p('asset', 'read'), ...p('ppm', 'read'), ...p('workorder', 'read', 'update'), ...p('ticket', 'read', 'create', 'update'), ...p('inventory', 'read', 'create'), ...p('hse', 'read', 'create'), ...p('sop', 'read'), ...p('daily', 'read')],
  },
  {
    key: 'storekeeper', name: 'Storekeeper', layout: 'office',
    description: 'Item master, goods receipts, material issue and return, stock counts.',
    permissions: [...full('inventory'), ...p('procurement', 'read', 'create'), ...p('asset', 'read'), ...p('ticket', 'read'), ...p('workorder', 'read'), ...p('dashboard', 'read'), ...p('report', 'read'), ...p('sop', 'read'), ...p('vendor', 'read'), ...p('user', 'read'), ...p('property', 'read')],
  },
  {
    key: 'procurement', name: 'Procurement Officer', layout: 'office',
    description: 'Turns purchase requests into POs, collects vendor quotes and tracks receipts.',
    permissions: [...p('procurement', 'read', 'create', 'update'), ...p('inventory', 'read'), ...p('vendor', 'read', 'create', 'update'), ...p('asset', 'read'), ...p('report', 'read'), ...p('sop', 'read'), ...p('user', 'read'), ...p('property', 'read')],
  },
  {
    key: 'hse_officer', name: 'HSE Officer', layout: 'office',
    description: 'Incidents, inspections, observations, CAPA, permits and the compliance register.',
    permissions: [...full('hse'), ...p('property', 'read'), ...p('employee', 'read'), ...p('asset', 'read'), ...p('ppm', 'read'), ...p('ticket', 'read'), ...p('vendor', 'read'), ...p('dashboard', 'read'), ...p('report', 'read'), ...p('sop', 'read'), ...p('daily', 'read', 'create'), ...p('user', 'read')],
  },
  {
    key: 'vendor', name: 'Vendor User', layout: 'field',
    description: 'Sees assigned visits and work orders, uploads service reports and invoices, manages contractor staff.',
    permissions: [...p('vendor', 'read', 'update'), ...p('workorder', 'read', 'update'), ...p('ticket', 'read', 'update'), ...p('asset', 'read'), ...p('procurement', 'read'), ...p('employee', 'read'), ...p('contractor', 'read', 'create'), ...p('hse', 'create')],
  },
  {
    key: 'tenant', name: 'Tenant User', layout: 'field',
    description: 'Raises complaints, tracks status and SLA, confirms closure and rates the service.',
    permissions: [...p('ticket', 'read', 'create'), ...p('hse', 'create')],
  },
  {
    key: 'auditor', name: 'Auditor', layout: 'office',
    description: 'Read-only access to everything, including the audit log.',
    permissions: ['*:read'],
  },
];
