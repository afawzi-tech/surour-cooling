/* ==========================================================
   قراءة وكتابة ملفات Excel (xlsx) بدون مكتبات خارجية
   - القراءة: فك ضغط zip عبر DecompressionStream وقراءة XML بـ DOMParser
   - الكتابة: zip بدون ضغط (stored) مع أوراق وألوان بسيطة
   ========================================================== */
(() => {
  'use strict';

  /* ---------- قراءة ---------- */
  async function unzip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // البحث عن نهاية الدليل المركزي
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('الملف ليس ملف Excel صالحاً');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('بنية الملف غير صالحة');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + cmtLen;
      if (!/\.(xml|rels)$/i.test(name)) continue;
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      const data = u8.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
      files[name] = { method, data };
    }
    return {
      async text(name) {
        const f = files[name];
        if (!f) return null;
        if (f.method === 0) return dec.decode(f.data);
        if (f.method !== 8) throw new Error('طريقة ضغط غير مدعومة');
        const ds = new DecompressionStream('deflate-raw');
        const out = new Response(new Blob([f.data]).stream().pipeThrough(ds));
        return out.text();
      }
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // ترجع { 'اسم الورقة': [[قيم الصف الأول], ...] } بالقيم المحسوبة المحفوظة
  async function readWorkbook(arrayBuffer) {
    const z = await unzip(arrayBuffer);
    const wb = xml(await z.text('xl/workbook.xml'));
    const rels = xml(await z.text('xl/_rels/workbook.xml.rels'));
    const target = {};
    kids(rels, 'Relationship').forEach((r) => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const ssText = await z.text('xl/sharedStrings.xml');
    const shared = ssText ? kids(xml(ssText), 'si').map((si) => kids(si, 't').map((t) => t.textContent).join('')) : [];

    const out = {};
    for (const sh of kids(wb, 'sheet')) {
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let path = target[rid] || '';
      path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
      const s = await z.text(path);
      if (!s) continue;
      const rows = [];
      for (const row of kids(xml(s), 'row')) {
        const r = Number(row.getAttribute('r')) - 1;
        const arr = [];
        for (const c of kids(row, 'c')) {
          const t = c.getAttribute('t');
          const vEl = kids(c, 'v')[0];
          let v = null;
          if (t === 's') v = vEl ? shared[Number(vEl.textContent)] : null;
          else if (t === 'inlineStr') v = kids(c, 't').map((x) => x.textContent).join('');
          else if (t === 'b') v = vEl ? vEl.textContent === '1' : null;
          else if (t === 'str' || t === 'e') v = vEl ? vEl.textContent : null;
          else v = vEl ? Number(vEl.textContent) : null;
          arr[colIndex(c.getAttribute('r'))] = v;
        }
        rows[r] = arr;
      }
      out[sh.getAttribute('name')] = rows;
    }
    return out;
  }

  // رقم تاريخ Excel ← نص YYYY-MM-DD
  function excelDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }

  /* ---------- كتابة ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of entries) {
      const nameB = enc.encode(name);
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(lh.buffer), nameB, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    }
    const cSize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const escX = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // إزالة محارف التحكم غير المسموحة في XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function colName(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // الأنماط: 0 عادي، 1 عنوان، 2 ناجح، 3 فاشل، 4 معلّق، 5 لا ينطبق، 6 نسبة، 7 عنوان كبير، 8 تنبيه
  const STYLE = { normal: 0, header: 1, pass: 2, fail: 3, pending: 4, na: 5, pct: 6, title: 7, alert: 8, input: 9, calc: 10, calcPct: 11, date: 12, wrap: 13 };
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF99"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="14">
<xf borderId="1" applyBorder="1"/>
<xf fontId="1" fillId="6" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf>
<xf fillId="2" borderId="1" applyFill="1" applyBorder="1"/>
<xf fillId="3" borderId="1" applyFill="1" applyBorder="1"/>
<xf fillId="4" borderId="1" applyFill="1" applyBorder="1"/>
<xf fillId="5" borderId="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="9" borderId="1" applyNumberFormat="1" applyBorder="1"/>
<xf fontId="2"/>
<xf fontId="1" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf fillId="8" borderId="1" applyFill="1" applyBorder="1"/>
<xf fillId="9" borderId="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="9" fillId="9" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="14" borderId="1" applyNumberFormat="1" applyBorder="1"/>
<xf borderId="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<dxfs count="6">
<dxf><font><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF7F6000"/></font><fill><patternFill><bgColor rgb="FFFFF2CC"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF595959"/></font><fill><patternFill><bgColor rgb="FFE7E6E6"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FFFFFFFF"/></font><fill><patternFill><bgColor rgb="FFFF0000"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
</dxfs></styleSheet>`;

  // rows: مصفوفة صفوف، وكل خلية إما قيمة أو {v, s} حيث s اسم نمط
  function sheetXml(rows, opts = {}) {
    const cols = opts.widths
      ? '<cols>' + opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
      : '';
    // rtl: الورقة من اليمين لليسار (للأوراق العربية)
    const rtl = opts.rtl ? ' rightToLeft="1"' : '';
    const freeze = opts.freezeRow
      ? `<sheetViews><sheetView${rtl} workbookViewId="0"><pane ySplit="${opts.freezeRow}" xSplit="${opts.freezeCol || 0}" topLeftCell="${colName(opts.freezeCol || 0)}${opts.freezeRow + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
      : opts.rtl ? `<sheetViews><sheetView${rtl} workbookViewId="0"/></sheetViews>` : '';
    const body = rows.map((row, r) => {
      if (!row) return '';
      const cells = row.map((cell, c) => {
        if (cell === null || cell === undefined || cell === '') return '';
        const o = typeof cell === 'object' && !(cell instanceof Date) ? cell : { v: cell };
        if (!o.f && (o.v === null || o.v === undefined || o.v === '')) return o.s ? `<c r="${colName(c)}${r + 1}" s="${STYLE[o.s] || 0}"/>` : '';
        const s = STYLE[o.s] ?? 0;
        const ref = colName(c) + (r + 1);
        if (o.f) {
          const fx = `<f>${escX(o.f)}</f>`;
          if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}" s="${s}">${fx}<v>${o.v}</v></c>`;
          return `<c r="${ref}" s="${s}" t="str">${fx}<v>${escX(o.v ?? '')}</v></c>`;
        }
        if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}" s="${s}"><v>${o.v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escX(o.v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    const filter = opts.autoFilter ? `<autoFilter ref="${opts.autoFilter}"/>` : '';
    let prio = 1;
    const cf = (opts.cf || []).map((c) => `<conditionalFormatting sqref="${c.sqref}">${c.rules.map((r) =>
      `<cfRule type="cellIs" dxfId="${r.dxf}" priority="${prio++}" operator="equal"><formula>${escX(r.formula)}</formula></cfRule>`).join('')}</conditionalFormatting>`).join('');
    const dv = (opts.validations || []).length
      ? `<dataValidations count="${opts.validations.length}">${opts.validations.map((v) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>${escX(v.list)}</formula1></dataValidation>`).join('')}</dataValidations>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData>${filter}${cf}${dv}</worksheet>`;
  }

  // sheets: [{ name, rows, opts }]
  function writeWorkbook(sheets) {
    const safe = (n) => n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const entries = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escX(safe(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES_XML],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.opts)])
    ];
    return zip(entries);
  }

  window.XLSX_LITE = { readWorkbook, writeWorkbook, excelDate, colName };
})();
