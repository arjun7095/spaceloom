import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Box, Button, Chip, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { api, download } from '../api/client';
import { useAction, usePerm } from '../hooks';
import { ResourceForm } from '../components/form';
import { ReturnForm } from '../components/WorkOrderPanel';
import { fmtDateTime, inr } from '../utils/format';

// Field shorthand: { n: name, l: label, t: type, req, o: options, ref, sub, help, full, hideOnEdit }
// Column shorthand: 'path|Header|kind' (see components/DataTable).
const PRI = ['P1', 'P2', 'P3', 'P4'];
const MODULES = ['property', 'user', 'employee', 'attendance', 'roster', 'leave', 'contractor', 'asset', 'ppm', 'workorder', 'ticket', 'inventory', 'procurement', 'vendor', 'hse', 'dashboard', 'report', 'sop', 'daily', 'audit', 'admin'];
const PERMISSIONS = ['*', '*:read', ...MODULES.flatMap((m) => ['read', 'create', 'update', 'delete', 'approve', 'assign', 'verify'].map((a) => `${m}:${a}`))];
const status = (o) => ({ n: 'status', t: 'select', o });

function QrPanel({ text, value, title }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
      <QRCodeSVG value={value} size={96} />
      <Box>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{text}</Typography>
        <Button size="small" variant="outlined" onClick={() => window.print()}>Print label</Button>
      </Box>
    </Stack>
  );
}

function VendorScorecard({ id }) {
  const { data } = useQuery({ queryKey: ['scorecard', id], queryFn: () => api.get(`/vendors/${id}/scorecard`) });
  if (!data) return null;
  const c = data.current;
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Performance this month</Typography>
      <Grid container spacing={1}>
        {[['Score', `${c.score}/100`], ['On-time visits', `${c.onTimeVisitPct}%`], ['SLA on tickets', `${c.slaPct}%`], ['Quality', `${c.qualityRating}/5`], ['Disputes', c.disputes]].map(([k, v]) => (
          <Grid item xs={6} sm={4} key={k}><Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}><Typography variant="caption" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography></Box></Grid>
        ))}
      </Grid>
    </Box>
  );
}

// Side-by-side vendor quotes for a purchase request (FR-6.5): cheapest rate per line highlighted.
function QuoteComparison({ pr }) {
  const navigate = useNavigate();
  const { can } = usePerm();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['quotations', 'pr', pr._id], queryFn: () => api.list('/quotations', { 'filter[prId]': pr._id, limit: 10 }).then((r) => r.data) });
  const select = useAction((id) => api.patch(`/quotations/${id}`, { selected: true }), { success: 'Quote selected', invalidate: ['quotations'] });
  const makePo = useAction((vendorId) => api.post('/purchase-orders', { prId: pr._id, vendorId }), { success: (po) => `${po.number} drafted from the selected quote`, invalidate: ['purchase-orders', 'purchase-requests'], onSuccess: (po) => navigate(`/procurement/orders?id=${po._id}`) });
  const quotes = q.data || [];
  const lines = pr.items || [];
  const idOf = (v) => String(v?._id || v);
  const rateOf = (quote, line) => quote.items.find((i) => idOf(i.itemId) === idOf(line.itemId))?.rate;
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Vendor quotes ({quotes.length}/3)</Typography>
        {can('procurement:create') && quotes.length < 3 && <Button size="small" onClick={() => setAdding(true)}>Add a quote</Button>}
      </Stack>
      {!quotes.length ? <Typography variant="body2" color="text.secondary">No quotes yet. Quotes are optional for low-value requests.</Typography> : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Item</TableCell><TableCell sx={{ fontWeight: 700 }}>Qty</TableCell>
                {quotes.map((x) => <TableCell key={x._id} sx={{ fontWeight: 700, bgcolor: x.selected ? 'primary.soft' : undefined }}>{x.vendorId?.name}{x.selected && <Chip size="small" color="secondary" label="Selected" sx={{ ml: 0.5 }} />}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l) => {
                const rates = quotes.map((x) => rateOf(x, l)).filter((r) => r != null);
                const best = Math.min(...rates);
                return (
                  <TableRow key={idOf(l.itemId)}>
                    <TableCell>{l.itemId?.name || 'Item'}</TableCell><TableCell>{l.qty}</TableCell>
                    {quotes.map((x) => { const r = rateOf(x, l); return <TableCell key={x._id} sx={{ color: r === best && rates.length > 1 ? 'success.main' : undefined, fontWeight: r === best && rates.length > 1 ? 700 : 400 }}>{r == null ? '—' : `${inr(r)} × ${l.qty} = ${inr(r * l.qty)}`}</TableCell>; })}
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell colSpan={2} sx={{ fontWeight: 700 }}>Total · delivery</TableCell>
                {quotes.map((x) => <TableCell key={x._id} sx={{ fontWeight: 700 }}>{inr(x.total)}{x.deliveryDays ? ` · ${x.deliveryDays} days` : ''}</TableCell>)}
              </TableRow>
              {can('procurement:update') && (
                <TableRow>
                  <TableCell colSpan={2} />
                  {quotes.map((x) => (
                    <TableCell key={x._id}>
                      <Stack direction="row" spacing={0.5}>
                        {!x.selected && <Button size="small" onClick={() => select.mutate(x._id)}>Select</Button>}
                        {x.selected && pr.status === 'approved' && can('procurement:create') && <Button size="small" variant="contained" color="secondary" onClick={() => makePo.mutate(x.vendorId._id)}>Create PO</Button>}
                      </Stack>
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}
      {adding && <ResourceForm cfg={RESOURCES.quotations} initial={{ prId: pr._id, items: lines.map((l) => ({ itemId: l.itemId, rate: '' })) }} onClose={() => { setAdding(false); q.refetch(); }} />}
    </Box>
  );
}

const ROLE_LABEL = { supervisor: 'Supervisor', property_manager: 'Property Manager', owner: 'Owner', hse_officer: 'HSE Officer', procurement: 'Procurement' };
const APPROVAL_ENTITIES = [['leave_request', 'Leave request'], ['overtime_request', 'Overtime request'], ['regularization', 'Attendance regularisation'], ['contractor_deployment', 'Contractor attendance'], ['purchase_request', 'Purchase request'], ['purchase_order', 'Purchase order'], ['amc_renewal', 'AMC renewal'], ['permit', 'Permit to work']];
const chain = (levels = []) => levels.map((l) => `${ROLE_LABEL[l.role] || l.role}${l.minAmount ? ` (above ${inr(l.minAmount)})` : ''}`).join(' → ');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const Entries = ({ doc }) => (
  <Stack spacing={1}>
    {(doc.entries || []).map((e, i) => <Box key={i} sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}><Typography variant="body2">{e.text}</Typography><Typography variant="caption" color="text.secondary">{e.byName} · {fmtDateTime(e.time)}</Typography></Box>)}
  </Stack>
);

export const RESOURCES = {
  // ── Setup ──
  organizations: { path: '/setup/organizations', api: 'organizations', perm: 'property', title: 'Organisations', singular: 'organisation', help: 'Client companies that own properties, and PrimeSpace as the operator.', cols: ['name||strong', 'type', 'gstin|GSTIN', 'address'], fields: [{ n: 'name', req: 1 }, { n: 'type', t: 'select', o: ['operator', 'client'] }, { n: 'gstin', l: 'GSTIN' }, { n: 'address', t: 'textarea' }] },
  properties: {
    path: '/setup/properties', api: 'properties', perm: 'property', title: 'Properties', singular: 'property', detail: () => <Button component={RouterLink} to="/setup/geofence" variant="outlined">Draw the geo-fence on the map</Button>, help: 'Each site PrimeSpace manages. The geo-fence decides where mobile check-in is allowed.',
    cols: ['code||strong', 'name', 'type', 'city', 'areaSqft|Area (sq.ft.)', 'is24x7|24x7|bool', 'status||status'],
    fields: [{ n: 'name', req: 1 }, { n: 'code', req: 1, help: 'Short code used in numbers, e.g. PTP' }, { n: 'type', t: 'select', o: ['mall', 'tech_park', 'commercial'] }, { n: 'city' }, { n: 'address', t: 'textarea' }, { n: 'areaSqft', l: 'Area (sq.ft.)', t: 'number' }, { n: 'is24x7', l: 'Open 24x7', t: 'bool' },
      { n: 'settings.selfieRetentionDays', l: 'Keep selfies & GPS for (days)', t: 'number', help: 'Older selfies and check-in locations are deleted every night (DPDP Act)' }, { n: 'settings.reportRecipients', l: 'Client report recipients', t: 'tags', help: 'Email addresses' }, { n: 'settings.payrollWebhookUrl', l: 'Payroll webhook URL', full: 1 }, status(['active', 'inactive'])],
  },
  locations: {
    path: '/setup/locations', api: 'locations', perm: 'property', title: 'Locations', singular: 'location', help: 'Tower → floor → zone → room. Each location has a QR code that opens “Raise a ticket” for that spot.',
    cols: ['code||strong', 'name', 'type||status', 'path|Full path'], fields: [{ n: 'name', req: 1 }, { n: 'code', req: 1, help: 'e.g. PTP-A-05-EW' }, { n: 'type', t: 'select', o: ['tower', 'floor', 'zone', 'room', 'area'] }, { n: 'parentId', l: 'Inside', t: 'ref', ref: 'locations' }],
    detail: (doc) => <QrPanel title="Location QR code" text="Scan to raise a ticket here." value={`${window.location.origin}/tickets/new?locationId=${doc._id}`} />,
  },
  departments: { path: '/setup/departments', api: 'departments', perm: 'property', title: 'Departments', singular: 'department', help: 'Teams that own work. Ticket categories route to a department automatically.', cols: ['code||strong', 'name', 'headUserId.name|Head'], fields: [{ n: 'name', req: 1 }, { n: 'code', req: 1 }, { n: 'headUserId', l: 'Head', t: 'ref', ref: 'users' }, { n: 'description', t: 'textarea' }] },
  tenants: { path: '/setup/tenants', api: 'tenants', perm: 'property', title: 'Tenants', singular: 'tenant', help: 'Companies occupying the property and the units they lease.', cols: ['name||strong', 'units|Units|count', 'contacts.0.name|Contact', 'leaseEnd|Lease ends|date', 'status||status'], fields: [{ n: 'name', req: 1 }, { n: 'units', t: 'refs', ref: 'locations' }, { n: 'contacts', t: 'lines', sub: [{ n: 'name' }, { n: 'phone' }, { n: 'email' }] }, { n: 'leaseStart', t: 'date' }, { n: 'leaseEnd', t: 'date' }, status(['active', 'inactive'])] },
  shifts: { path: '/setup/shifts', api: 'shifts', perm: 'property', title: 'Shifts', singular: 'shift', help: 'Shift timings with grace period. Arriving after start + grace is marked late.', cols: ['code||strong', 'name', 'start', 'end', 'graceMin|Grace (min)', 'crossesMidnight|Overnight|bool'], fields: [{ n: 'name', req: 1 }, { n: 'code', req: 1 }, { n: 'start', req: 1, help: 'HH:mm, e.g. 06:00' }, { n: 'end', req: 1 }, { n: 'graceMin', l: 'Grace minutes', t: 'number' }, { n: 'breakMin', l: 'Break minutes', t: 'number' }, { n: 'crossesMidnight', l: 'Ends the next day', t: 'bool' }, { n: 'color' }] },
  holidays: { path: '/setup/holidays', api: 'holidays', perm: 'property', title: 'Holidays', singular: 'holiday', cols: ['date||date', 'name||strong', 'optional|Optional|bool'], fields: [{ n: 'name', req: 1 }, { n: 'date', t: 'date', req: 1 }, { n: 'optional', t: 'bool' }] },
  'sla-policies': {
    path: '/setup/sla-policies', api: 'sla-policies', perm: 'property', title: 'SLA policies', singular: 'SLA policy', help: 'Response and resolution targets per priority, and who is alerted when they slip.',
    cols: ['name||strong', 'calendar', 'isDefault|Default|bool', 'rules|Rules|count'],
    fields: [{ n: 'name', req: 1 }, { n: 'calendar', t: 'select', o: [['24x7', '24x7'], ['business', 'Business hours']] }, { n: 'isDefault', l: 'Default policy', t: 'bool' },
      { n: 'rules', t: 'lines', sub: [{ n: 'priority', t: 'select', o: PRI }, { n: 'responseMin', l: 'Respond (min)', t: 'number' }, { n: 'resolutionMin', l: 'Resolve (min)', t: 'number' }] },
      { n: 'escalation', t: 'lines', sub: [{ n: 'level', t: 'number' }, { n: 'afterPct', l: 'At % of SLA', t: 'number' }, { n: 'role', t: 'select', o: ['supervisor', 'property_manager', 'owner'] }] }],
  },
  'ticket-categories': { path: '/setup/ticket-categories', api: 'ticket-categories', perm: 'property', title: 'Ticket categories', singular: 'category', help: 'What tenants can complain about, which department handles it and its default priority.', cols: ['code||strong', 'name', 'departmentCode|Department', 'defaultPriority|Default priority|priority', 'subCategories|Sub-categories|chips'], fields: [{ n: 'name', req: 1 }, { n: 'code', req: 1 }, { n: 'departmentCode', l: 'Department code', help: 'e.g. ENG' }, { n: 'defaultPriority', t: 'select', o: PRI }, { n: 'subCategories', t: 'tags' }, { n: 'sopId', l: 'SOP', t: 'ref', ref: 'sops' }] },
  'approval-rules': {
    path: '/setup/approval-rules', api: 'approval-rules', perm: 'property', title: 'Approval rules', singular: 'approval rule', help: 'Who approves what, in order. A level with an amount only applies above that amount — e.g. the owner signs purchase orders above ₹2,00,000. Changes apply to new requests.',
    cols: [{ field: 'entityType', headerName: 'Request type', flex: 1, minWidth: 180, renderCell: (p) => <b>{Object.fromEntries(APPROVAL_ENTITIES)[p.value] || p.value}</b> }, { field: 'levels', headerName: 'Approval chain', flex: 2, minWidth: 320, sortable: false, valueFormatter: (v) => chain(v) }, 'description', 'active|Active|bool'],
    fields: [{ n: 'entityType', l: 'Request type', t: 'select', o: APPROVAL_ENTITIES, req: 1, hideOnEdit: 1 }, { n: 'levels', l: 'Approvers, in order', t: 'lines', sub: [{ n: 'role', t: 'select', o: Object.entries(ROLE_LABEL) }, { n: 'minAmount', l: 'Only above (₹)', t: 'number' }] }, { n: 'description', full: 1 }, { n: 'active', t: 'bool', def: true }],
  },
  'report-schedules': {
    path: '/reports/schedules', api: 'report-schedules', perm: 'report', title: 'Report schedules', singular: 'report schedule', help: 'When client reports are drafted automatically and who receives them. The PM is notified to review; with “Email on sign-off” the PDF is emailed to the recipients as soon as it is signed off.',
    cols: ['type', 'time|Time', { field: 'when', headerName: 'Runs', flex: 1, minWidth: 170, sortable: false, valueGetter: (v, r) => (r.type === 'weekly' ? `Every ${DAYS[r.dayOfWeek ?? 1]}` : r.type === 'monthly' ? `Day ${r.dayOfMonth ?? 1} of each month` : 'Every day') }, 'recipients|Recipients|chips', 'sendOnSignOff|Email on sign-off|bool', 'enabled|On|bool', 'lastRunAt|Last run|datetime'],
    fields: [{ n: 'type', t: 'select', o: ['daily', 'weekly', 'monthly'], req: 1 }, { n: 'time', l: 'Time (HH:mm)', def: '07:00' }, { n: 'dayOfWeek', l: 'Day (weekly)', t: 'select', o: DAYS.map((d, i) => [i, d]) }, { n: 'dayOfMonth', l: 'Day of month (monthly)', t: 'number', min: 1, max: 28 }, { n: 'recipients', l: 'Email recipients', t: 'tags', help: 'Type an email and press Enter' }, { n: 'sendOnSignOff', l: 'Email the PDF when the PM signs off', t: 'bool', def: true }, { n: 'enabled', t: 'bool', def: true }],
  },
  'kpi-definitions': { path: '/setup/kpis', api: 'kpi-definitions', perm: 'property', title: 'KPI definitions', singular: 'KPI', help: 'Targets and amber thresholds for the eight dashboard tiles. Agree these with the client before go-live.', cols: ['name||strong', 'target', 'amberAt|Amber at', 'direction', 'unit', 'responsibility'], fields: [{ n: 'code', req: 1, hideOnEdit: 1 }, { n: 'name', req: 1 }, { n: 'target', t: 'number' }, { n: 'amberAt', l: 'Amber threshold', t: 'number' }, { n: 'direction', t: 'select', o: [['higher', 'Higher is better'], ['lower', 'Lower is better']] }, { n: 'unit', t: 'select', o: ['%', 'count'] }, { n: 'responsibility' }, { n: 'formula', t: 'textarea' }] },
  'asset-categories': { path: '/setup/asset-categories', api: 'asset-categories', perm: 'asset', title: 'Asset categories', singular: 'category', help: 'Equipment types with their own fields, such as kVA for DG sets or TR for chillers.', cols: ['code||strong', 'name', 'customFields|Custom fields|count'], fields: [{ n: 'name', req: 1 }, { n: 'code', req: 1 }, { n: 'customFields', t: 'lines', sub: [{ n: 'key' }, { n: 'label' }, { n: 'unit' }] }] },

  // ── Admin ──
  users: {
    path: '/admin/users', api: 'users', perm: 'user', title: 'Users', singular: 'user', help: 'People who can sign in, their roles and the departments they belong to.',
    cols: ['name||strong', 'email', 'roleIds|Roles|chips', 'departmentIds|Departments|chips', 'status||status', 'lastLogin|Last login|ago'],
    fields: [{ n: 'name', req: 1 }, { n: 'email', req: 1 }, { n: 'mobile' }, { n: 'password', t: 'password', help: 'Min 8 chars with upper, lower, number and symbol. Leave blank to keep the current one.' }, { n: 'roleIds', l: 'Roles', t: 'refs', ref: 'roles', req: 1 }, { n: 'propertyIds', l: 'Properties', t: 'refs', ref: 'properties', help: 'Leave empty for the current property' }, { n: 'departmentIds', l: 'Departments', t: 'refs', ref: 'departments' }, { n: 'employeeId', l: 'Employee record', t: 'ref', ref: 'employees', help: 'Staff: enables My check-in' }, { n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors', help: 'Vendor logins: they see only this vendor’s records' }, { n: 'tenantId', l: 'Tenant company', t: 'ref', ref: 'tenants', help: 'Tenant logins: they see only this company’s tickets' }, status(['active', 'inactive'])],
  },
  roles: { path: '/admin/roles', api: 'roles', perm: 'admin', title: 'Roles & permissions', singular: 'role', help: 'Role templates. Permissions are module:action, e.g. ticket:assign. * means everything.', cols: ['name||strong', 'key', 'layout', 'permissions|Permissions|count', 'isSystem|System|bool'], fields: [{ n: 'name', req: 1 }, { n: 'key', req: 1 }, { n: 'description', t: 'textarea' }, { n: 'layout', t: 'select', o: [['office', 'Office (sidebar)'], ['field', 'Field (mobile tabs)']] }, { n: 'permissions', t: 'multiselect', o: PERMISSIONS }] },
  delegations: { path: '/admin/delegations', api: 'delegations', perm: 'daily', title: 'Delegations', singular: 'delegation', help: 'Hand your approvals to someone else while you are away.', cols: ['fromUserId.name|From', 'toUserId.name|To', 'from||date', 'to||date', 'active|Active|bool'], fields: [{ n: 'fromUserId', l: 'From (leave empty for yourself)', t: 'ref', ref: 'users' }, { n: 'toUserId', l: 'Delegate to', t: 'ref', ref: 'users', req: 1 }, { n: 'from', t: 'date', req: 1 }, { n: 'to', t: 'date', req: 1 }, { n: 'reason' }, { n: 'active', t: 'bool', def: true }] },
  'audit-logs': { path: '/admin/audit', api: 'audit-logs', perm: 'audit', title: 'Audit log', singular: 'entry', help: 'Every create, update, approval and delete, with what changed.', noCreate: 1, noEdit: 1, noDelete: 1, cols: ['at|When|datetime', 'userName|User', 'action', 'entity'], fields: [{ n: 'action' }, { n: 'entity' }], detail: (doc) => <Box component="pre" sx={{ fontSize: 12, bgcolor: 'grey.50', p: 2, borderRadius: 2, overflow: 'auto', maxHeight: 360 }}>{JSON.stringify({ before: doc.before, after: doc.after }, null, 2)}</Box> },

  // ── People ──
  employees: {
    path: '/people/employees', api: 'employees', perm: 'employee', title: 'Employees', singular: 'employee', help: 'Everyone working on site, including contractor staff.',
    cols: ['code||strong', 'name', 'departmentId.name|Department', 'designation', 'employmentType|Type', 'skills|Skills|chips', 'status||status'],
    tabs: [{ label: 'All' }, { label: 'Permanent', q: { 'filter[employmentType]': 'permanent' } }, { label: 'Contract', q: { 'filter[employmentType]': 'contract' } }],
    fields: [{ n: 'code', req: 1 }, { n: 'name', req: 1 }, { n: 'mobile' }, { n: 'email' }, { n: 'departmentId', l: 'Department', t: 'ref', ref: 'departments', req: 1 }, { n: 'designation' }, { n: 'skills', t: 'tags', o: ['HVAC', 'Electrical', 'Plumbing', 'Fire', 'Safety'] }, { n: 'employmentType', t: 'select', o: ['permanent', 'contract'] }, { n: 'contractorVendorId', l: 'Contractor (if contract)', t: 'ref', ref: 'vendors' }, { n: 'supervisorId', l: 'Reports to', t: 'ref', ref: 'employees' }, { n: 'shiftGroup' }, { n: 'joiningDate', t: 'date' }, { n: 'emergencyContact.name', l: 'Emergency contact' }, { n: 'emergencyContact.phone', l: 'Emergency phone' }, { n: 'photo', t: 'file' }, status(['active', 'inactive', 'exited'])],
  },
  'leave-requests': { path: '/people/leave', api: 'leave-requests', perm: 'leave', title: 'Leave requests', singular: 'leave request', createLabel: 'Apply for leave', help: 'Casual, sick, earned and comp-off leave, approved by the supervisor.', cols: ['employeeId.name|Employee', 'type', 'from||date', 'to||date', 'days', 'status||status'], tabs: [{ label: 'Waiting', q: { 'filter[status]': 'submitted' } }, { label: 'All' }], fields: [{ n: 'employeeId', l: 'Employee (empty = me)', t: 'ref', ref: 'employees' }, { n: 'type', t: 'select', o: ['casual', 'sick', 'earned', 'comp_off'], req: 1 }, { n: 'from', t: 'date', req: 1 }, { n: 'to', t: 'date', req: 1 }, { n: 'reason', t: 'textarea' }], tLabels: { approved: 'Approve', rejected: 'Reject', cancelled: 'Cancel request' } },
  'overtime-requests': { path: '/people/overtime', api: 'overtime-requests', perm: 'leave', title: 'Overtime requests', singular: 'overtime request', help: 'Extra hours worked, approved by the supervisor and sent to payroll.', cols: ['employeeId.name|Employee', 'date||date', 'hours', 'reason', 'status||status'], tabs: [{ label: 'Waiting', q: { 'filter[status]': 'submitted' } }, { label: 'All' }], fields: [{ n: 'employeeId', l: 'Employee (empty = me)', t: 'ref', ref: 'employees' }, { n: 'date', t: 'date', req: 1 }, { n: 'hours', t: 'number', req: 1 }, { n: 'reason', t: 'textarea' }], tLabels: { approved: 'Approve', rejected: 'Reject', cancelled: 'Cancel request' } },
  regularizations: { path: '/people/regularizations', api: 'regularizations', perm: 'leave', title: 'Attendance regularisation', singular: 'request', help: 'Fix a missed or wrong punch. Once approved, the attendance record is corrected.', cols: ['employeeId.name|Employee', 'date', 'requestedIn|In|datetime', 'requestedOut|Out|datetime', 'status||status'], fields: [{ n: 'employeeId', l: 'Employee (empty = me)', t: 'ref', ref: 'employees' }, { n: 'date', t: 'date', req: 1 }, { n: 'requestedIn', l: 'Actual check-in', t: 'datetime' }, { n: 'requestedOut', l: 'Actual check-out', t: 'datetime' }, { n: 'reason', t: 'textarea', req: 1 }], tLabels: { approved: 'Approve', rejected: 'Reject', cancelled: 'Cancel request' } },
  'contractor-deployments': { path: '/people/contractors', api: 'contractor-deployments', perm: 'contractor', title: 'Contractor deployment', singular: 'daily deployment', help: 'Contracted vs actually present headcount for manpower contractors. Shortfalls feed vendor scores.', cols: ['date', 'vendorId.name|Contractor', 'departmentId.name|Department', 'contractedHeadcount|Contracted', 'presentCount|Present', 'shortfall', 'status||status'], tabs: [{ label: 'All' }, { label: 'Shortfall', q: { view: 'shortfall' } }, { label: 'To approve', q: { 'filter[status]': 'submitted' } }], fields: [{ n: 'vendorId', l: 'Contractor', t: 'ref', ref: 'vendors', req: 1 }, { n: 'departmentId', l: 'Department', t: 'ref', ref: 'departments' }, { n: 'date', t: 'date', req: 1 }, { n: 'contractedHeadcount', t: 'number', req: 1 }, { n: 'presentCount', t: 'number', req: 1 }, { n: 'remarks', t: 'textarea' }], tLabels: { approved: 'Approve', rejected: 'Reject' } },

  // ── Maintenance ──
  assets: {
    path: '/assets', api: 'assets', perm: 'asset', title: 'Assets', singular: 'asset', help: 'Every piece of equipment: where it is, how critical it is, its PPM, history and AMC.',
    rowLink: (r) => `/assets/${r._id}`,
    cols: ['code||strong', 'name', 'categoryId.name|Category', 'locationId.path|Location', 'criticality||status', 'status||status'],
    tabs: [{ label: 'All' }, { label: 'Critical', q: { 'filter[criticality]': 'critical' } }, { label: 'Breakdown', q: { 'filter[status]': 'breakdown' } }],
    fields: [{ n: 'code', req: 1 }, { n: 'name', req: 1 }, { n: 'categoryId', l: 'Category', t: 'ref', ref: 'asset-categories', req: 1 }, { n: 'locationId', l: 'Location', t: 'ref', ref: 'locations', req: 1 }, { n: 'departmentId', l: 'Responsible department', t: 'ref', ref: 'departments' }, { n: 'criticality', t: 'select', o: ['critical', 'high', 'normal'] }, { n: 'make' }, { n: 'model' }, { n: 'serialNo' }, { n: 'capacity' }, { n: 'installDate', t: 'date' }, { n: 'warrantyExpiry', t: 'date' }, { n: 'cost', l: 'Purchase cost (₹)', t: 'number' }, status(['running', 'standby', 'under_maintenance', 'breakdown', 'decommissioned']), { n: 'photos', t: 'photos' }],
  },
  'checklist-templates': { path: '/maintenance/checklists', api: 'checklist-templates', perm: 'ppm', title: 'Checklist templates', singular: 'template', help: 'Questions a technician answers during PPM or inspections. Number items with min/max flag deviations automatically.', cols: ['name||strong', 'appliesTo|Used for', 'categoryCode|Asset type', 'items|Items|count'], fields: [{ n: 'name', req: 1 }, { n: 'appliesTo', t: 'select', o: ['ppm', 'inspection', 'daily_check', 'breakdown'] }, { n: 'categoryCode', l: 'Asset category code' }, { n: 'sopId', l: 'SOP', t: 'ref', ref: 'sops' }, { n: 'items', t: 'lines', sub: [{ n: 'label', l: 'Question' }, { n: 'type', t: 'select', o: ['yesno', 'number', 'reading', 'text', 'photo'] }, { n: 'min', t: 'number' }, { n: 'max', t: 'number' }, { n: 'unit' }] }] },
  'ppm-schedules': { path: '/maintenance/ppm', api: 'ppm-schedules', perm: 'ppm', title: 'PPM schedules', singular: 'PPM schedule', help: 'How often each asset is serviced. Work orders are generated automatically 7 days ahead.', cols: ['assetId.code|Asset|strong', 'title', 'frequency', 'nextDueDate|Next due|date', 'assigneeIds|Assigned to|chips', 'active|Active|bool'], fields: [{ n: 'assetId', l: 'Asset', t: 'ref', ref: 'assets', req: 1 }, { n: 'title' }, { n: 'templateId', l: 'Checklist', t: 'ref', ref: 'checklist-templates' }, { n: 'frequency', t: 'select', o: ['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'run_hours'] }, { n: 'runHoursInterval', l: 'Every N run hours', t: 'number' }, { n: 'departmentId', l: 'Department', t: 'ref', ref: 'departments' }, { n: 'assigneeIds', l: 'Assign to', t: 'refs', ref: 'users' }, { n: 'startDate', t: 'date' }, { n: 'active', t: 'bool', def: true }], actions: [{ label: 'Generate work orders (30 days)', perm: 'ppm:create', run: (d) => api.post(`/ppm-schedules/${d._id}/generate`, { days: 30 }), success: (r) => `${r.created} work order(s) created` }] },

  // ── Stores & procurement ──
  items: { path: '/inventory/items', api: 'items', perm: 'inventory', title: 'Item master', singular: 'item', help: 'Spares and consumables with min, reorder and max levels.', cols: ['code||strong', 'name', 'category', 'uom|UOM', 'unitCost|Unit cost|inr', 'reorderLevel|Reorder at', 'binLocation|Bin'], fields: [{ n: 'code', req: 1 }, { n: 'name', req: 1 }, { n: 'category', t: 'select', o: ['electrical_spares', 'hvac_filters', 'plumbing', 'chemicals', 'ppe', 'housekeeping', 'general'] }, { n: 'uom', l: 'Unit of measure' }, { n: 'hsn', l: 'HSN' }, { n: 'unitCost', t: 'number' }, { n: 'gstPct', l: 'GST %', t: 'number' }, { n: 'minLevel', t: 'number' }, { n: 'reorderLevel', t: 'number' }, { n: 'reorderQty', t: 'number' }, { n: 'maxLevel', t: 'number' }, { n: 'preferredVendorId', l: 'Preferred vendor', t: 'ref', ref: 'vendors' }, { n: 'binLocation' }, { n: 'isChemical', t: 'bool' }, { n: 'msdsUrl', l: 'MSDS', t: 'file' }] },
  stores: { path: '/inventory/stores', api: 'stores', perm: 'inventory', title: 'Stores', singular: 'store', cols: ['name||strong', 'code', 'type'], fields: [{ n: 'name', req: 1 }, { n: 'code' }, { n: 'type', t: 'select', o: ['main', 'engineering', 'other'] }] },
  'material-issues': {
    path: '/inventory/issues', api: 'material-issues', perm: 'inventory', detail: (doc) => ['issued', 'partially_returned'].includes(doc.status) && <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Return unused parts</Typography><ReturnForm issue={doc} onDone={() => {}} /></Box>, title: 'Material issues', singular: 'material request', createLabel: 'Request materials', help: 'Parts requested against a job or department. The storekeeper issues them and the cost posts to the work order.',
    cols: ['number||strong', 'workOrderId.number|Work order', 'requestedBy.name|Requested by', 'items|Lines|count', 'status||status', 'totalCost|Cost|inr', 'createdAt|Requested|ago'],
    tabs: [{ label: 'Waiting to issue', q: { 'filter[status]': 'requested' } }, { label: 'Issued', q: { 'filter[status]': 'issued' } }, { label: 'All' }],
    fields: [{ n: 'storeId', l: 'Store', t: 'ref', ref: 'stores', req: 1 }, { n: 'workOrderId', l: 'Work order', t: 'ref', ref: 'work-orders' }, { n: 'departmentId', l: 'Department', t: 'ref', ref: 'departments' }, { n: 'items', t: 'lines', req: 1, sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'qty', t: 'number' }] }, { n: 'note', t: 'textarea' }],
    actions: [
      { label: 'Issue now', perm: 'inventory:update', show: (d) => d.status === 'requested', run: (d) => api.post(`/material-issues/${d._id}/issue`), success: 'Materials issued; stock updated' },
      { label: 'Reject', perm: 'inventory:update', color: 'error', show: (d) => d.status === 'requested', prompt: 'Why is this request rejected?', run: (d, reason) => api.post(`/material-issues/${d._id}/reject`, { reason }), success: 'Request rejected' },
    ],
  },
  grns: { path: '/inventory/grns', api: 'grns', perm: 'inventory', title: 'Goods receipts', singular: 'goods receipt', createLabel: 'Receive goods', help: 'Record what arrived against a purchase order. Stock goes up only here.', noEdit: 1, noDelete: 1, cols: ['number||strong', 'poId.number|PO', 'storeId.name|Store', 'items|Lines|count', 'receivedBy.name|Received by', 'at|Received|datetime'], fields: [{ n: 'poId', l: 'Purchase order', t: 'ref', ref: 'purchase-orders', req: 1 }, { n: 'storeId', l: 'Store', t: 'ref', ref: 'stores', req: 1 }, { n: 'items', t: 'lines', req: 1, sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'receivedQty', l: 'Received', t: 'number' }, { n: 'rejectedQty', l: 'Rejected', t: 'number' }, { n: 'reason' }, { n: 'batchNo' }, { n: 'expiry', t: 'date' }] }, { n: 'notes', t: 'textarea' }] },
  'stock-counts': { path: '/inventory/counts', api: 'stock-counts', perm: 'inventory', title: 'Stock counts', singular: 'stock count', createLabel: 'Start a count', help: 'Count the shelves, enter counted quantities, and approval posts any variance to the ledger.', cols: ['number||strong', 'storeId.name|Store', 'lines|Items|count', 'status||status', 'createdAt|Started|date'], fields: [{ n: 'storeId', l: 'Store', t: 'ref', ref: 'stores', req: 1, hideOnEdit: 1 }, { n: 'lines', l: 'Counted quantities', t: 'lines', hideOnCreate: 1, sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'systemQty', l: 'System', t: 'number' }, { n: 'countedQty', l: 'Counted', t: 'number' }] }, { n: 'notes', t: 'textarea' }], tLabels: { counted: 'Mark as counted', approved: 'Approve variance', planned: 'Back to counting', cancelled: 'Cancel' } },
  'purchase-requests': {
    path: '/procurement/requests', api: 'purchase-requests', perm: 'procurement', comments: 'PurchaseRequest', detail: (doc) => <QuoteComparison pr={doc} />, title: 'Purchase requests', singular: 'purchase request', help: 'Ask to buy something. Supervisor → PM approve; above the limit the owner approves too.',
    cols: ['number||strong', 'reason', 'estTotal|Estimate|inr', 'requestedBy.name|Requested by', 'status||status', 'createdAt|Raised|date'],
    tabs: [{ label: 'Waiting approval', q: { 'filter[status]': 'submitted' } }, { label: 'Approved', q: { 'filter[status]': 'approved' } }, { label: 'Drafts', q: { 'filter[status]': 'draft' } }, { label: 'All' }],
    fields: [{ n: 'items', t: 'lines', req: 1, sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'qty', t: 'number' }, { n: 'rate', l: 'Est. rate', t: 'number' }, { n: 'reason' }] }, { n: 'workOrderId', l: 'For work order', t: 'ref', ref: 'work-orders' }, { n: 'reason', t: 'textarea' }],
    headerActions: [{ label: 'Draft from reorder alerts', perm: 'procurement:create', run: () => api.post('/purchase-requests/from-alerts'), success: (r) => `${r.number} drafted with ${r.items.length} item(s)` }],
    tLabels: { submitted: 'Submit for approval', approved: 'Approve', rejected: 'Reject', ordered: 'Mark ordered', cancelled: 'Cancel' },
  },
  quotations: { path: '/procurement/quotations', api: 'quotations', perm: 'procurement', title: 'Vendor quotations', singular: 'quotation', help: 'Attach up to three quotes per request and compare totals.', cols: ['prId.number|Request', 'vendorId.name|Vendor', 'total|Total|inr', 'deliveryDays|Delivery (days)', 'selected|Selected|bool'], fields: [{ n: 'prId', l: 'Purchase request', t: 'ref', ref: 'purchase-requests', req: 1 }, { n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors', req: 1 }, { n: 'items', t: 'lines', sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'rate', t: 'number' }] }, { n: 'deliveryDays', t: 'number' }, { n: 'fileUrl', l: 'Quote document', t: 'file' }, { n: 'selected', l: 'Selected quote', t: 'bool' }, { n: 'notes', t: 'textarea' }] },
  'purchase-orders': {
    path: '/procurement/orders', api: 'purchase-orders', perm: 'procurement', comments: 'PurchaseOrder', title: 'Purchase orders', singular: 'purchase order', help: 'Orders to vendors with GST. Approval depends on value. Use Print to save a PDF.',
    cols: ['number||strong', 'vendorId.name|Vendor', 'total|Total (incl. GST)|inr', 'deliveryDate|Delivery|date', 'status||status'],
    tabs: [{ label: 'All' }, { label: 'Waiting approval', q: { 'filter[status]': 'submitted' } }, { label: 'Open', q: { 'filter[status]': 'approved,sent,partially_received' } }],
    fields: [{ n: 'prId', l: 'From purchase request', t: 'ref', ref: 'purchase-requests', params: { 'filter[status]': 'approved' }, help: 'Leave the lines empty to copy them from the request' }, { n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors', req: 1 }, { n: 'items', t: 'lines', sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'qty', t: 'number' }, { n: 'rate', t: 'number' }, { n: 'gstPct', l: 'GST %', t: 'number' }] }, { n: 'deliveryDate', t: 'date' }, { n: 'terms', t: 'textarea' }],
    actions: [{ label: 'Download PDF', run: (d) => download(`/purchase-orders/${d._id}/pdf`, {}, `${d.number}.pdf`) }, { label: 'Print view', run: (d) => window.open(`/print/po/${d._id}`, '_blank') }],
    tLabels: { submitted: 'Submit for approval', approved: 'Approve', rejected: 'Reject', sent: 'Mark sent to vendor', closed: 'Close', cancelled: 'Cancel' },
  },

  // ── Vendors ──
  vendors: {
    path: '/vendors/list', api: 'vendors', perm: 'vendor', title: 'Vendors', singular: 'vendor', help: 'AMC providers, suppliers and manpower contractors. Bank details are encrypted and shown masked.',
    cols: ['name||strong', 'types|Type|chips', 'gstin|GSTIN', 'contacts.0.name|Contact', 'contacts.0.phone|Phone', 'status||status'],
    fields: [{ n: 'name', req: 1 }, { n: 'code' }, { n: 'types', t: 'multiselect', o: ['amc', 'supplier', 'manpower', 'service'] }, { n: 'gstin', l: 'GSTIN' }, { n: 'pan', l: 'PAN' }, { n: 'address', t: 'textarea' }, { n: 'contacts', t: 'lines', sub: [{ n: 'name' }, { n: 'phone' }, { n: 'email' }] }, { n: 'bank.accountName', l: 'Account name' }, { n: 'bank.accountNo', l: 'Account number', help: 'Stored encrypted' }, { n: 'bank.ifsc', l: 'IFSC' }, { n: 'bank.bankName', l: 'Bank' }, { n: 'documents', t: 'lines', sub: [{ n: 'name' }, { n: 'type' }, { n: 'expiry', t: 'date' }] }, { n: 'rating', t: 'number' }, status(['active', 'inactive', 'blacklisted'])],
    show: [['Bank account', (d) => d.bank?.accountNoMasked]],
    detail: (doc) => <VendorScorecard id={doc._id} />,
  },
  contracts: { path: '/vendors/contracts', api: 'contracts', perm: 'vendor', title: 'Contracts', singular: 'contract', help: 'Scope, value, SLA and penalty terms. Expiry alerts go out at 90, 60, 30 and 7 days.', cols: ['number||strong', 'title', 'vendorId.name|Vendor', 'end|Ends|date', 'value|Value|inr', 'status||status'], fields: [{ n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors', req: 1 }, { n: 'number', req: 1 }, { n: 'title' }, { n: 'scope', t: 'textarea' }, { n: 'start', t: 'date', req: 1 }, { n: 'end', t: 'date', req: 1 }, { n: 'value', t: 'number' }, { n: 'paymentTerms' }, { n: 'slaTerms', t: 'textarea' }, { n: 'penalty', t: 'textarea' }, status(['draft', 'active', 'expiring', 'expired', 'renewed', 'terminated'])] },
  amcs: {
    path: '/vendors/amcs', api: 'amcs', perm: 'vendor', title: 'AMCs', singular: 'AMC', help: 'Annual maintenance contracts: covered assets and visit frequency. Renewals need PM and owner approval.',
    cols: ['name||strong', 'vendorId.name|Vendor', 'assetIds|Assets|count', 'visitFrequency|Visits', 'end|Ends|date', 'value|Value|inr', 'status||status'],
    tabs: [{ label: 'All' }, { label: 'Due in 30 days', q: { view: 'expiring' } }, { label: 'Renewal requested', q: { 'filter[status]': 'renewal_requested' } }],
    fields: [{ n: 'name', req: 1 }, { n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors', req: 1 }, { n: 'contractId', l: 'Contract', t: 'ref', ref: 'contracts' }, { n: 'assetIds', l: 'Covered assets', t: 'refs', ref: 'assets' }, { n: 'type', t: 'select', o: ['comprehensive', 'non_comprehensive'] }, { n: 'visitFrequency', t: 'select', o: ['monthly', 'quarterly', 'half_yearly', 'yearly'] }, { n: 'start', t: 'date', req: 1 }, { n: 'end', t: 'date', req: 1 }, { n: 'value', t: 'number' }],
    tLabels: { renewal_requested: 'Request renewal', renewed: 'Approve renewal', expiring: 'Reject renewal', active: 'Activate' }, tFields: { renewal_requested: [{ n: 'value', l: 'Renewal value (₹)', t: 'number' }] },
  },
  'amc-visits': { path: '/vendors/visits', api: 'amc-visits', perm: 'vendor', title: 'AMC visits', singular: 'visit', help: 'Scheduled vendor visits. Visits not done within 3 days are flagged as missed.', noCreate: 0, cols: ['plannedDate|Planned|date', 'amcId.name|AMC', 'vendorId.name|Vendor', 'status||status', 'actualDate|Done on|date', 'technicianName|Technician'], tabs: [{ label: 'Upcoming', q: { 'filter[status]': 'scheduled' } }, { label: 'Done', q: { 'filter[status]': 'done' } }, { label: 'Missed', q: { 'filter[status]': 'missed' } }, { label: 'All' }], fields: [{ n: 'amcId', l: 'AMC', t: 'ref', ref: 'amcs', req: 1 }, { n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors' }, { n: 'plannedDate', t: 'date', req: 1 }], tLabels: { done: 'Mark visit done', missed: 'Mark missed' }, tFields: { done: [{ n: 'actualDate', t: 'date', req: 1 }, { n: 'technicianName', req: 1 }, { n: 'findings', t: 'textarea' }, { n: 'reportUrl', l: 'Service report', t: 'file' }] } },
  'vendor-invoices': { path: '/vendors/invoices', api: 'vendor-invoices', perm: 'vendor', title: 'Vendor invoices', singular: 'invoice', createLabel: 'Upload invoice', help: 'Submitted → verified against PO/GRN or service report → approved by PM → paid.', cols: ['number||strong', 'vendorId.name|Vendor', 'total|Total|inr', 'invoiceDate|Date|date', 'status||status'], tabs: [{ label: 'All' }, { label: 'To verify', q: { 'filter[status]': 'submitted' } }, { label: 'To approve', q: { 'filter[status]': 'verified' } }, { label: 'Disputed', q: { 'filter[status]': 'disputed' } }], fields: [{ n: 'vendorId', l: 'Vendor', t: 'ref', ref: 'vendors' }, { n: 'number', l: 'Invoice number', req: 1 }, { n: 'invoiceDate', t: 'date' }, { n: 'poId', l: 'Purchase order', t: 'ref', ref: 'purchase-orders' }, { n: 'contractId', l: 'Contract', t: 'ref', ref: 'contracts' }, { n: 'amount', l: 'Amount before GST', t: 'number', req: 1 }, { n: 'gst', l: 'GST amount', t: 'number' }, { n: 'fileUrl', l: 'Invoice file', t: 'file' }], tLabels: { verified: 'Verify', approved: 'Approve', paid: 'Mark paid', disputed: 'Dispute', submitted: 'Resubmit' }, tFields: { disputed: [{ n: 'disputeReason', t: 'textarea', req: 1 }], paid: [{ n: 'paymentRef', l: 'Payment reference (UTR)', req: 1 }] } },

  // ── HSE ──
  incidents: {
    path: '/hse/incidents', api: 'incidents', perm: 'hse', comments: 'Incident', title: 'Incidents', singular: 'incident', createLabel: 'Report an incident', help: 'Incident → immediate action → investigation → corrective action (CAPA) → verification → closure.',
    cols: ['number||strong', 'title', 'type', 'severity||status', 'occurredAt|When|datetime', 'status||status'],
    tabs: [{ label: 'Open', q: { 'filter[status]': 'reported,immediate_action,investigation,capa,verification' } }, { label: 'Closed', q: { 'filter[status]': 'closed' } }, { label: 'All' }],
    stages: [['reported', 'Reported'], ['immediate_action', 'Immediate action'], ['investigation', 'Investigation'], ['capa', 'CAPA'], ['verification', 'Verification'], ['closed', 'Closed']],
    fields: [{ n: 'title', req: 1, full: 1 }, { n: 'type', t: 'select', o: ['injury', 'near_miss', 'fire', 'electrical', 'property_damage', 'environmental', 'security'] }, { n: 'severity', t: 'select', o: ['minor', 'major', 'critical'] }, { n: 'occurredAt', l: 'When did it happen?', t: 'datetime' }, { n: 'locationId', l: 'Where?', t: 'ref', ref: 'locations' }, { n: 'people', l: 'People involved', t: 'tags' }, { n: 'description', t: 'textarea' }, { n: 'photos', t: 'photos' }],
    show: [['Immediate action', (d) => d.immediateAction], ['Root cause', (d) => d.rootCause], ['Corrective action', (d) => d.correctiveAction], ['Verification', (d) => d.verificationNote]],
    tLabels: { immediate_action: 'Record immediate action', investigation: 'Record root cause', capa: 'Assign corrective action', verification: 'Send for verification', closed: 'Verify & close' },
    tFields: { immediate_action: [{ n: 'immediateAction', t: 'textarea', req: 1 }], investigation: [{ n: 'rootCause', t: 'textarea', req: 1 }, { n: 'lti', l: 'Lost-time injury', t: 'bool' }], capa: [{ n: 'correctiveAction', t: 'textarea', req: 1 }, { n: 'ownerId', l: 'Action owner', t: 'ref', ref: 'users' }, { n: 'dueDate', t: 'date' }], verification: [{ n: 'verificationNote', l: 'What was checked', t: 'textarea', req: 1 }] },
  },
  inspections: { path: '/hse/inspections', api: 'inspections', perm: 'hse', title: 'Safety inspections', singular: 'inspection', createLabel: 'Schedule inspection', help: 'Fire extinguishers, exits, panels, work at height and housekeeping safety.', cols: ['scheduledDate|Scheduled|datetime', 'title||strong', 'type', 'status||status', 'score'], tabs: [{ label: 'Due', q: { 'filter[status]': 'scheduled' } }, { label: 'Done', q: { 'filter[status]': 'done' } }, { label: 'All' }], fields: [{ n: 'title', req: 1 }, { n: 'type', t: 'select', o: ['fire_extinguisher', 'emergency_exit', 'electrical_panel', 'work_at_height', 'housekeeping_safety', 'other'] }, { n: 'locationId', l: 'Location', t: 'ref', ref: 'locations' }, { n: 'scheduledDate', t: 'datetime', req: 1 }, { n: 'templateId', l: 'Checklist', t: 'ref', ref: 'checklist-templates' }], tLabels: { done: 'Record result' }, tFields: { done: [{ n: 'score', l: 'Score %', t: 'number' }, { n: 'findings', t: 'textarea' }] } },
  observations: { path: '/hse/observations', api: 'observations', perm: 'hse', title: 'Risk observations', singular: 'observation', createLabel: 'Report unsafe act / condition', help: 'Risk = likelihood × severity (1–25). 15+ is high risk.', cols: ['description||strong', 'type', 'riskScore|Risk (1–25)', 'status||status', 'createdAt|Reported|date'], fields: [{ n: 'type', t: 'select', o: ['unsafe_act', 'unsafe_condition'] }, { n: 'description', t: 'textarea', req: 1 }, { n: 'likelihood', t: 'select', o: [1, 2, 3, 4, 5].map((x) => [x, `${x}`]) }, { n: 'severity', t: 'select', o: [1, 2, 3, 4, 5].map((x) => [x, `${x}`]) }, { n: 'locationId', l: 'Location', t: 'ref', ref: 'locations' }, { n: 'photo', t: 'file' }], tLabels: { capa: 'Raise CAPA', closed: 'Close' }, tFields: { capa: [{ n: 'action', l: 'Preventive action', t: 'textarea', req: 1 }, { n: 'ownerId', l: 'Owner', t: 'ref', ref: 'users' }] } },
  capas: { path: '/hse/capas', api: 'capas', perm: 'hse', comments: 'Capa', title: 'CAPA tracker', singular: 'CAPA', help: 'Corrective and preventive actions with an owner and due date, verified by HSE.', cols: ['number||strong', 'action', 'kind', 'ownerId.name|Owner', 'dueDate|Due|date', 'status||status'], tabs: [{ label: 'Open', q: { 'filter[status]': 'open,in_progress,done' } }, { label: 'Overdue', q: { view: 'overdue' } }, { label: 'All' }], fields: [{ n: 'action', t: 'textarea', req: 1 }, { n: 'kind', t: 'select', o: ['corrective', 'preventive'] }, { n: 'sourceType', t: 'select', o: ['incident', 'observation', 'inspection', 'audit'] }, { n: 'ownerId', l: 'Owner', t: 'ref', ref: 'users' }, { n: 'dueDate', t: 'date' }], tLabels: { in_progress: 'Start', done: 'Mark done', verified: 'Verify', closed: 'Close' }, tFields: { done: [{ n: 'evidence', t: 'photos' }] } },
  compliances: { path: '/hse/compliances', api: 'compliances', perm: 'hse', title: 'Statutory register', singular: 'certificate', help: 'Fire NOC, lift licences, pollution consents and more, with renewal alerts.', cols: ['name||strong', 'authority', 'certificateNo|Certificate no.', 'validTo|Valid until|date'], fields: [{ n: 'name', req: 1 }, { n: 'authority' }, { n: 'certificateNo' }, { n: 'validFrom', t: 'date' }, { n: 'validTo', t: 'date', req: 1 }, { n: 'ownerId', l: 'Owner', t: 'ref', ref: 'users' }, { n: 'docUrl', l: 'Certificate', t: 'file' }, { n: 'notes', t: 'textarea' }] },
  permits: { path: '/hse/permits', api: 'permits', perm: 'hse', title: 'Permit to work', singular: 'permit', createLabel: 'Request a permit', help: 'Hot work, work at height, electrical isolation and confined space need HSE approval first.', cols: ['number||strong', 'type', 'workDescription|Work', 'validFrom|From|datetime', 'validTo|To|datetime', 'status||status'], fields: [{ n: 'type', t: 'select', o: ['hot_work', 'work_at_height', 'electrical_isolation', 'confined_space'], req: 1 }, { n: 'locationId', l: 'Location', t: 'ref', ref: 'locations' }, { n: 'workDescription', t: 'textarea', req: 1 }, { n: 'contractor' }, { n: 'validFrom', t: 'datetime', req: 1 }, { n: 'validTo', t: 'datetime', req: 1 }, { n: 'precautions', t: 'textarea' }], tLabels: { approved: 'Approve', cancelled: 'Cancel', active: 'Start work', closed: 'Close permit' } },
  trainings: { path: '/hse/trainings', api: 'trainings', perm: 'hse', title: 'Training & drills', singular: 'training', help: 'Toolbox talks, fire drills and mock drills with attendance.', cols: ['date||date', 'topic||strong', 'type', 'trainer', 'attendees|Attendees|count'], fields: [{ n: 'topic', req: 1 }, { n: 'type', t: 'select', o: ['toolbox_talk', 'fire_drill', 'mock_drill', 'induction', 'other'] }, { n: 'date', t: 'date', req: 1 }, { n: 'trainer' }, { n: 'durationMin', l: 'Duration (min)', t: 'number' }, { n: 'attendees', t: 'refs', ref: 'employees' }, { n: 'notes', t: 'textarea' }] },

  // ── Management ──
  sops: { path: '/sops', api: 'sops', perm: 'sop', title: 'SOP library', singular: 'SOP', help: 'Standard operating procedures. Technicians see the linked SOP while doing the job.', cols: ['title||strong', 'departmentCode|Dept', 'version', 'effectiveDate|Effective|date', 'acknowledgements|Read by|count', 'status||status'], fields: [{ n: 'title', req: 1, full: 1 }, { n: 'departmentCode', l: 'Department code' }, { n: 'version' }, { n: 'effectiveDate', t: 'date' }, status(['draft', 'approved', 'retired']), { n: 'content', t: 'textarea', rows: 10 }, { n: 'fileUrl', l: 'Document', t: 'file' }], detail: (doc) => <Box sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 2, borderRadius: 2, typography: 'body2' }}>{doc.content}</Box>, actions: [{ label: 'I have read this SOP', run: (d) => api.post(`/sops/${d._id}/acknowledge`), success: 'Thanks — acknowledgement recorded' }] },
  'action-items': { path: '/daily/actions', api: 'action-items', perm: 'daily', title: 'Action points', singular: 'action point', help: 'Tasks from the PM’s daily review and reports, each with an owner and due date.', cols: ['title||strong', 'ownerId.name|Owner', 'dueDate|Due|date', 'source', 'status||status'], tabs: [{ label: 'Open', q: { 'filter[status]': 'open,in_progress' } }, { label: 'Done', q: { 'filter[status]': 'done' } }, { label: 'All' }], fields: [{ n: 'title', req: 1, full: 1 }, { n: 'ownerId', l: 'Owner', t: 'ref', ref: 'users', req: 1 }, { n: 'dueDate', t: 'date' }, { n: 'source', t: 'select', o: ['daily_review', 'report', 'audit', 'eod', 'other'] }, { n: 'note', t: 'textarea' }], tLabels: { in_progress: 'Start', done: 'Mark done', cancelled: 'Cancel', open: 'Reopen' } },
  'shift-logs': { path: '/daily/logs', api: 'shift-logs', perm: 'daily', title: 'Shift logs & occurrence book', singular: 'log', help: 'What happened on each shift and what is handed over.', cols: ['date', 'kind', 'departmentId.name|Department', 'shiftId.name|Shift', 'entries|Entries|count'], fields: [{ n: 'departmentId', l: 'Department', t: 'ref', ref: 'departments' }, { n: 'date', t: 'date', req: 1 }, { n: 'shiftId', l: 'Shift', t: 'ref', ref: 'shifts' }, { n: 'kind', t: 'select', o: [['shift_log', 'Shift log'], ['occurrence_book', 'Occurrence book (Security)']] }], detail: (doc) => <Entries doc={doc} />, actions: [{ label: 'Add entry', perm: 'daily:create', prompt: 'What happened?', run: (d, text) => api.post(`/shift-logs/${d._id}/entries`, { text }), success: 'Entry added' }] },
  'vendor-scores': { path: '/vendors/scores', api: 'vendor-scores', perm: 'vendor', title: 'Vendor scorecards', noCreate: 1, noEdit: 1, noDelete: 1, cols: ['period', 'vendorId.name|Vendor', 'onTimeVisitPct|On-time %', 'slaPct|SLA %', 'qualityRating|Quality', 'disputes', 'score||strong'], fields: [] },
};
