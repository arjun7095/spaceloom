import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { ErrorState, Loading, StatusChip } from '../components/common';
import { Logo } from '../layouts/AppLayout';
import { fmtDate, inr, label } from '../utils/format';

// Print-ready purchase order; the browser's "Save as PDF" produces the PDF.
export default function PoPrint() {
  const { id } = useParams();
  const property = useAuth((s) => s.user?.properties?.find((p) => p._id === s.propertyId) || s.user?.properties?.[0]);
  const q = useQuery({ queryKey: ['purchase-orders', 'print', id], queryFn: () => api.get(`/purchase-orders/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const po = q.data;
  const cell = { fontWeight: 700, bgcolor: 'grey.100' };
  return (
    <Box sx={{ maxWidth: 860, mx: 'auto', p: { xs: 2, md: 5 }, bgcolor: '#fff', minHeight: '100vh' }}>
      <Stack direction="row" justifyContent="flex-end" spacing={1} className="no-print" sx={{ mb: 2 }}>
        <Button variant="contained" color="secondary" startIcon={<PrintOutlined />} onClick={() => window.print()}>Print / Save as PDF</Button>
      </Stack>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box><Logo /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>PrimeSpace Property Services Pvt. Ltd.<br />on behalf of {property?.name}, {property?.city}</Typography></Box>
        <Box textAlign="right"><Typography variant="h5">Purchase Order</Typography><Typography fontWeight={700}>{po.number}</Typography><Typography variant="body2">Date: {fmtDate(po.createdAt)}</Typography><StatusChip value={po.status} sx={{ mt: 0.5 }} /></Box>
      </Stack>
      <Stack direction="row" spacing={4} sx={{ my: 3 }}>
        <Box sx={{ flex: 1 }}><Typography variant="overline" color="text.secondary">Vendor</Typography><Typography fontWeight={700}>{po.vendorId?.name}</Typography><Typography variant="body2">{po.vendorId?.address}</Typography><Typography variant="body2">GSTIN: {po.vendorId?.gstin || '—'}</Typography></Box>
        <Box sx={{ flex: 1 }}><Typography variant="overline" color="text.secondary">Deliver to</Typography><Typography fontWeight={700}>{property?.name}</Typography><Typography variant="body2">Delivery by {fmtDate(po.deliveryDate)}</Typography>{po.prId && <Typography variant="body2">Against {po.prId.number}</Typography>}</Box>
      </Stack>
      <Table size="small" sx={{ '& td, & th': { border: '1px solid #EAECF0' } }}>
        <TableHead><TableRow>{['#', 'Item', 'HSN', 'Qty', 'Rate', 'GST %', 'Amount'].map((h) => <TableCell key={h} sx={cell} align={['Qty', 'Rate', 'GST %', 'Amount'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {po.items.map((l, i) => (
            <TableRow key={i}>
              <TableCell>{i + 1}</TableCell><TableCell>{l.itemId?.code} · {l.itemId?.name}</TableCell><TableCell>{l.itemId?.hsn}</TableCell>
              <TableCell align="right">{l.qty} {l.itemId?.uom}</TableCell><TableCell align="right">{inr(l.rate)}</TableCell><TableCell align="right">{l.gstPct ?? 18}</TableCell><TableCell align="right">{inr(l.qty * l.rate)}</TableCell>
            </TableRow>
          ))}
          <TableRow><TableCell colSpan={6} align="right">Sub-total</TableCell><TableCell align="right">{inr(po.subTotal)}</TableCell></TableRow>
          <TableRow><TableCell colSpan={6} align="right">GST</TableCell><TableCell align="right">{inr(po.gst)}</TableCell></TableRow>
          <TableRow><TableCell colSpan={6} align="right" sx={{ fontWeight: 800 }}>Total</TableCell><TableCell align="right" sx={{ fontWeight: 800 }}>{inr(po.total)}</TableCell></TableRow>
        </TableBody>
      </Table>
      {po.terms && <Box sx={{ mt: 3 }}><Typography variant="overline" color="text.secondary">Terms</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{po.terms}</Typography></Box>}
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 6 }}>
        <Box><Typography variant="overline" color="text.secondary">Approvals</Typography>{(po.approvals || []).map((a, i) => <Typography key={i} variant="body2">{label(a.action)} by {a.byName} ({label(a.level)}) · {fmtDate(a.at)}</Typography>)}</Box>
        <Box textAlign="center" sx={{ pt: 4 }}><Box sx={{ borderTop: '1px solid #101828', width: 220, pt: 0.5 }}><Typography variant="body2">Authorised signatory</Typography></Box></Box>
      </Stack>
    </Box>
  );
}
