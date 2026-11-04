import PDFDocument from 'pdfkit';

const NAVY = '#16233A';
const INK = '#1B2433';
const GREY = '#5B6576';
const LINE = '#E6E9EF';
const M = 40;

// Standard PDF fonts have no ₹ glyph, so amounts are written as "Rs."
const money = (n) => (n == null ? '-' : `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`);
const dateIN = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-') : '-');
const human = (k = '') => String(k).replace(/Id$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const plain = (v) => String(v ?? '-').replace(/[^\x20-\x7E -ÿ–—•]/g, (c) => ({ '→': '->', '≥': '>=', '≤': '<=', '·': '-', '₹': 'Rs.' }[c] ?? ''));

export function pdfBuffer(build, info = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Producer: 'PrimeSpace IPFM', ...info } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`PrimeSpace IPFM  |  Page ${i + 1} of ${range.count}`, M, doc.page.height - 28, { width: doc.page.width - 2 * M, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

function banner(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 74).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text('PrimeSpace', M, 22, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#7FE3E1').text('IPFM  |  shaping modern spaces.', M, 46, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#FFFFFF').text(plain(title), 220, 20, { width: doc.page.width - 220 - M, align: 'right' });
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor('#D7DEE8').text(plain(subtitle), 220, 42, { width: doc.page.width - 220 - M, align: 'right' });
  doc.fillColor(INK).font('Helvetica');
  doc.x = M;
  doc.y = 96;
}

function heading(doc, text) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(plain(text), M, doc.y);
  doc.moveDown(0.3);
  doc.font('Helvetica').fillColor(INK);
}

function paragraph(doc, text, size = 9.5) {
  doc.font('Helvetica').fontSize(size).fillColor(INK).text(plain(text), M, doc.y, { width: doc.page.width - 2 * M });
  doc.moveDown(0.4);
}

// cols: [{ header, width (fraction), align }], rows: arrays of cell values
function table(doc, cols, rows) {
  const total = doc.page.width - 2 * M;
  const widths = cols.map((c) => c.width * total);
  const draw = (cells, head) => {
    doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(plain(c), { width: widths[i] - 8 }))) + 8;
    if (doc.y + h > doc.page.height - 50) {
      doc.addPage();
      doc.y = M;
      if (!head) draw(cols.map((c) => c.header), true);
      doc.font('Helvetica').fontSize(8.5);
    }
    const y = doc.y;
    if (head) doc.rect(M, y, total, h).fill('#F4F6F9');
    let x = M;
    cells.forEach((c, i) => {
      doc.fillColor(INK).font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(plain(c), x + 4, y + 4, { width: widths[i] - 8, align: cols[i].align || 'left' });
      x += widths[i];
    });
    doc.moveTo(M, y + h).lineTo(M + total, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + h;
  };
  draw(cols.map((c) => c.header), true);
  rows.forEach((r) => draw(r, false));
  doc.x = M;
  doc.moveDown(0.6);
}

const cell = (key, v) => {
  if (v == null || v === '') return '-';
  if (v instanceof Date || (/date|end|At$/.test(key) && !Number.isNaN(Date.parse(v)) && typeof v !== 'number')) return dateIN(v);
  if (typeof v === 'number') return /value|cost|materials|invoice|amc|total/i.test(key) ? money(v) : String(Math.round(v * 10) / 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return human(v).length === String(v).length && /^[a-z_]+$/.test(v) ? human(v) : String(v);
};

function section(doc, title, val) {
  if (val == null) return;
  if (Array.isArray(val)) {
    heading(doc, title);
    if (!val.length) return paragraph(doc, 'None in this period.', 9);
    const cols = Object.keys(val[0]).filter((c) => !c.startsWith('_') && (typeof val[0][c] !== 'object' || val[0][c] instanceof Date || val[0][c] === null)).slice(0, 7);
    return table(doc, cols.map((c) => ({ header: human(c), width: 1 / cols.length })), val.map((r) => cols.map((c) => cell(c, r[c]))));
  }
  if (typeof val === 'object' && !(val instanceof Date)) {
    const flat = Object.entries(val).filter(([, v]) => v === null || typeof v !== 'object' || v instanceof Date);
    if (flat.length) {
      heading(doc, title);
      table(doc, [{ header: 'Measure', width: 0.55 }, { header: 'Value', width: 0.45 }], flat.map(([k, v]) => [human(k), cell(k, v)]));
    }
    Object.entries(val).filter(([, v]) => v && typeof v === 'object' && !(v instanceof Date)).forEach(([k, v]) => section(doc, `${title} - ${human(k)}`, v));
    return undefined;
  }
  heading(doc, title);
  return paragraph(doc, cell(title, val));
}

const RAG = { green: 'On target', amber: 'Watch', red: 'Off target' };

export function reportPdf(rep, property) {
  const kv = (k, v) => (v == null ? '-' : k.unit === '%' ? `${Math.round(v * 10) / 10}%` : String(v));
  return pdfBuffer((doc) => {
    banner(doc, rep.title, `${property?.name || ''}  |  ${dateIN(rep.periodStart)} to ${dateIN(rep.periodEnd)}  |  v${rep.version}  |  ${human(rep.status)}`);
    heading(doc, 'KPI scorecard: target, actual, variance, responsibility, corrective action');
    table(doc, [
      { header: 'KPI', width: 0.19 }, { header: 'Target', width: 0.08, align: 'right' }, { header: 'Actual', width: 0.08, align: 'right' }, { header: 'Variance', width: 0.09, align: 'right' },
      { header: 'Status', width: 0.1 }, { header: 'Responsibility', width: 0.15 }, { header: 'Corrective action', width: 0.31 },
    ], (rep.kpis || []).map((k) => [k.name, kv(k, k.target), kv(k, k.actual), k.variance == null ? '-' : `${k.variance > 0 ? '+' : ''}${k.variance}`, RAG[k.status] || '-', k.responsibility || '', k.correctiveAction || '']));
    if (rep.commentary) {
      heading(doc, "Property Manager's commentary");
      paragraph(doc, rep.commentary);
    }
    for (const [k, v] of Object.entries(rep.data || {})) section(doc, human(k), v);
    doc.moveDown(1);
    paragraph(doc, rep.signedAt ? `Signed off by ${rep.signedBy?.name || 'the Property Manager'} on ${dateIN(rep.signedAt)}.` : 'Draft - not yet signed off.', 9);
  }, { Title: rep.title });
}

export function purchaseOrderPdf(po, property) {
  return pdfBuffer((doc) => {
    banner(doc, `Purchase Order ${po.number}`, `Date ${dateIN(po.createdAt)}  |  Status: ${human(po.status)}`);
    const top = doc.y;
    const half = (doc.page.width - 2 * M) / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text('VENDOR', M, top);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(plain(po.vendorId?.name), M, doc.y, { width: half - 10 });
    doc.font('Helvetica').fontSize(9).text(plain(`${po.vendorId?.address || ''}\nGSTIN: ${po.vendorId?.gstin || '-'}`), { width: half - 10 });
    const leftBottom = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text('DELIVER TO', M + half, top);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(plain(property?.name), M + half, doc.y, { width: half });
    doc.font('Helvetica').fontSize(9).text(plain(`${property?.address || property?.city || ''}\nDelivery by ${dateIN(po.deliveryDate)}${po.prId ? `\nAgainst ${po.prId.number}` : ''}`), M + half, doc.y, { width: half });
    doc.y = Math.max(leftBottom, doc.y) + 14;
    doc.x = M;
    table(doc, [{ header: '#', width: 0.05 }, { header: 'Item', width: 0.37 }, { header: 'HSN', width: 0.11 }, { header: 'Qty', width: 0.1, align: 'right' }, { header: 'Rate', width: 0.13, align: 'right' }, { header: 'GST %', width: 0.08, align: 'right' }, { header: 'Amount', width: 0.16, align: 'right' }],
      po.items.map((l, i) => [i + 1, `${l.itemId?.code || ''} ${l.itemId?.name || ''}`, l.itemId?.hsn || '', `${l.qty} ${l.itemId?.uom || ''}`, money(l.rate), l.gstPct ?? 18, money(l.qty * l.rate)]));
    table(doc, [{ header: 'Summary', width: 0.7, align: 'right' }, { header: 'Amount', width: 0.3, align: 'right' }], [['Sub-total', money(po.subTotal)], ['GST', money(po.gst)], ['Total', money(po.total)]]);
    if (po.terms) {
      heading(doc, 'Terms');
      paragraph(doc, po.terms, 9);
    }
    if (po.approvals?.length) {
      heading(doc, 'Approvals');
      po.approvals.forEach((a) => paragraph(doc, `${human(a.action)} by ${a.byName} (${human(a.level || '')}) on ${dateIN(a.at)}`, 9));
    }
    doc.moveDown(3);
    doc.moveTo(doc.page.width - M - 200, doc.y).lineTo(doc.page.width - M, doc.y).strokeColor(INK).stroke();
    doc.font('Helvetica').fontSize(9).text('Authorised signatory', doc.page.width - M - 200, doc.y + 4, { width: 200, align: 'center' });
  }, { Title: `Purchase Order ${po.number}` });
}
