import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import { api, download, uploadForm } from '../../api/client';
import { useAction } from '../../hooks';
import { buildColumns, DataTable } from '../../components/DataTable';
import { EmptyState, PageHeader, QueryState, SectionCard, useDialogs, StackTable } from '../../components/common';
import { RefSelect } from '../../components/form';
import { fmtDate, fmtTime, label } from '../../utils/format';

const Stat = ({ label: l, value, color = 'text.primary', hint }) => (
  <Card sx={{ p: 2, height: '100%' }}>
    <Typography variant="body2" color="text.secondary" fontWeight={600}>{l}</Typography>
    <Typography sx={{ fontSize: 30, fontWeight: 800, color }}>{value}</Typography>
    {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
  </Card>
);

function ManualDialog({ onClose }) {
  const [emp, setEmp] = useState(null);
  const [reason, setReason] = useState('');
  const [time, setTime] = useState(dayjs().format('YYYY-MM-DDTHH:mm'));
  const go = useAction((b) => api.post('/attendance/check-in', b), { success: 'Attendance marked', invalidate: ['attendance', 'kpis'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Mark attendance manually</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">For staff whose device punch failed. A reason is required and the entry is audited.</Typography>
        <RefSelect refTo="employees" label="Employee" value={emp} onChange={setEmp} required />
        <TextField type="datetime-local" label="Check-in time" InputLabelProps={{ shrink: true }} value={time} onChange={(e) => setTime(e.target.value)} />
        <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        {go.error && <Alert severity="error">{go.error.message}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={!emp || reason.length < 3} onClick={() => go.mutate({ employeeId: emp, reason, time: new Date(time).toISOString() })}>Save</Button></DialogActions>
    </Dialog>
  );
}

function RegulariseDialog({ row, onClose }) {
  const [inT, setIn] = useState(row.checkIn?.time ? dayjs(row.checkIn.time).format('YYYY-MM-DDTHH:mm') : `${row.date}T${row.shiftId?.start || '09:00'}`);
  const [outT, setOut] = useState(row.checkOut?.time ? dayjs(row.checkOut.time).format('YYYY-MM-DDTHH:mm') : `${row.date}T${row.shiftId?.end || '18:00'}`);
  const [reason, setReason] = useState('');
  const go = useAction((b) => api.post(`/attendance/${row._id}/resolve`, b), { success: 'Attendance corrected', invalidate: ['attendance', 'kpis'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Correct times · {row.employeeId?.name}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField type="datetime-local" label="Check-in" InputLabelProps={{ shrink: true }} value={inT} onChange={(e) => setIn(e.target.value)} />
        <TextField type="datetime-local" label="Check-out" InputLabelProps={{ shrink: true }} value={outT} onChange={(e) => setOut(e.target.value)} />
        <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Stack></DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={reason.length < 3} onClick={() => go.mutate({ action: 'regularise', checkIn: new Date(inT).toISOString(), checkOut: new Date(outT).toISOString(), reason })}>Save</Button></DialogActions>
    </Dialog>
  );
}

function Exceptions() {
  const { prompt } = useDialogs();
  const [reg, setReg] = useState(null);
  const q = useQuery({ queryKey: ['attendance', 'exceptions'], queryFn: () => api.get('/attendance/exceptions') });
  const resolve = useAction(({ id, action, reason }) => api.post(`/attendance/${id}/resolve`, { action, reason }), { success: 'Done', invalidate: ['attendance', 'kpis'] });
  const ask = async (row, action) => {
    const reason = await prompt({ title: action === 'approve' ? 'Accept this exception' : 'Mark as absent', label: 'Reason' });
    if (reason) resolve.mutate({ id: row._id, action, reason });
  };
  return (
    <QueryState q={q} empty={<EmptyState title="No exceptions to review" text="Late arrivals, early exits, missed punches and outside-fence check-ins from the last 7 days appear here." />}>
      {(rows) => (
        <Box sx={{ overflowX: 'auto' }}>
          <StackTable>
            <TableHead><TableRow>{['Date', 'Employee', 'Department', 'Shift', 'In / out', 'Exception', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r._id} hover>
                  <TableCell>{fmtDate(r.date)}</TableCell>
                  <TableCell><b>{r.employeeId?.name}</b><Typography variant="caption" display="block" color="text.secondary">{r.employeeId?.code}</Typography></TableCell>
                  <TableCell>{r.departmentId?.name}</TableCell>
                  <TableCell>{r.shiftId ? `${r.shiftId.name} ${r.shiftId.start}–${r.shiftId.end}` : '—'}</TableCell>
                  <TableCell>{r.checkIn?.time ? fmtTime(r.checkIn.time) : '—'} / {r.checkOut?.time ? fmtTime(r.checkOut.time) : '—'}</TableCell>
                  <TableCell>{r.exceptions.map((e) => <Chip key={e} size="small" color={e === 'absent' ? 'error' : 'warning'} label={label(e)} sx={{ mr: 0.5 }} />)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => ask(r, 'approve')}>Accept</Button>
                    <Button size="small" onClick={() => setReg(r)}>Correct times</Button>
                    {r.status !== 'absent' && <Button size="small" color="error" onClick={() => ask(r, 'mark_absent')}>Absent</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </StackTable>
          {reg && <RegulariseDialog row={reg} onClose={() => setReg(null)} />}
        </Box>
      )}
    </QueryState>
  );
}

function Payroll() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const file = useRef();
  const send = useAction(() => api.post('/attendance/payroll-webhook', { month }), { success: (r) => `${r.sent} employees sent to payroll; month locked` });
  const imp = useAction((f) => uploadForm('/attendance/import', f), { success: (r) => `${r.accepted} punches imported${r.unknown.length ? `, ${r.unknown.length} unknown codes` : ''}`, invalidate: ['attendance'] });
  return (
    <Grid container spacing={2} sx={{ p: 2 }}>
      <Grid item xs={12} md={6}>
        <SectionCard title="Monthly payroll export" subtitle="Present days, leave, OT hours and late marks per employee">
          <Stack spacing={2}>
            <TextField type="month" label="Month" InputLabelProps={{ shrink: true }} value={month} onChange={(e) => setMonth(e.target.value)} sx={{ maxWidth: 220 }} />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" color="secondary" startIcon={<FileDownloadOutlined />} onClick={() => download('/attendance/payroll-export', { month }, `payroll-${month}.xlsx`)}>Download Excel</Button>
              <Button variant="outlined" disabled={send.isPending} onClick={() => send.mutate()}>Send to payroll system</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">Sending uses the payroll webhook in Setup → Properties and locks the month.</Typography>
          </Stack>
        </SectionCard>
      </Grid>
      <Grid item xs={12} md={6}>
        <SectionCard title="Import device punches" subtitle="Fallback when a biometric or face device cannot call the API">
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">Upload a CSV or Excel file with the columns <b>employeeCode</b>, <b>timestamp</b> and <b>deviceId</b>. The first punch of a shift is the check-in, the next is the check-out.</Typography>
            <Button variant="outlined" startIcon={<UploadFileOutlined />} disabled={imp.isPending} onClick={() => file.current.click()}>Choose file</Button>
            <input ref={file} type="file" hidden accept=".csv,.xlsx" onChange={(e) => { if (e.target.files[0]) imp.mutate(e.target.files[0]); e.target.value = ''; }} />
          </Stack>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

export default function Attendance() {
  const [tab, setTab] = useState(0);
  const [manual, setManual] = useState(false);
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const summary = useQuery({ queryKey: ['attendance', 'summary'], queryFn: () => api.get('/attendance/today-summary'), refetchInterval: 60000 });
  const columns = useMemo(() => buildColumns(['date', 'employeeId.name|Employee|strong', 'departmentId.name|Department', 'shiftId.name|Shift', 'checkIn.time|In|datetime', 'checkOut.time|Out|datetime', 'status||status', { field: 'exceptions', headerName: 'Exceptions', flex: 1, sortable: false, renderCell: (p) => (p.value || []).map((e) => <Chip key={e} size="small" color="warning" variant="outlined" label={label(e)} sx={{ mr: 0.5 }} />) }]), []);
  return (
    <Box>
      <PageHeader title="Attendance" subtitle="Who is on site, exceptions to approve, and the monthly payroll export." help="Planned = people rostered for a shift that has already started today. Exceptions are detected automatically: late beyond grace, early exit, missed punch, absent, outside the geo-fence, short hours."
        actions={<Button variant="contained" color="secondary" onClick={() => setManual(true)}>Mark attendance</Button>} />
      <QueryState q={summary}>
        {(s) => (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} md={2.4}><Stat label="Planned now" value={s.planned} hint={`${s.rostered} rostered today`} /></Grid>
            <Grid item xs={6} md={2.4}><Stat label="Present" value={s.present} color="success.main" /></Grid>
            <Grid item xs={6} md={2.4}><Stat label="Not in" value={s.absent} color={s.absent ? 'error.main' : undefined} /></Grid>
            <Grid item xs={6} md={2.4}><Stat label="Attendance" value={`${s.pct}%`} hint="Target 95%" /></Grid>
            <Grid item xs={12} md={2.4}><Stat label="Exceptions today" value={s.exceptions} color={s.exceptions ? 'warning.main' : undefined} hint={`${s.onLeave} on leave`} /></Grid>
          </Grid>
        )}
      </QueryState>
      <Card>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} textColor="secondary" indicatorColor="secondary" sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }} variant="scrollable">
          <Tab label="By department" /><Tab label="Exceptions" /><Tab label="Register" /><Tab label="Payroll & devices" />
        </Tabs>
        {tab === 0 && summary.data && (
          <Grid container spacing={2} sx={{ p: 2 }}>
            {[['By department', summary.data.byDepartment], ['By shift', summary.data.byShift]].map(([title, rows]) => (
              <Grid item xs={12} md={6} key={title}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
                <Table size="small">
                  <TableHead><TableRow><TableCell sx={{ fontWeight: 700 }}>Name</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>Planned</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>Present</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>%</TableCell></TableRow></TableHead>
                  <TableBody>{rows.map((r) => <TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell align="right">{r.planned}</TableCell><TableCell align="right">{r.present}</TableCell><TableCell align="right">{r.planned ? Math.round((r.present / r.planned) * 100) : 0}%</TableCell></TableRow>)}</TableBody>
                </Table>
              </Grid>
            ))}
          </Grid>
        )}
        {tab === 1 && <Exceptions />}
        {tab === 2 && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
              <TextField type="date" label="Date" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} sx={{ maxWidth: 200 }} />
              <Button startIcon={<FileDownloadOutlined />} onClick={() => download('/attendance', { date, format: 'xlsx' }, `attendance-${date}.xlsx`)}>Export day</Button>
            </Stack>
            <DataTable url="/attendance" qk="attendance" columns={columns} params={{ date }} pageSize={50} />
          </Box>
        )}
        {tab === 3 && <Payroll />}
      </Card>
      {manual && <ManualDialog onClose={() => setManual(false)} />}
    </Box>
  );
}
