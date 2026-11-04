import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Card, CardActionArea, Chip, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip as MuiTooltip, Typography } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { useAuth, can, hasRole } from '../store/auth';
import { PageHeader, QueryState, SectionCard, EmptyState, StackTable } from '../components/common';
import { fmtDate, fmtTime, num } from '../utils/format';
import { CHART, GREY, SHADOW } from '../theme';

// Two-series charts use the validated indigo/orange pair; single-series charts use the brand colour.
const SERIES = CHART.series;
const AXIS = { tick: { fill: CHART.axis, fontSize: 12 }, axisLine: false, tickLine: false };
const STATUS = {
  green: { color: 'success.main', chip: 'success', icon: CheckCircle, text: 'On target' },
  amber: { color: 'warning.main', chip: 'warning', icon: WarningAmberRounded, text: 'Needs attention' },
  red: { color: 'error.main', chip: 'error', icon: ErrorRounded, text: 'Off target' },
  grey: { color: 'text.disabled', chip: 'default', icon: InfoOutlined, text: 'No data yet' },
};
const fmt = (t, v) => (v == null ? '—' : t.unit === '%' ? `${Math.round(v)}%` : num(v));

function TipBox({ active, payload, label: lbl, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: `1px solid ${GREY[200]}`, borderRadius: '10px', px: 1.5, py: 1, boxShadow: SHADOW.lg }}>
      <Typography variant="caption" color="text.secondary">{lbl}</Typography>
      {payload.map((p) => (
        <Stack key={p.dataKey} direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 10, height: 3, borderRadius: 1, bgcolor: p.color }} />
          <Typography variant="body2" color="text.primary">{p.name}: <b>{num(p.value)}{unit}</b></Typography>
        </Stack>
      ))}
    </Box>
  );
}

function KpiTile({ t }) {
  const navigate = useNavigate();
  const s = STATUS[t.status] || STATUS.grey;
  const delta = t.actual != null && t.previous != null ? Math.round((t.actual - t.previous) * 10) / 10 : null;
  const better = delta == null || delta === 0 ? null : (delta > 0) === (t.direction === 'higher');
  const spark = t.trend.filter((p) => p.value != null).concat(t.actual != null ? [{ date: 'Today', value: t.actual }] : []);
  return (
    <Card sx={{ height: '100%', transition: 'box-shadow .2s, transform .2s, border-color .2s', '&:hover': { boxShadow: SHADOW.lg, transform: 'translateY(-2px)', borderColor: GREY[300] } }}>
      <CardActionArea onClick={() => t.link && navigate(t.link)} sx={{ p: { xs: 1.75, sm: 2.25 }, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ fontSize: { xs: 13, sm: 14 }, lineHeight: 1.3 }}>{t.name}</Typography>
          <MuiTooltip title={`${t.formula || ''}${t.responsibility ? ` · Owner: ${t.responsibility}` : ''}`}><InfoOutlined sx={{ fontSize: 16, color: 'grey.400' }} /></MuiTooltip>
        </Stack>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={1} rowGap={0.25} sx={{ mt: 0.75 }}>
          <Typography sx={{ fontFamily: (th) => th.typography.h4.fontFamily, fontSize: { xs: 26, sm: 32 }, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }}>{fmt(t, t.actual)}</Typography>
          {delta != null && delta !== 0 && (
            <Stack direction="row" alignItems="center" sx={{ px: 0.75, py: 0.25, borderRadius: 99, bgcolor: better ? 'success.soft' : 'error.soft', color: better ? 'success.ink' : 'error.ink' }}>
              {delta > 0 ? <ArrowUpward sx={{ fontSize: 13 }} /> : <ArrowDownward sx={{ fontSize: 13 }} />}
              <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1.4 }}>{Math.abs(delta)}{t.unit === '%' ? ' pts' : ''}</Typography>
            </Stack>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">Target {t.direction === 'lower' ? '≤' : '≥'} {fmt(t, t.target)}{delta != null ? ' · vs yesterday' : ''}</Typography>
        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" spacing={1} sx={{ mt: 'auto', pt: 1.75 }}>
          <Chip size="small" color={s.chip} icon={<s.icon sx={{ fontSize: '15px !important' }} />} label={s.text} variant={s.chip === 'default' ? 'outlined' : 'filled'} sx={{ borderRadius: '8px' }} />
          {spark.length > 2 && (
            <Box sx={{ width: 100, height: 34, display: { xs: 'none', sm: 'block' } }} aria-hidden>
              <ResponsiveContainer>
                <AreaChart data={spark} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                  <defs><linearGradient id={`spark-${t.code}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.single} stopOpacity={0.22} /><stop offset="100%" stopColor={CHART.single} stopOpacity={0} /></linearGradient></defs>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Area type="monotone" dataKey="value" stroke={CHART.single} strokeWidth={2} fill={`url(#spark-${t.code})`} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  );
}

function Portfolio() {
  const q = useQuery({ queryKey: ['kpis', 'portfolio'], queryFn: () => api.get('/dashboard/portfolio') });
  return (
    <SectionCard title="Portfolio" subtitle="Every property you have access to" sx={{ mb: 2.5 }} noPad>
      <QueryState q={q}>
        {(rows) => (
          <Box sx={{ overflowX: 'auto' }}>
            <StackTable>
              <TableHead><TableRow><TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Property</TableCell>{rows[0]?.tiles.map((t) => <TableCell key={t.code} align="center" sx={{ fontWeight: 700, minWidth: 84, lineHeight: 1.3 }}>{t.name}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p._id}>
                    <TableCell><Typography fontWeight={700} noWrap>{p.name}</Typography><Typography variant="caption" color="text.secondary" noWrap component="div">{p.city} · {num(p.areaSqft)} sq.ft.</Typography></TableCell>
                    {p.tiles.map((t) => {
                      const s = STATUS[t.status] || STATUS.grey;
                      return <TableCell key={t.code} align="center"><Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center"><s.icon sx={{ fontSize: 14, color: s.color }} /><span>{fmt(t, t.actual)}</span></Stack></TableCell>;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </StackTable>
          </Box>
        )}
      </QueryState>
    </SectionCard>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const propertyId = useAuth((s) => s.propertyId);
  const property = user.properties?.find((p) => p._id === propertyId) || user.properties?.[0];
  const kpis = useQuery({ queryKey: ['kpis'], queryFn: () => api.get('/dashboard/kpis'), refetchInterval: 60000 });
  const td = useQuery({ queryKey: ['ticket-dashboard'], queryFn: () => api.get('/tickets/dashboard'), enabled: can(user, 'ticket:read') });
  const att = useQuery({ queryKey: ['attendance', 'summary'], queryFn: () => api.get('/attendance/today-summary'), enabled: can(user, 'attendance:read') });
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Box>
      <PageHeader
        title={`${greet}, ${user.name.split(' ')[0]}`}
        subtitle={<Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} alignItems="center" component="span"><span style={{ whiteSpace: 'nowrap' }}>{property?.name} · {fmtDate(new Date())}</span><Chip size="small" color="success" label={kpis.data ? `Live · updated ${fmtTime(kpis.data.updatedAt)}` : 'Live'} icon={<Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor', animation: 'pulse 1.6s infinite', '@keyframes pulse': { '50%': { opacity: 0.3 } } }} />} /></Stack>}
        help="The eight KPIs agreed with the client. Green is on target, amber needs attention, red is off target. Click any tile to see the records behind it."
      />
      {hasRole(user, 'owner', 'super_admin') && <Portfolio />}

      <QueryState q={kpis}>
        {(d) => (
          <Grid container spacing={{ xs: 1.5, sm: 2 }} sx={{ mb: 2.5 }}>
            {d.tiles.map((t) => <Grid item xs={6} lg={3} key={t.code}><KpiTile t={t} /></Grid>)}
          </Grid>
        )}
      </QueryState>

      {td.data && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={8}>
            <SectionCard title="Tickets raised vs closed" subtitle="Last 14 days">
              <Box sx={{ height: 260 }} role="img" aria-label="Line chart of tickets raised and closed per day">
                <ResponsiveContainer>
                  <LineChart data={td.data.trend.map((r) => ({ ...r, day: r.date.slice(8, 10) + '-' + r.date.slice(5, 7) }))} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="day" {...AXIS} />
                    <YAxis allowDecimals={false} {...AXIS} />
                    <Tooltip content={<TipBox />} cursor={{ stroke: GREY[300], strokeDasharray: '3 3' }} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 13, color: GREY[600] }} />
                    <Line type="monotone" dataKey="raised" name="Raised" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                    <Line type="monotone" dataKey="closed" name="Closed" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </SectionCard>
          </Grid>
          <Grid item xs={12} lg={4}>
            <SectionCard title="Open tickets by category" subtitle={`${td.data.open} open · ${td.data.critical} critical`}>
              {td.data.byCategory.length ? (
                <Box sx={{ height: 260 }} role="img" aria-label="Bar chart of open tickets by category">
                  <ResponsiveContainer>
                    <BarChart data={td.data.byCategory} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                      <XAxis type="number" hide allowDecimals={false} domain={[0, (max) => Math.ceil(max * 1.2)]} />
                      <YAxis type="category" dataKey="name" width={90} {...AXIS} />
                      <Tooltip content={<TipBox />} cursor={{ fill: CHART.cursor }} />
                      <Bar dataKey="count" name="Open" fill={CHART.single} barSize={14} radius={[0, 6, 6, 0]} label={{ position: 'right', fill: GREY[800], fontSize: 12, fontWeight: 600 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              ) : <EmptyState title="No open tickets" />}
            </SectionCard>
          </Grid>
          <Grid item xs={12} md={6} lg={4}>
            <SectionCard title="How long tickets have been open" subtitle="Ageing of open tickets">
              <Box sx={{ height: 220 }} role="img" aria-label="Bar chart of open tickets by age">
                <ResponsiveContainer>
                  <BarChart data={td.data.ageing} margin={{ top: 16, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="bucket" {...AXIS} />
                    <YAxis allowDecimals={false} {...AXIS} />
                    <Tooltip content={<TipBox />} cursor={{ fill: CHART.cursor }} />
                    <Bar dataKey="count" name="Tickets" fill={CHART.single} barSize={28} radius={[6, 6, 0, 0]} label={{ position: 'top', fill: GREY[800], fontSize: 12, fontWeight: 600 }} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </SectionCard>
          </Grid>
          <Grid item xs={12} md={6} lg={4}>
            <SectionCard title="SLA compliance by priority" subtitle={`Last 30 days · overall ${td.data.slaCompliance}%`}>
              <Stack spacing={1.75} sx={{ pt: 1 }}>
                {td.data.byPriority.map((p) => {
                  const pct = p.total ? Math.round((p.compliant / p.total) * 100) : null;
                  return (
                    <Box key={p.priority}>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={600}>{p.priority}</Typography><Typography variant="body2" color="text.secondary">{pct == null ? 'No tickets' : `${pct}% · ${p.compliant}/${p.total}`}</Typography></Stack>
                      <LinearProgress variant="determinate" value={pct ?? 0} color={pct == null ? 'inherit' : pct >= 95 ? 'success' : pct >= 90 ? 'warning' : 'error'} sx={{ mt: 0.75 }} />
                    </Box>
                  );
                })}
              </Stack>
            </SectionCard>
          </Grid>
          {att.data && (
            <Grid item xs={12} lg={4}>
              <SectionCard title="Attendance today by department" subtitle={`${att.data.present} of ${att.data.planned} present (${att.data.pct}%)`}>
                <Stack spacing={1.5} sx={{ pt: 1 }}>
                  {att.data.byDepartment.sort((a, b) => b.planned - a.planned).map((d) => {
                    const pct = d.planned ? Math.round((d.present / d.planned) * 100) : 0;
                    return (
                      <Box key={d.name}>
                        <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={600}>{d.name}</Typography><Typography variant="body2" color="text.secondary">{d.present}/{d.planned}</Typography></Stack>
                        <LinearProgress variant="determinate" value={pct} color="secondary" sx={{ mt: 0.75 }} />
                      </Box>
                    );
                  })}
                </Stack>
              </SectionCard>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}
