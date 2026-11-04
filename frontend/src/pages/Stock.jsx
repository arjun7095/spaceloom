import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Card, Chip, Drawer, FormControlLabel, Grid, IconButton, InputAdornment, LinearProgress, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import Search from '@mui/icons-material/Search';
import Close from '@mui/icons-material/Close';
import { api } from '../api/client';
import { useAction, useDebounced, useMobile, usePerm } from '../hooks';
import { DataTable } from '../components/DataTable';
import { PageHeader, StatusChip, StackTable } from '../components/common';
import { fmtDateTime, inr, label, num } from '../utils/format';

const CATS = ['electrical_spares', 'hvac_filters', 'plumbing', 'chemicals', 'ppe', 'housekeeping', 'general'];

function ItemDrawer({ row, stores, onClose }) {
  const { can } = usePerm();
  const mobile = useMobile();
  const [adj, setAdj] = useState({ qty: '', reason: '' });
  const [tr, setTr] = useState({ toStoreId: '', qty: '' });
  const ledger = useQuery({ queryKey: ['stock', 'ledger', row._id], queryFn: () => api.get('/stock/ledger', { itemId: row.itemId._id, storeId: row.storeId._id }) });
  const adjust = useAction((b) => api.post('/stock/adjust', b), { success: 'Stock adjusted', invalidate: ['stock', 'kpis'], onSuccess: () => setAdj({ qty: '', reason: '' }) });
  const transfer = useAction((b) => api.post('/stock/transfer', b), { success: 'Transferred', invalidate: ['stock'], onSuccess: () => setTr({ toStoreId: '', qty: '' }) });
  const item = row.itemId;
  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: mobile ? '100%' : 600 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box><Typography variant="overline" color="text.secondary">{item.code} · {row.storeId.name}</Typography><Typography variant="h6">{item.name}</Typography></Box>
        <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
      </Stack>
      <Box sx={{ p: 3, overflowY: 'auto' }}>
        <Grid container spacing={1.5} sx={{ mb: 3 }}>
          {[['In stock', `${row.qty} ${item.uom}`], ['Reorder at', item.reorderLevel], ['Value', inr(row.qty * item.unitCost)]].map(([k, v]) => <Grid item xs={4} key={k}><Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}><Typography variant="caption" color="text.secondary">{k}</Typography><Typography variant="h6">{v}</Typography></Box></Grid>)}
        </Grid>
        {can('inventory:update') && (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Adjust (+/−)</Typography>
              <Stack spacing={1}>
                <TextField type="number" label="Quantity (+ add, − remove)" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} />
                <TextField label="Reason" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                <Button variant="outlined" disabled={!Number(adj.qty) || adj.reason.length < 3} onClick={() => adjust.mutate({ storeId: row.storeId._id, itemId: item._id, qty: Number(adj.qty), reason: adj.reason })}>Post adjustment</Button>
              </Stack>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Transfer to another store</Typography>
              <Stack spacing={1}>
                <TextField select label="To store" value={tr.toStoreId} onChange={(e) => setTr({ ...tr, toStoreId: e.target.value })}>{stores.filter((s) => s._id !== row.storeId._id).map((s) => <MenuItem key={s._id} value={s._id}>{s.name}</MenuItem>)}</TextField>
                <TextField type="number" label="Quantity" value={tr.qty} onChange={(e) => setTr({ ...tr, qty: e.target.value })} />
                <Button variant="outlined" disabled={!tr.toStoreId || !(Number(tr.qty) > 0)} onClick={() => transfer.mutate({ fromStoreId: row.storeId._id, toStoreId: tr.toStoreId, itemId: item._id, qty: Number(tr.qty) })}>Transfer</Button>
              </Stack>
            </Grid>
          </Grid>
        )}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Stock ledger</Typography>
        <Typography variant="caption" color="text.secondary">Every movement with the balance after it. Stock is never edited directly.</Typography>
        <StackTable sx={{ mt: 1 }}>
          <TableHead><TableRow>{['When', 'Movement', 'Qty', 'Balance', 'Ref'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {(ledger.data || []).map((l) => (
              <TableRow key={l._id}>
                <TableCell>{fmtDateTime(l.at)}</TableCell><TableCell>{label(l.type)}</TableCell>
                <TableCell sx={{ color: l.qty < 0 ? 'error.main' : 'success.main', fontWeight: 700 }}>{l.qty > 0 ? `+${l.qty}` : l.qty}</TableCell>
                <TableCell>{l.balanceAfter}</TableCell><TableCell>{l.refNumber || l.note || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </StackTable>
      </Box>
    </Drawer>
  );
}

export default function Stock() {
  const navigate = useNavigate();
  const { can } = usePerm();
  const [sp, setSp] = useSearchParams();
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState(sp.get('search') || '');
  const [row, setRow] = useState(null);
  const ds = useDebounced(search);
  const alerts = sp.get('view') === 'alerts';
  const stores = useQuery({ queryKey: ['ref', 'stores-all'], queryFn: () => api.list('/stores', { limit: 20 }).then((r) => r.data) });
  const low = useQuery({ queryKey: ['stock', 'alerts'], queryFn: () => api.get('/stock/alerts') });
  const pr = useAction(() => api.post('/purchase-requests/from-alerts'), { success: (r) => `${r.number} drafted with ${r.items.length} item(s)`, onSuccess: () => navigate('/procurement/requests?filter[status]=draft') });
  const params = { ...(storeId && { storeId }), ...(category && { category }), ...(ds && { search: ds }), ...(alerts && { view: 'alerts' }) };
  const columns = useMemo(() => [
    { field: 'code', headerName: 'Code', minWidth: 100, flex: 0.6, sortable: false, valueGetter: (v, r) => r.itemId.code },
    { field: 'name', headerName: 'Item', minWidth: 220, flex: 1.6, sortable: false, valueGetter: (v, r) => r.itemId.name, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography> },
    { field: 'category', headerName: 'Category', minWidth: 130, flex: 0.9, sortable: false, valueGetter: (v, r) => label(r.itemId.category) },
    { field: 'store', headerName: 'Store', minWidth: 130, flex: 0.8, sortable: false, valueGetter: (v, r) => r.storeId?.name },
    { field: 'qty', headerName: 'In stock', minWidth: 170, flex: 1, sortable: false, renderCell: (p) => { const max = p.row.itemId.maxLevel || p.row.qty || 1; const lowNow = p.row.qty <= (p.row.itemId.reorderLevel ?? -1); return <Box sx={{ width: '100%' }}><Typography variant="body2" fontWeight={700}>{num(p.row.qty)} {p.row.itemId.uom}</Typography><LinearProgress variant="determinate" value={Math.min(100, (p.row.qty / max) * 100)} color={lowNow ? 'warning' : 'secondary'} sx={{ height: 5 }} /></Box>; } },
    { field: 'reorder', headerName: 'Reorder at', minWidth: 100, flex: 0.6, sortable: false, valueGetter: (v, r) => r.itemId.reorderLevel },
    { field: 'state', headerName: 'Status', minWidth: 110, flex: 0.6, sortable: false, renderCell: (p) => (p.row.qty <= (p.row.itemId.reorderLevel ?? -1) ? <StatusChip value="late" label="Reorder" color="warning" /> : <StatusChip value="active" label="OK" />) },
    { field: 'value', headerName: 'Value', minWidth: 110, flex: 0.7, sortable: false, valueGetter: (v, r) => inr(r.qty * (r.itemId.unitCost || 0)) },
  ], []);

  return (
    <Box>
      <PageHeader title="Stock" subtitle="Balances in every store. Click an item to see its ledger, adjust or transfer." help="Stock only changes through ledger movements: goods receipts, issues, returns, transfers, adjustments and count variances. Balances can never go negative."
        actions={<>
          <Button onClick={() => navigate('/inventory/issues')}>Material issues</Button>
          {can('procurement:create') && <Button variant="contained" color="secondary" disabled={pr.isPending || !low.data?.low?.length} onClick={() => pr.mutate()}>Draft PR from alerts</Button>}
        </>} />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={3}><Card sx={{ p: 2 }}><Typography variant="body2" color="text.secondary" fontWeight={600}>Below reorder level</Typography><Typography sx={{ fontSize: 28, fontWeight: 800, color: low.data?.low?.length ? 'warning.main' : undefined }}>{low.data?.low?.length ?? '…'}</Typography></Card></Grid>
        <Grid item xs={6} md={3}><Card sx={{ p: 2 }}><Typography variant="body2" color="text.secondary" fontWeight={600}>Chemical batches expiring (30 days)</Typography><Typography sx={{ fontSize: 28, fontWeight: 800 }}>{low.data?.expiring?.length ?? '…'}</Typography></Card></Grid>
        <Grid item xs={12} md={6}>
          {low.data?.expiring?.length > 0 && <Card sx={{ p: 2, height: '100%' }}><Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>Expiring soon</Typography>{low.data.expiring.slice(0, 3).map((e) => <Typography key={`${e.item?._id}${e.batchNo}`} variant="body2" color="text.secondary">{e.item?.name} · batch {e.batchNo} · {e.qty} {e.item?.uom} · expires {fmtDateTime(e.expiry).slice(0, 10)}</Typography>)}</Card>}
        </Grid>
      </Grid>
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label="All stores" clickable color={!storeId ? 'secondary' : 'default'} variant={!storeId ? 'filled' : 'outlined'} onClick={() => setStoreId('')} />
            {(stores.data || []).map((s) => <Chip key={s._id} label={s.name} clickable color={storeId === s._id ? 'secondary' : 'default'} variant={storeId === s._id ? 'filled' : 'outlined'} onClick={() => setStoreId(s._id)} />)}
          </Stack>
          <TextField select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ maxWidth: 200 }}><MenuItem value="">All</MenuItem>{CATS.map((c) => <MenuItem key={c} value={c}>{label(c)}</MenuItem>)}</TextField>
          <FormControlLabel control={<Switch color="warning" checked={alerts} onChange={(e) => setSp(e.target.checked ? { view: 'alerts' } : {})} />} label="Only reorder alerts" />
          <Box sx={{ flex: 1 }} />
          <TextField placeholder="Search item or code…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ maxWidth: { md: 280 } }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
        </Stack>
        <DataTable url="/stock" qk="stock" columns={columns} params={params} onRowClick={setRow} pageSize={25} rowHeight={58} emptyTitle={alerts ? 'No items below reorder level' : 'No stock found'} />
      </Card>
      {row && <ItemDrawer row={row} stores={stores.data || []} onClose={() => setRow(null)} />}
    </Box>
  );
}
