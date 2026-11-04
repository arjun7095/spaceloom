import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DataGrid } from '@mui/x-data-grid';
import { Box, Button, Chip, LinearProgress, Stack, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { api } from '../api/client';
import { EmptyState, PriorityChip, StatusChip, SlaTimer } from './common';
import { fmtDate, fmtDateTime, getPath, humanize, inr, refLabel, fromNow } from '../utils/format';

// Column spec shorthand: 'path|Header|kind' where kind is status, priority, date, datetime, ago, inr, bool, chips, ref, count, sla.
export function buildColumns(specs) {
  return specs.map((s) => {
    if (typeof s === 'object') return s;
    const [path, header, kind] = s.split('|');
    const col = {
      field: path,
      headerName: header || humanize(path.replace(/\.(name|code|path|number|title)$/, '')),
      flex: 1,
      minWidth: 110,
      sortable: !path.includes('.'),
      kind,
      valueGetter: (v, row) => getPath(row, path),
    };
    switch (kind) {
      case 'status': return { ...col, minWidth: 130, renderCell: (p) => <StatusChip value={p.value} /> };
      case 'priority': return { ...col, minWidth: 110, flex: 0.6, renderCell: (p) => <PriorityChip value={p.value} short /> };
      case 'date': return { ...col, minWidth: 110, valueFormatter: (v) => fmtDate(v) };
      case 'datetime': return { ...col, minWidth: 150, valueFormatter: (v) => fmtDateTime(v) };
      case 'ago': return { ...col, minWidth: 110, valueFormatter: (v) => fromNow(v) };
      case 'inr': return { ...col, type: 'number', valueFormatter: (v) => inr(v) };
      case 'bool': return { ...col, flex: 0.5, valueFormatter: (v) => (v ? 'Yes' : 'No') };
      case 'ref': return { ...col, valueFormatter: (v) => (Array.isArray(v) ? v.map(refLabel).join(', ') : refLabel(v)) };
      case 'chips': return { ...col, renderCell: (p) => [].concat(p.value || []).slice(0, 3).map((x) => <Chip key={String(refLabel(x))} size="small" label={refLabel(x)} sx={{ mr: 0.5 }} />) };
      case 'count': return { ...col, flex: 0.5, valueGetter: (v, row) => (getPath(row, path) || []).length };
      case 'sla': return { ...col, minWidth: 170, sortable: false, renderCell: (p) => <SlaTimer ticket={p.row} compact /> };
      case 'strong': return { ...col, renderCell: (p) => <Typography variant="body2" fontWeight={700} noWrap sx={{ lineHeight: 'inherit' }}>{p.value}</Typography> };
      default: return col;
    }
  });
}

// Renders one cell outside the grid, using the column's own getter, formatter and renderer.
function cell(col, row) {
  const value = col.valueGetter ? col.valueGetter(row[col.field], row, col) : row[col.field];
  const formatted = col.valueFormatter ? col.valueFormatter(value, row, col) : value;
  if (col.renderCell) return col.renderCell({ value, formattedValue: formatted, row, field: col.field, colDef: col, id: row._id });
  if (formatted == null || formatted === '') return '—';
  return typeof formatted === 'object' ? refLabel(formatted) : String(formatted);
}
const isBadge = (c) => ['status', 'priority'].includes(c.kind) || ['status', 'priority'].includes(c.field);

// Phone layout: each record is a tappable row with its title, badges and a few labelled fields.
function RowList({ rows, columns, onRowClick, loading, total, pg, setPg, empty }) {
  const [title, ...rest] = columns.filter((c) => !c.hideOnPhone);
  const badges = rest.filter(isBadge);
  const fields = rest.filter((c) => !isBadge(c)).slice(0, 4);
  const from = pg.page * pg.pageSize;
  if (!rows.length && !loading) return empty;
  return (
    <Box>
      {loading && <LinearProgress color="secondary" sx={{ height: 3, borderRadius: 0 }} />}
      {rows.map((row) => (
        <Box key={row._id} data-row-card role="button" tabIndex={0} onClick={() => onRowClick?.(row)} onKeyDown={(e) => e.key === 'Enter' && onRowClick?.(row)}
          sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', cursor: 'pointer', '&:active, &:hover': { bgcolor: 'grey.50' }, '&:focus-visible': { outline: 'none', bgcolor: 'primary.soft' } }}>
          <Stack direction="row" alignItems="flex-start" spacing={1}>
            <Box sx={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15, '& .MuiTypography-root': { fontSize: 15, lineHeight: 1.35 } }}>{cell(title, row)}</Box>
            {onRowClick && <ChevronRight sx={{ color: 'grey.400', mt: 0.25 }} />}
          </Stack>
          {badges.length > 0 && <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>{badges.map((c) => <Box key={c.field}>{cell(c, row)}</Box>)}</Stack>}
          {fields.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2, rowGap: 0.75, mt: 1 }}>
              {fields.map((c) => (
                <Box key={c.field} sx={{ minWidth: 0, gridColumn: c.kind === 'sla' ? 'span 2' : undefined }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{c.headerName}</Typography>
                  <Box sx={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '& .MuiTypography-root': { fontSize: 13.5 } }}>{cell(c, row)}</Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      ))}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
        <Typography variant="body2" color="text.secondary">{total ? `${from + 1}–${Math.min(from + pg.pageSize, total)} of ${total}` : ''}</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" disabled={pg.page === 0} onClick={() => setPg({ ...pg, page: pg.page - 1 })}>Previous</Button>
          <Button size="small" variant="outlined" disabled={from + pg.pageSize >= total} onClick={() => setPg({ ...pg, page: pg.page + 1 })}>Next</Button>
        </Stack>
      </Stack>
    </Box>
  );
}

export function DataTable({ url, columns, params = {}, onRowClick, qk, emptyTitle, emptyText, emptyAction, rowHeight = 52, pageSize = 20 }) {
  const phone = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [pg, setPg] = useState({ page: 0, pageSize });
  const [sort, setSort] = useState([]);
  const sortStr = sort[0] ? `${sort[0].sort === 'desc' ? '-' : ''}${sort[0].field}` : undefined;
  const q = useQuery({
    queryKey: [qk || url.split('/')[1], url, params, pg, sortStr],
    queryFn: () => api.list(url, { ...params, page: pg.page + 1, limit: pg.pageSize, sort: sortStr }),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <EmptyState title="Couldn't load this list" text={q.error.message} />;
  const empty = <EmptyState title={emptyTitle || 'No records found'} text={emptyText || 'Try another tab or search, or add a new record.'} action={emptyAction} />;
  if (phone) return <RowList rows={q.data?.data || []} columns={columns} onRowClick={onRowClick} loading={q.isFetching} total={q.data?.meta?.total || 0} pg={pg} setPg={setPg} empty={empty} />;
  return (
    <DataGrid
      autoHeight
      rows={q.data?.data || []}
      rowCount={q.data?.meta?.total || 0}
      loading={q.isFetching}
      columns={columns}
      getRowId={(r) => r._id}
      paginationMode="server"
      sortingMode="server"
      paginationModel={pg}
      onPaginationModelChange={setPg}
      sortModel={sort}
      onSortModelChange={setSort}
      pageSizeOptions={[10, 20, 50, 100]}
      onRowClick={(p) => onRowClick?.(p.row)}
      disableRowSelectionOnClick
      disableColumnMenu
      rowHeight={rowHeight}
      slots={{ noRowsOverlay: () => empty }}
      sx={{ '& .MuiDataGrid-overlayWrapper': { minHeight: 260 } }}
    />
  );
}
