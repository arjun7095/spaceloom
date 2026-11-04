// Everything a first-time user reads: demo logins, role welcome guides, glossary, live demo script.

export const DEMO_PASSWORD = 'Demo@123';

export const DEMO_ROLES = [
  { email: 'pm@primespace.demo', role: 'Property Manager', who: 'Lakshmi Narayanan', icon: 'manager', blurb: 'Runs the site: dashboard, approvals, client reports' },
  { email: 'eng.supervisor@primespace.demo', role: 'Engineering Supervisor', who: 'Suresh Reddy', icon: 'supervisor', blurb: 'Assigns technicians and verifies their work' },
  { email: 'helpdesk@primespace.demo', role: 'Helpdesk Executive', icon: 'helpdesk', blurb: 'Logs complaints and keeps SLAs on track' },
  { email: 'hvac.tech@primespace.demo', role: 'HVAC Technician', who: 'Ravi Kumar', icon: 'technician', blurb: 'Checks in and fixes jobs from a phone' },
  { email: 'tenant@primespace.demo', role: 'Tenant', who: 'Neha Gupta · Nimbus Analytics', icon: 'tenant', blurb: 'Raises and tracks complaints' },
  { email: 'store@primespace.demo', role: 'Storekeeper', icon: 'store', blurb: 'Issues spares and watches stock levels' },
  { email: 'hse@primespace.demo', role: 'HSE Officer', icon: 'hse', blurb: 'Incidents, inspections, permits, CAPA' },
  { email: 'owner@primespace.demo', role: 'Client / Owner', icon: 'owner', blurb: 'Portfolio view; approves big spends' },
  { email: 'procurement@primespace.demo', role: 'Procurement Officer', icon: 'procurement', blurb: 'Purchase requests, quotes and POs' },
  { email: 'vendor@primespace.demo', role: 'Vendor · Chiller AMC', icon: 'vendor', blurb: 'Service visits and invoices' },
  { email: 'admin@primespace.demo', role: 'Super Admin', icon: 'admin', blurb: 'Setup, users, roles and system jobs' },
  { email: 'auditor@primespace.demo', role: 'Auditor', icon: 'auditor', blurb: 'Read-only, plus the audit log' },
];

export const WELCOME = {
  property_manager: {
    title: 'You run Prime Tech Park',
    intro: 'Everything on site flows up to you. Start with these four things each day.',
    steps: [
      ['Check the dashboard', 'Eight KPI tiles compare today with target. Click any tile to see the records behind it.', '/'],
      ['Clear your approvals', 'Leave, purchase requests, invoices and client reports waiting for you.', '/approvals'],
      ['Review today', 'SLA risks, attendance, critical assets and action points on one board.', '/today'],
      ['Sign off the client report', 'Add commentary and corrective actions, then sign off and send.', '/reports'],
    ],
  },
  supervisor: {
    title: 'You keep your team moving',
    intro: 'New complaints come to you first. Assign them, then check the work before it is closed.',
    steps: [
      ['Assign new tickets', 'Pick a technician; the list shows skills, who is on shift and current workload.', '/today'],
      ['Verify completed work', 'Look at photos and readings, then verify or send it back.', '/work-orders?view=verification'],
      ['Handle attendance exceptions', 'Late arrivals, missed punches and outside-fence check-ins.', '/attendance'],
      ['Plan the roster', 'Set shifts for the week, copy last week and publish.', '/people/roster'],
    ],
  },
  helpdesk: {
    title: 'You are the voice of the site',
    intro: 'Log every call or walk-in as a ticket. The system routes it and starts the SLA clock.',
    steps: [
      ['Raise a ticket for a caller', 'Choose the problem and the place; priority is suggested for you.', '/tickets/new'],
      ['Watch the SLA timers', 'Amber means 75% of the time is used; red means overdue.', '/tickets?view=open'],
      ['Follow up on resolved tickets', 'Remind tenants to confirm the fix.', '/tickets?view=resolved'],
    ],
  },
  technician: {
    title: 'Your jobs, on your phone',
    intro: 'Three taps: check in, open a job, update it.',
    steps: [
      ['Check in', 'Use the Check-in tab when you arrive. Your location is checked against the site boundary.', '/my-attendance'],
      ['Open your jobs', 'Tickets and PPM jobs assigned to you, most urgent first.', '/today'],
      ['Finish with evidence', 'Fill the checklist, add before/after photos, sign and complete.', '/work-orders?view=my'],
      ['No signal? Keep going', 'In basements and plant rooms your work is saved on the phone and syncs by itself later.', '/today'],
    ],
  },
  tenant: {
    title: 'Tell us what needs fixing',
    intro: 'Raise a complaint in under a minute and follow it until it is fixed.',
    steps: [
      ['Raise a complaint', 'Pick the problem, the place, add a photo if you like.', '/tickets/new'],
      ['Track it live', 'See who is assigned and how long until it should be fixed.', '/tickets'],
      ['Confirm and rate', 'When we mark it resolved, confirm the fix or tell us it is not right.', '/tickets?view=resolved'],
    ],
  },
  storekeeper: {
    title: 'You keep the shelves right',
    intro: 'Every stock movement goes through the ledger, so balances are always correct.',
    steps: [
      ['Issue requested materials', 'Technicians request parts against a job; you issue them.', '/inventory/issues'],
      ['Watch reorder alerts', 'Items at or below reorder level, with one-click purchase request.', '/inventory?view=alerts'],
      ['Receive goods', 'Record a goods receipt against a purchase order.', '/inventory/grns'],
    ],
  },
  hse_officer: {
    title: 'You keep everyone safe',
    intro: 'Incidents move through fixed stages, from report to verified closure.',
    steps: [
      ['Move incidents forward', 'Immediate action → investigation → CAPA → verification → closed.', '/hse/incidents'],
      ['Run inspections', 'Scheduled safety inspections with findings.', '/hse/inspections'],
      ['Track CAPAs and certificates', 'Overdue actions and expiring statutory certificates.', '/hse/capas'],
    ],
  },
  owner: {
    title: 'Your portfolio at a glance',
    intro: 'Read-only dashboards and reports, plus approvals for high-value spend and AMC renewals.',
    steps: [
      ['See the KPIs', 'Live figures for every property you own.', '/'],
      ['Approve big spends', 'POs above the limit and AMC renewals come to you.', '/approvals'],
      ['Read client reports', 'Daily, weekly and monthly reports signed off by the PM.', '/reports'],
    ],
  },
  procurement: {
    title: 'You buy what the site needs',
    intro: 'Approved purchase requests become purchase orders.',
    steps: [
      ['Approved requests', 'Turn them into POs with vendor quotes.', '/procurement/requests'],
      ['Purchase orders', 'Track approval, sending and receipt.', '/procurement/orders'],
    ],
  },
  vendor: {
    title: 'Welcome, service partner',
    intro: 'See your scheduled visits and work, and upload invoices.',
    steps: [
      ['Your visits', 'Mark visits done with the service report.', '/vendors/visits'],
      ['Your invoices', 'Upload invoices and see their status.', '/vendors/invoices'],
    ],
  },
  super_admin: {
    title: 'You configure the platform',
    intro: 'Properties, masters, users, roles and background jobs.',
    steps: [
      ['Properties and locations', 'Set up sites, towers, floors and zones.', '/setup/properties'],
      ['Users and roles', 'Give people the right access.', '/admin/users'],
      ['Bulk import', 'Load employees, assets, items and vendors from Excel.', '/admin/import'],
      ['System jobs', 'See SLA checks, PPM generation and alerts run.', '/admin/jobs'],
    ],
  },
  auditor: {
    title: 'Read-only access',
    intro: 'You can see every record and the full audit trail.',
    steps: [['Audit log', 'Every create, update, approval and delete with before/after values.', '/admin/audit']],
  },
};

export const GLOSSARY = [
  ['SLA', 'Service Level Agreement — how fast a ticket must be responded to and fixed, based on its priority (P1 critical: respond in 15 min, fix in 4 h).'],
  ['Ticket', 'A complaint or request, raised by a tenant, the helpdesk, staff, a QR scan or automatically from a checklist reading.'],
  ['Work order (WO)', 'The job sheet a technician works from: checklist, parts, photos and signature.'],
  ['PPM', 'Planned Preventive Maintenance — routine servicing generated automatically from each asset’s schedule.'],
  ['AMC', 'Annual Maintenance Contract with an outside vendor, with scheduled visits.'],
  ['CAPA', 'Corrective And Preventive Action — the fix that stops an incident happening again.'],
  ['PR / PO / GRN', 'Purchase Request → Purchase Order → Goods Receipt Note. Stock goes up only on GRN.'],
  ['PTW', 'Permit to Work — approval needed before hot work, work at height, electrical isolation or confined spaces.'],
  ['Geo-fence', 'The circle around the property. Mobile check-ins outside it are flagged.'],
  ['Escalation', 'Automatic alerts: supervisor at 75% of SLA, Property Manager on breach, owner after that.'],
  ['MTTR / MTBF', 'Mean Time To Repair and Mean Time Between Failures — reliability figures per asset.'],
  ['Regularisation', 'A request to correct a missed or wrong attendance punch.'],
  ['Roster', 'Who works which shift on which day.'],
  ['KPI', 'Key Performance Indicator — the eight dashboard tiles, each with a target.'],
  ['Log sheet', 'The daily round of readings on critical equipment (DG sets, chillers, transformers). Out-of-range values raise a ticket automatically.'],
  ['Offline mode', 'With no signal, check-ins, checklists and job updates are saved on the phone and sent automatically when the connection returns.'],
  ['API key', 'A secret that lets another system (BMS, ERP, biometric device) talk to PrimeSpace with limited permissions.'],
];

export const DEMO_SCRIPT = [
  ['Tenant', 'tenant@primespace.demo', 'Raise “AHU not cooling” at Tower A / Floor 05 and pick asset AHU-A-05. Priority P2 is suggested and the SLA clock starts.'],
  ['Helpdesk', 'helpdesk@primespace.demo', 'Optional: open the ticket and raise it to P1 with a reason.'],
  ['Engineering Supervisor', 'eng.supervisor@primespace.demo', 'From Today, open the new ticket → Assign technician → choose Ravi Kumar (HVAC, on shift).'],
  ['HVAC Technician', 'hvac.tech@primespace.demo', 'Acknowledge → Start work → Request parts: AHU pre-filter × 2 and V-belt B-52 × 1.'],
  ['Storekeeper', 'store@primespace.demo', 'Today → Material requests → Issue. The stock ledger updates and a reorder alert fires.'],
  ['HVAC Technician', 'hvac.tech@primespace.demo', 'Fill the checklist, add before/after photos, sign, then Complete.'],
  ['Engineering Supervisor', 'eng.supervisor@primespace.demo', 'Verify & resolve. Downtime is recorded on the asset.'],
  ['Tenant', 'tenant@primespace.demo', 'Confirm the fix and rate it. The ticket closes and the dashboard tiles update live.'],
  ['Property Manager', 'pm@primespace.demo', 'Open asset AHU-A-05 → History shows the breakdown, downtime and parts cost.'],
];
