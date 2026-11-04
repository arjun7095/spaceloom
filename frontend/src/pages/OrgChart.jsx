import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Box, Button, Card, Chip, Collapse, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import Search from '@mui/icons-material/Search';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import { api } from '../api/client';
import { PageHeader, QueryState } from '../components/common';
import { GRADIENT } from '../theme';

const initials = (n) => n.split(' ').map((x) => x[0]).slice(0, 2).join('');

function Person({ p, compact }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <Avatar sx={{ width: compact ? 30 : 38, height: compact ? 30 : 38, fontSize: compact ? 12 : 14, background: compact ? undefined : GRADIENT, bgcolor: compact ? 'grey.400' : undefined }}>{initials(p.name)}</Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700} noWrap>{p.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">{p.designation}{p.departmentId?.name ? ` · ${p.departmentId.name}` : ''}</Typography>
      </Box>
    </Stack>
  );
}

function Node({ p, kids, depth }) {
  const team = kids.get(String(p._id)) || [];
  const [open, setOpen] = useState(depth < 1);
  const leaders = team.filter((c) => (kids.get(String(c._id)) || []).length);
  const staff = team.filter((c) => !(kids.get(String(c._id)) || []).length);
  return (
    <Box sx={{ pl: depth ? 3 : 0, borderLeft: depth ? '2px solid' : 'none', borderColor: 'divider', ml: depth ? 1.5 : 0, mt: 1.25 }}>
      <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, maxWidth: 560 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}><Person p={p} /></Box>
        {team.length > 0 && <Button size="small" onClick={() => setOpen(!open)} endIcon={open ? <ExpandLess /> : <ExpandMore />}>{team.length} report{team.length > 1 ? 's' : ''}</Button>}
      </Card>
      <Collapse in={open} unmountOnExit>
        {leaders.map((c) => <Node key={c._id} p={c} kids={kids} depth={depth + 1} />)}
        {staff.length > 0 && (
          <Box sx={{ pl: 3, ml: 1.5, borderLeft: '2px solid', borderColor: 'divider', mt: 1.25 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 1, maxWidth: 1100 }}>
              {staff.map((c) => <Card key={c._id} sx={{ p: 1 }}><Person p={c} compact /></Card>)}
            </Box>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}

export default function OrgChart() {
  const q = useQuery({ queryKey: ['employees', 'org-chart'], queryFn: () => api.get('/employees-org-chart/tree') });
  const [search, setSearch] = useState('');
  const { roots, kids, byId } = useMemo(() => {
    const list = q.data || [];
    const ids = new Set(list.map((e) => String(e._id)));
    const k = new Map();
    for (const e of list) {
      const sup = e.supervisorId && ids.has(String(e.supervisorId)) ? String(e.supervisorId) : null;
      if (sup) (k.get(sup) || k.set(sup, []).get(sup)).push(e);
    }
    return { roots: list.filter((e) => !e.supervisorId || !ids.has(String(e.supervisorId))), kids: k, byId: new Map(list.map((e) => [String(e._id), e])) };
  }, [q.data]);
  const matches = search.trim().length >= 2 ? (q.data || []).filter((e) => `${e.name} ${e.designation} ${e.code}`.toLowerCase().includes(search.toLowerCase())).slice(0, 30) : null;
  return (
    <Box>
      <PageHeader title="Org chart" subtitle="Who reports to whom on site: Property Manager → department heads → teams." help="Reporting lines come from each employee's “Reports to” field. Change it on the employee record."
        actions={<TextField placeholder="Find a person…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ width: 260 }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />} />
      <QueryState q={q}>
        {() => (matches ? (
          <Stack spacing={1}>
            {matches.map((e) => (
              <Card key={e._id} sx={{ p: 1.5, maxWidth: 640 }}>
                <Person p={e} />
                {e.supervisorId && byId.get(String(e.supervisorId)) && <Chip size="small" sx={{ mt: 1 }} label={`Reports to ${byId.get(String(e.supervisorId)).name}`} />}
              </Card>
            ))}
            {!matches.length && <Typography color="text.secondary">Nobody matches “{search}”.</Typography>}
          </Stack>
        ) : roots.map((r) => <Node key={r._id} p={r} kids={kids} depth={0} />))}
      </QueryState>
    </Box>
  );
}
