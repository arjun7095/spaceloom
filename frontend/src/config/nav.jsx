import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined';
import TodayOutlined from '@mui/icons-material/TodayOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import SupportAgentOutlined from '@mui/icons-material/SupportAgentOutlined';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import PrecisionManufacturingOutlined from '@mui/icons-material/PrecisionManufacturingOutlined';
import EventRepeatOutlined from '@mui/icons-material/EventRepeatOutlined';
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined';
import FingerprintOutlined from '@mui/icons-material/FingerprintOutlined';
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import BeachAccessOutlined from '@mui/icons-material/BeachAccessOutlined';
import MoreTimeOutlined from '@mui/icons-material/MoreTimeOutlined';
import EditCalendarOutlined from '@mui/icons-material/EditCalendarOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import OutboxOutlined from '@mui/icons-material/OutboxOutlined';
import MoveToInboxOutlined from '@mui/icons-material/MoveToInboxOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import WarehouseOutlined from '@mui/icons-material/WarehouseOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import RequestQuoteOutlined from '@mui/icons-material/RequestQuoteOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import HandshakeOutlined from '@mui/icons-material/HandshakeOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import RequestPageOutlined from '@mui/icons-material/RequestPageOutlined';
import LeaderboardOutlined from '@mui/icons-material/LeaderboardOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import ContentPasteSearchOutlined from '@mui/icons-material/ContentPasteSearchOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import VpnKeyOutlined from '@mui/icons-material/VpnKeyOutlined';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import NightsStayOutlined from '@mui/icons-material/NightsStayOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import LibraryBooksOutlined from '@mui/icons-material/LibraryBooksOutlined';
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import WorkspacesOutlined from '@mui/icons-material/WorkspacesOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import LabelOutlined from '@mui/icons-material/LabelOutlined';
import TrackChangesOutlined from '@mui/icons-material/TrackChangesOutlined';
import CorporateFareOutlined from '@mui/icons-material/CorporateFareOutlined';
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import SettingsSuggestOutlined from '@mui/icons-material/SettingsSuggestOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import ListAltOutlined from '@mui/icons-material/ListAltOutlined';
import HelpOutlineOutlined from '@mui/icons-material/HelpOutlineOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import LanOutlined from '@mui/icons-material/LanOutlined';
import FenceOutlined from '@mui/icons-material/FenceOutlined';
import RuleOutlined from '@mui/icons-material/RuleOutlined';
import ScheduleSendOutlined from '@mui/icons-material/ScheduleSendOutlined';
import ApiOutlined from '@mui/icons-material/ApiOutlined';
import { can, canAny, hasRole } from '../store/auth';

const admin = (u) => can(u, '*') || hasRole(u, 'property_manager', 'super_admin');
const office = (u) => u.layout !== 'field';

export const NAV = [
  { label: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: SpaceDashboardOutlined, perm: 'dashboard:read' },
    { to: '/today', label: 'Today', icon: TodayOutlined, any: ['workorder:read', 'ticket:read'] },
    { to: '/approvals', label: 'Approvals', icon: TaskAltOutlined, fn: (u) => office(u) && canAny(u, ['leave:approve', 'procurement:approve', 'vendor:approve', 'hse:approve', 'report:approve', 'contractor:approve']) },
  ] },
  { label: 'Helpdesk', items: [
    { to: '/tickets', label: 'Tickets', icon: SupportAgentOutlined, perm: 'ticket:read' },
    { to: '/tickets/new', label: 'Raise a ticket', icon: AddCircleOutline, perm: 'ticket:create' },
  ] },
  { label: 'Maintenance', items: [
    { to: '/work-orders', label: 'Work orders', icon: BuildOutlined, perm: 'workorder:read' },
    { to: '/maintenance/log-sheets', label: 'Daily log sheets', icon: ListAltOutlined, perm: 'workorder:read', fn: office },
    { to: '/assets', label: 'Assets', icon: PrecisionManufacturingOutlined, perm: 'asset:read', fn: office },
    { to: '/maintenance/ppm', label: 'PPM schedules', icon: EventRepeatOutlined, perm: 'ppm:read', fn: office },
    { to: '/maintenance/checklists', label: 'Checklist templates', icon: ChecklistOutlined, perm: 'ppm:update' },
  ] },
  { label: 'People', items: [
    { to: '/my-attendance', label: 'My check-in', icon: FingerprintOutlined, fn: (u) => Boolean(u.employeeId) },
    { to: '/attendance', label: 'Attendance', icon: HowToRegOutlined, perm: 'attendance:approve' },
    { to: '/people/roster', label: 'Shift roster', icon: CalendarMonthOutlined, perm: 'roster:read' },
    { to: '/people/employees', label: 'Employees', icon: BadgeOutlined, perm: 'employee:read', fn: office },
    { to: '/people/org-chart', label: 'Org chart', icon: LanOutlined, perm: 'employee:read', fn: office },
    { to: '/people/leave', label: 'Leave', icon: BeachAccessOutlined, perm: 'leave:read' },
    { to: '/people/overtime', label: 'Overtime', icon: MoreTimeOutlined, perm: 'leave:read' },
    { to: '/people/regularizations', label: 'Regularisation', icon: EditCalendarOutlined, perm: 'leave:read' },
    { to: '/people/contractors', label: 'Contractor deployment', icon: GroupsOutlined, perm: 'contractor:read' },
  ] },
  { label: 'Stores', items: [
    { to: '/inventory', label: 'Stock', icon: Inventory2Outlined, perm: 'inventory:read', fn: office },
    { to: '/inventory/issues', label: 'Material issues', icon: OutboxOutlined, perm: 'inventory:read' },
    { to: '/inventory/grns', label: 'Goods receipts', icon: MoveToInboxOutlined, perm: 'inventory:update' },
    { to: '/inventory/counts', label: 'Stock counts', icon: FactCheckOutlined, perm: 'inventory:update' },
    { to: '/inventory/items', label: 'Item master', icon: CategoryOutlined, perm: 'inventory:read', fn: office },
    { to: '/inventory/stores', label: 'Stores', icon: WarehouseOutlined, perm: 'inventory:update' },
  ] },
  { label: 'Procurement', items: [
    { to: '/procurement/requests', label: 'Purchase requests', icon: ShoppingCartOutlined, perm: 'procurement:read', fn: office },
    { to: '/procurement/quotations', label: 'Quotations', icon: RequestQuoteOutlined, perm: 'procurement:update' },
    { to: '/procurement/orders', label: 'Purchase orders', icon: ReceiptLongOutlined, perm: 'procurement:read' },
  ] },
  { label: 'Vendors', items: [
    { to: '/vendors/list', label: 'Vendors', icon: HandshakeOutlined, perm: 'vendor:read' },
    { to: '/vendors/contracts', label: 'Contracts', icon: DescriptionOutlined, perm: 'vendor:read' },
    { to: '/vendors/amcs', label: 'AMCs', icon: VerifiedOutlined, perm: 'vendor:read' },
    { to: '/vendors/visits', label: 'AMC visits', icon: EventAvailableOutlined, perm: 'vendor:read' },
    { to: '/vendors/invoices', label: 'Invoices', icon: RequestPageOutlined, perm: 'vendor:read' },
    { to: '/vendors/scores', label: 'Scorecards', icon: LeaderboardOutlined, perm: 'vendor:read', fn: office },
  ] },
  { label: 'HSE', items: [
    { to: '/hse/incidents', label: 'Incidents', icon: ReportProblemOutlined, any: ['hse:read', 'hse:create'] },
    { to: '/hse/inspections', label: 'Inspections', icon: ContentPasteSearchOutlined, perm: 'hse:read' },
    { to: '/hse/observations', label: 'Observations', icon: VisibilityOutlined, any: ['hse:read', 'hse:create'] },
    { to: '/hse/capas', label: 'CAPA', icon: AssignmentTurnedInOutlined, perm: 'hse:read' },
    { to: '/hse/permits', label: 'Permit to work', icon: VpnKeyOutlined, perm: 'hse:read' },
    { to: '/hse/compliances', label: 'Statutory register', icon: GavelOutlined, perm: 'hse:read' },
    { to: '/hse/trainings', label: 'Training & drills', icon: SchoolOutlined, perm: 'hse:read' },
  ] },
  { label: 'Management', items: [
    { to: '/reports', label: 'Client reports', icon: AssessmentOutlined, perm: 'report:read' },
    { to: '/reports/schedules', label: 'Report schedules', icon: ScheduleSendOutlined, perm: 'report:create' },
    { to: '/daily/actions', label: 'Action points', icon: FlagOutlined, perm: 'daily:read', fn: office },
    { to: '/daily/eod', label: 'End of day', icon: NightsStayOutlined, perm: 'daily:create' },
    { to: '/daily/logs', label: 'Shift logs', icon: MenuBookOutlined, perm: 'daily:read', fn: office },
    { to: '/sops', label: 'SOP library', icon: LibraryBooksOutlined, perm: 'sop:read' },
  ] },
  { label: 'Setup', items: [
    { to: '/setup/properties', label: 'Properties', icon: ApartmentOutlined, perm: 'property:update' },
    { to: '/setup/locations', label: 'Locations & QR', icon: AccountTreeOutlined, perm: 'property:update' },
    { to: '/setup/geofence', label: 'Geo-fence map', icon: FenceOutlined, perm: 'property:update' },
    { to: '/setup/approval-rules', label: 'Approval rules', icon: RuleOutlined, perm: 'property:update' },
    { to: '/setup/departments', label: 'Departments', icon: WorkspacesOutlined, perm: 'property:update' },
    { to: '/setup/tenants', label: 'Tenants', icon: StorefrontOutlined, perm: 'property:update' },
    { to: '/setup/shifts', label: 'Shifts', icon: ScheduleOutlined, perm: 'property:update' },
    { to: '/setup/holidays', label: 'Holidays', icon: EventBusyOutlined, perm: 'property:update' },
    { to: '/setup/sla-policies', label: 'SLA policies', icon: TimerOutlined, perm: 'property:update' },
    { to: '/setup/ticket-categories', label: 'Ticket categories', icon: LabelOutlined, perm: 'property:update' },
    { to: '/setup/kpis', label: 'KPI targets', icon: TrackChangesOutlined, perm: 'property:update' },
    { to: '/setup/asset-categories', label: 'Asset categories', icon: CategoryOutlined, perm: 'asset:update' },
    { to: '/setup/organizations', label: 'Organisations', icon: CorporateFareOutlined, perm: 'property:create' },
  ] },
  { label: 'Admin', items: [
    { to: '/admin/users', label: 'Users', icon: PeopleAltOutlined, perm: 'user:create' },
    { to: '/admin/roles', label: 'Roles & permissions', icon: AdminPanelSettingsOutlined, perm: 'admin:update' },
    { to: '/admin/delegations', label: 'Delegations', icon: SwapHorizOutlined, perm: 'daily:create' },
    { to: '/admin/import', label: 'Bulk import', icon: UploadFileOutlined, fn: admin },
    { to: '/admin/golive', label: 'Go-live checklist', icon: RocketLaunchOutlined, fn: admin },
    { to: '/admin/jobs', label: 'System jobs', icon: SettingsSuggestOutlined, fn: admin },
    { to: '/admin/api', label: 'API keys & integrations', icon: ApiOutlined, fn: admin },
    { to: '/admin/audit', label: 'Audit log', icon: HistoryOutlined, perm: 'audit:read' },
  ] },
];

export const allowed = (u, item) => (!item.perm || can(u, item.perm)) && (!item.any || canAny(u, item.any)) && (!item.fn || item.fn(u));
export const visibleNav = (u) => NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed(u, i)) })).filter((g) => g.items.length);

// Bottom tabs for field roles (technicians, guards, tenants, vendors).
export function bottomTabs(u) {
  if (hasRole(u, 'tenant')) return [
    { to: '/tickets', label: 'My tickets', icon: ListAltOutlined },
    { to: '/tickets/new', label: 'Raise', icon: AddCircleOutline },
    { to: '/help', label: 'Help', icon: HelpOutlineOutlined },
  ];
  if (hasRole(u, 'vendor')) return [
    { to: '/vendors/visits', label: 'Visits', icon: EventAvailableOutlined },
    { to: '/work-orders', label: 'Jobs', icon: BuildOutlined },
    { to: '/vendors/invoices', label: 'Invoices', icon: RequestPageOutlined },
    { to: '#menu', label: 'More', icon: MoreHorizOutlined },
  ];
  return [
    { to: '/today', label: 'Today', icon: TodayOutlined },
    { to: '/work-orders?view=my', label: 'My jobs', icon: BuildOutlined },
    { to: '/my-attendance', label: 'Check-in', icon: FingerprintOutlined },
    { to: '/tickets/new', label: 'Raise', icon: AddCircleOutline },
    { to: '#menu', label: 'More', icon: MoreHorizOutlined },
  ];
}
