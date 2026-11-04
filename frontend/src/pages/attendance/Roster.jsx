import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, Box, Button, Card, Chip, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { api } from '../../api/client';
import { useAction, usePerm } from '../../hooks';
import { Loading, PageHeader, useDialogs } from '../../components/common';

const monday = (d) => d.subtract((d.day() + 6) % 7, 'day');

export default function Roster() {
  const { can } = usePerm();
  const { confirm } = useDialogs();
  const [week, setWeek] = useState(monday(dayjs()));
  const [dept, setDept] = useState('');
  const [edits, setEdits] = useState({});
  const weekStart = week.format('YYYY-MM-DD');
  const depts = useQuery({ queryKey: ['ref', 'departments-all'], queryFn: () => api.list('/departments', { limit: 50 }).then((r) => r.data) });
  useEffect(() => { if (!dept && depts.data?.length) setDept(depts.data.find((d) => d.code === 'ENG')?._id || depts.data[0]._id); }, [depts.data, dept]);
  const q = useQuery({ queryKey: ['roster', weekStart, dept], queryFn: () => api.get('/attendance/roster', { weekStart, departmentId: dept }), enabled: Boolean(dept) });
  useEffect(() => setEdits({}), [weekStart, dept]);
  const editable = can('roster:update');
  const save = useAction(() => api.put('/attendance/roster', { entries: Object.entries(edits).map(([k, v]) => { const [employeeId, date] = k.split('|'); return { employeeId, date, shiftId: v === 'OFF' ? null : v || null, isWeeklyOff: v === 'OFF' }; }) }), { success: 'Roster saved (not yet published)', invalidate: ['roster'], onSuccess: () => setEdits({}) });
  const copy = useAction(() => api.post('/attendance/roster/copy-week', { fromWeekStart: week.subtract(7, 'day').format('YYYY-MM-DD'), toWeekStart: weekStart, departmentId: dept }), { success: (r) => `${r.copied} shifts copied from last week`, invalidate: ['roster'] });
  const publish = useAction(() => api.post('/attendance/roster/publish', { weekStart, departmentId: dept }), { success: 'Published — staff have been notified', invalidate: ['roster'] });
  const d = q.data;
  const shiftById = Object.fromEntries((d?.shifts || []).map((s) => [s._id, s]));
  const cellValue = (empId, date) => {
    const k = `${empId}|${date}`;
    if (k in edits) return edits[k];
    const c = d.cells[empId]?.[date];
    return c?.isWeeklyOff ? 'OFF' : c?.shiftId || '';
  };
  const dirty = Object.keys(edits).length;

  return (
    <Box>
      <PageHeader title="Shift roster" subtitle="Pick a shift for each person and day. Copy last week to save time, then publish so staff see it on their phones." help="Changes are drafts until you publish. Weekly offs show as OFF. Attendance uses the published roster to decide who is late or absent." />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <Stack direction="row" alignItems="center">
            <IconButton onClick={() => setWeek(week.subtract(7, 'day'))} aria-label="Previous week"><ChevronLeft /></IconButton>
            <Typography fontWeight={700} sx={{ minWidth: { xs: 0, sm: 200 }, flex: { xs: 1, sm: 'none' }, textAlign: 'center', whiteSpace: 'nowrap', fontSize: { xs: 14, sm: 16 } }}>{week.format('DD MMM')} – {week.add(6, 'day').format('DD MMM YYYY')}</Typography>
            <IconButton onClick={() => setWeek(week.add(7, 'day'))} aria-label="Next week"><ChevronRight /></IconButton>
            <Button size="small" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setWeek(monday(dayjs()))}>This week</Button>
          </Stack>
          <TextField select label="Department" value={dept} onChange={(e) => setDept(e.target.value)} sx={{ maxWidth: { md: 260 } }}>
            {(depts.data || []).map((x) => <MenuItem key={x._id} value={x._id}>{x.name}</MenuItem>)}
          </TextField>
          <Box sx={{ flex: 1 }} />
          {d && <Chip label={d.published ? 'Published' : 'Draft'} color={d.published ? 'success' : 'warning'} />}
          {editable && <Button variant="outlined" disabled={copy.isPending} onClick={async () => (await confirm({ title: 'Copy last week?', text: 'Shifts from the previous week will overwrite this week for this department.' })) && copy.mutate()}>Copy last week</Button>}
          {editable && <Button variant="outlined" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save{dirty ? ` (${dirty})` : ''}</Button>}
          {editable && <Button variant="contained" color="secondary" disabled={dirty > 0 || publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}
        </Stack>
        {d && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {d.shifts.map((s) => <Chip key={s._id} size="small" label={`${s.code} · ${s.start}–${s.end}`} sx={{ bgcolor: `${s.color || '#999'}22`, color: 'text.primary', borderLeft: `4px solid ${s.color || '#999'}` }} />)}
            <Chip size="small" label="OFF · weekly off" variant="outlined" />
          </Stack>
        )}
      </Card>
      {dirty > 0 && <Alert severity="info" sx={{ mb: 2 }}>You have {dirty} unsaved change{dirty > 1 ? 's' : ''}. Save, then publish.</Alert>}
      {!d ? <Loading /> : (
        <Card sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 880, '& td, & th': { borderBottom: '1px solid', borderColor: 'divider', p: 0.75 }, '& th': { fontSize: 13, color: 'text.secondary', textAlign: 'left', bgcolor: 'grey.50' }, '& td:first-of-type, & th:first-of-type': { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', boxShadow: (t) => `1px 0 0 ${t.palette.divider}`, minWidth: { xs: 130, sm: 180 } }, '& th:first-of-type': { bgcolor: 'grey.50' } }}>
            <thead><tr><th style={{ paddingLeft: 16 }}>Employee</th>{d.days.map((day) => <th key={day}>{dayjs(day).format('ddd DD')}</th>)}</tr></thead>
            <tbody>
              {d.employees.map((e) => (
                <tr key={e._id}>
                  <td style={{ paddingLeft: 16 }}><Typography variant="body2" fontWeight={600}>{e.name}</Typography><Typography variant="caption" color="text.secondary">{e.designation}</Typography></td>
                  {d.days.map((day) => {
                    const v = cellValue(e._id, day);
                    const s = shiftById[v];
                    const changed = `${e._id}|${day}` in edits;
                    return (
                      <td key={day}>
                        <Box component="select" disabled={!editable} value={v} aria-label={`${e.name} ${day}`} onChange={(ev) => setEdits((x) => ({ ...x, [`${e._id}|${day}`]: ev.target.value }))}
                          sx={{ width: '100%', minWidth: 76, p: '6px 4px', borderRadius: 1.5, border: '1px solid', borderColor: changed ? 'secondary.main' : 'divider', bgcolor: v === 'OFF' ? '#F1F3F6' : s ? `${s.color}1F` : '#fff', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: editable ? 'pointer' : 'default' }}>
                          <option value="">—</option>
                          {d.shifts.map((sh) => <option key={sh._id} value={sh._id}>{sh.code}</option>)}
                          <option value="OFF">OFF</option>
                        </Box>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Box>
          {!d.employees.length && <Typography sx={{ p: 3 }} color="text.secondary">No active employees in this department.</Typography>}
        </Card>
      )}
    </Box>
  );
}
