import ExcelJS from 'exceljs';

const HIDDEN = /(^|\.)(_id|__v|isDeleted|deletedAt|deletedBy|orgId|propertyId|passwordHash|history|comments|signature|approvals|checklist|photos|beforePhotos|afterPhotos)$/;

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (HIDDEN.test(key)) continue;
    if (v instanceof Date) out[key] = v;
    else if (Array.isArray(v)) out[key] = v.map((x) => (x && typeof x === 'object' ? x.name || x.code || x.label || '' : x)).filter(Boolean).join(', ');
    else if (v && typeof v === 'object' && !v._bsontype) {
      if (v.name || v.code || v.number) out[key] = [v.code, v.name || v.number].filter(Boolean).join(' – ');
      else flatten(v, key, out);
    } else out[key] = v?._bsontype ? String(v) : v;
  }
  return out;
}

const header = (k) => k.replace(/Id$/, '').replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export function toSheet(rows, columns) {
  const flat = rows.map((r) => flatten(r));
  const cols = columns || [...new Set(flat.slice(0, 50).flatMap(Object.keys))].slice(0, 40).map((key) => ({ key, header: header(key) }));
  return { cols, flat };
}

export async function sendXlsx(res, name, cols, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PrimeSpace IPFM';
  const ws = wb.addWorksheet('Data');
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width || Math.max(12, c.header.length + 4) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16233A' } };
  rows.forEach((r) => ws.addRow(r));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

export async function readSheet(buffer, filename = '') {
  const wb = new ExcelJS.Workbook();
  if (filename.toLowerCase().endsWith('.csv')) {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from(buffer.toString('utf8')));
  } else await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell((cell, i) => { headers[i] = String(cell.value ?? '').trim(); });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    row.eachCell((cell, i) => {
      if (!headers[i]) return;
      const v = cell.value;
      o[headers[i]] = v && typeof v === 'object' && !(v instanceof Date) ? v.text ?? v.result ?? String(v) : v;
    });
    if (Object.keys(o).length) rows.push(o);
  });
  return rows;
}
