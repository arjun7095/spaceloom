import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useAuth, can } from './store/auth';
import { refreshSession } from './api/client';
import { RESOURCES } from './config/resources';
import { bottomTabs } from './config/nav';
import { Loading, EmptyState } from './components/common';
import AppLayout from './layouts/AppLayout';
import ResourcePage from './pages/ResourcePage';

// Pages load on demand. After sign-in they are also loaded one by one in idle time, so menu taps open
// pages without waiting for their code. Most-used pages first; skipped when the phone asks to save data.
const PAGES = {
  Today: () => import('./pages/Today'),
  TicketList: () => import('./pages/tickets/TicketList'),
  NewTicket: () => import('./pages/tickets/NewTicket'),
  TicketDetail: () => import('./pages/tickets/TicketDetail'),
  WorkOrderList: () => import('./pages/workorders/WorkOrderList'),
  WorkOrderDetail: () => import('./pages/workorders/WorkOrderDetail'),
  CheckIn: () => import('./pages/attendance/CheckIn'),
  Dashboard: () => import('./pages/Dashboard'),
  Approvals: () => import('./pages/Approvals'),
  Login: () => import('./pages/Login'),
  Help: () => import('./pages/Help'),
  Profile: () => import('./pages/Profile'),
  Attendance: () => import('./pages/attendance/Attendance'),
  Roster: () => import('./pages/attendance/Roster'),
  AssetDetail: () => import('./pages/AssetDetail'),
  Stock: () => import('./pages/Stock'),
  Reports: () => import('./pages/reports/Reports'),
  ReportView: () => import('./pages/reports/ReportView'),
  Eod: () => import('./pages/Eod'),
  Admin: () => import('./pages/Admin'),
  PoPrint: () => import('./pages/PoPrint'),
  LogSheets: () => import('./pages/LogSheets'),
  OrgChart: () => import('./pages/OrgChart'),
  GeoFence: () => import('./pages/GeoFence'),
};
const Login = lazy(PAGES.Login);
const Dashboard = lazy(PAGES.Dashboard);
const Today = lazy(PAGES.Today);
const Help = lazy(PAGES.Help);
const Profile = lazy(PAGES.Profile);
const Approvals = lazy(PAGES.Approvals);
const TicketList = lazy(PAGES.TicketList);
const NewTicket = lazy(PAGES.NewTicket);
const TicketDetail = lazy(PAGES.TicketDetail);
const WorkOrderList = lazy(PAGES.WorkOrderList);
const WorkOrderDetail = lazy(PAGES.WorkOrderDetail);
const CheckIn = lazy(PAGES.CheckIn);
const Attendance = lazy(PAGES.Attendance);
const Roster = lazy(PAGES.Roster);
const AssetDetail = lazy(PAGES.AssetDetail);
const Stock = lazy(PAGES.Stock);
const Reports = lazy(PAGES.Reports);
const ReportView = lazy(PAGES.ReportView);
const Eod = lazy(PAGES.Eod);
const Admin = lazy(PAGES.Admin);
const PoPrint = lazy(PAGES.PoPrint);
const LogSheets = lazy(PAGES.LogSheets);
const OrgChart = lazy(PAGES.OrgChart);
const GeoFence = lazy(PAGES.GeoFence);

function preloadPages() {
  if (navigator.connection?.saveData) return;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 400));
  const queue = Object.entries(PAGES).filter(([n]) => n !== 'Login').map(([, load]) => load);
  const next = () => { const load = queue.shift(); if (load) idle(() => load().catch(() => {}).finally(next), { timeout: 5000 }); };
  setTimeout(next, 2500);
}

// The access token can be missing while offline; the first request after reconnecting refreshes it.
function RequireAuth({ children }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function Home() {
  const user = useAuth((s) => s.user);
  if (user.layout === 'field' || !can(user, 'dashboard:read')) return <Navigate to={bottomTabs(user)[0]?.to || '/today'} replace />;
  return <Dashboard />;
}

const NotFound = () => <EmptyState title="Page not found" text="The link may be old or you may not have access." action={<Button href="/">Go home</Button>} />;

export default function App() {
  const { user, token } = useAuth();
  const [ready, setReady] = useState(Boolean(token) || !user);
  useEffect(() => { if (user) preloadPages(); }, [Boolean(user)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Sign out only when the server rejects the session — not when there is simply no signal.
    if (user && !token) refreshSession().catch((err) => { if (err?.response) useAuth.getState().logout(); }).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Box textAlign="center"><Loading label="Signing you in…" /><Typography variant="caption" color="text.secondary">PrimeSpace IPFM</Typography></Box></Box>;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/print/po/:id" element={<RequireAuth><PoPrint /></RequireAuth>} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="today" element={<Today />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="help" element={<Help />} />
          <Route path="profile" element={<Profile />} />
          <Route path="tickets" element={<TicketList />} />
          <Route path="tickets/new" element={<NewTicket />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="work-orders" element={<WorkOrderList />} />
          <Route path="work-orders/:id" element={<WorkOrderDetail />} />
          <Route path="my-attendance" element={<CheckIn />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="people/roster" element={<Roster />} />
          <Route path="assets/:id" element={<AssetDetail />} />
          <Route path="inventory" element={<Stock />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/:id" element={<ReportView />} />
          <Route path="daily/eod" element={<Eod />} />
          <Route path="maintenance/log-sheets" element={<LogSheets />} />
          <Route path="people/org-chart" element={<OrgChart />} />
          <Route path="setup/geofence" element={<GeoFence />} />
          <Route path="admin/:tab" element={<Admin />} />
          {Object.entries(RESOURCES).map(([key, cfg]) => <Route key={key} path={cfg.path.slice(1)} element={<ResourcePage key={key} rk={key} />} />)}
          <Route path="vendors/:id" element={<ResourcePage rk="vendors" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
