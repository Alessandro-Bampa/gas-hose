/*
 * xlsx-lite.js — lettura e scrittura minimale di file .xlsx, senza librerie esterne.
 *
 * Scrittura: genera un pacchetto OOXML (zip "store", stringhe inline, formule con
 * valore già calcolato, così il file si legge correttamente anche senza ricalcolo).
 * Lettura: decomprime con DecompressionStream('deflate-raw') nativo del browser e
 * interpreta i fogli con DOMParser (stringhe condivise, inline, numeri, booleani).
 */
(function (global) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* ------------------------------------------------------------------ CRC32 */

  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function concat(chunks) {
    let len = 0;
    for (const c of chunks) len += c.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /* ------------------------------------------------------------ ZIP: scrittura */

  /** files: [{ name, data: string | Uint8Array }] → Uint8Array (metodo "store") */
  function zip(files) {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // nomi in UTF-8
      lh.setUint16(8, 0, true);      // nessuna compressione
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      local.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const cd = concat(central);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cd.length, true);
    end.setUint32(16, offset, true);
    return concat([...local, cd, new Uint8Array(end.buffer)]);
  }

  /* -------------------------------------------------------------- ZIP: lettura */

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Il browser non supporta la lettura dei file .xlsx: aggiornalo all\'ultima versione.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function unzip(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('il file non è un archivio .xlsx/.zip valido');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('archivio danneggiato');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/').replace(/^\//, '');
      p += 46 + nlen + elen + clen;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      entries.set(name.toLowerCase(), { name, method, data: u8.subarray(start, start + size) });
    }

    return {
      names: () => [...entries.values()].map(e => e.name),
      async bytes(n) {
        const e = entries.get(String(n).toLowerCase());
        if (!e) return null;
        if (e.method === 0) return e.data;
        if (e.method === 8) return inflateRaw(e.data);
        throw new Error('metodo di compressione non supportato (' + e.method + ')');
      },
      async text(n) {
        const b = await this.bytes(n);
        return b ? dec.decode(b) : null;
      },
    };
  }

  /* ----------------------------------------------------------------- utilità */

  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(c) {
    let s = '';
    while (c > 0) {
      const m = (c - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }

  function colIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  const num = v => String(Math.round(v * 1e8) / 1e8);

  const EPOCH = Date.UTC(1899, 11, 30);
  function dateToSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - EPOCH) / 86400000;
  }
  function serialToDate(n) {
    return new Date(EPOCH + Math.floor(n + 1e-9) * 86400000).toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------- scrittura */

  /** Indici degli stili definiti in STYLES_XML (cellXfs). */
  const STYLE = { normal: 0, bold: 1, money: 2, moneyBold: 3, percent: 4, date: 5, header: 6, title: 7, note: 8 };

  const STYLES_XML = XML_HEAD +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;;[Red]\\-#,##0.00\\ &quot;€&quot;"/></numFmts>' +
    '<fonts count="4">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><i/><sz val="10"/><color rgb="FF7F7F7F"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE6EEF8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FF9DB4D3"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /** Foglio da scrivere: celle sparse indicizzate da riga/colonna (base 1). */
  class Sheet {
    constructor(name) {
      this.name = name;
      this.rows = new Map();
      this.widths = {};
    }
    /** value: number | string | boolean | null; formula senza "=" iniziale. */
    set(r, c, value, style, formula) {
      if (!this.rows.has(r)) this.rows.set(r, new Map());
      this.rows.get(r).set(c, { v: value, s: style || 0, f: formula || null });
      return this;
    }
    width(c, w) { this.widths[c] = w; return this; }
  }

  function cellXml(ref, { v, s, f }) {
    const sa = s ? ` s="${s}"` : '';
    if (f) {
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${sa}><f>${esc(f)}</f><v>${num(v)}</v></c>`;
      if (typeof v === 'string') return `<c r="${ref}"${sa} t="str"><f>${esc(f)}</f><v>${esc(v)}</v></c>`;
      return `<c r="${ref}"${sa}><f>${esc(f)}</f></c>`;
    }
    if (v === null || v === undefined || v === '') return sa ? `<c r="${ref}"${sa}/>` : '';
    if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${sa}><v>${num(v)}</v></c>` : '';
    if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  function sheetXml(sh, selected) {
    const out = [XML_HEAD, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`];
    out.push(`<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}/></sheetViews>`);
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    const wc = Object.keys(sh.widths).map(Number).sort((a, b) => a - b);
    if (wc.length) {
      out.push('<cols>');
      for (const c of wc) out.push(`<col min="${c}" max="${c}" width="${sh.widths[c]}" customWidth="1"/>`);
      out.push('</cols>');
    }
    out.push('<sheetData>');
    for (const r of [...sh.rows.keys()].sort((a, b) => a - b)) {
      const row = sh.rows.get(r);
      out.push(`<row r="${r}">`);
      for (const c of [...row.keys()].sort((a, b) => a - b)) out.push(cellXml(colName(c) + r, row.get(c)));
      out.push('</row>');
    }
    out.push('</sheetData>');
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    out.push('</worksheet>');
    return out.join('');
  }

  /** sheets: Sheet[] → Uint8Array del file .xlsx */
  function write(sheets, opts = {}) {
    const active = Math.min(Math.max(0, opts.activeSheet || 0), sheets.length - 1);
    const n = sheets.length;

    const contentTypes = XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rootRels = XML_HEAD +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const core = XML_HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${esc(opts.title || '')}</dc:title><dc:creator>Hose</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>';
    const app = XML_HEAD +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Hose</Application></Properties>';

    const workbook = XML_HEAD +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<bookViews><workbookView activeTab="${active}"/></bookViews><sheets>` +
      sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';

    const wbRels = XML_HEAD +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
      '</Relationships>';

    const files = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: STYLES_XML },
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, i === active) }));
    return zip(files);
  }

  /* ---------------------------------------------------------------- lettura */

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('contenuto XML non valido');
    return doc;
  }

  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const child = (node, tag) => Array.from(node.children).find(e => e.localName === tag) || null;

  function relId(el) {
    for (const a of Array.from(el.attributes)) if (a.localName === 'id' && a.prefix) return a.value;
    return null;
  }

  function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/');
    parts.pop();
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  async function readRels(z, partPath) {
    const cut = partPath.lastIndexOf('/') + 1;
    const relPath = partPath.slice(0, cut) + '_rels/' + partPath.slice(cut) + '.rels';
    const txt = await z.text(relPath);
    const map = {};
    if (!txt) return map;
    for (const r of all(parseXml(txt), 'Relationship')) {
      map[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', target: resolvePath(partPath, r.getAttribute('Target') || '') };
    }
    return map;
  }

  const richText = node => all(node, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');

  function cellValue(c, sst) {
    const t = c.getAttribute('t') || 'n';
    const vEl = child(c, 'v');
    const v = vEl ? vEl.textContent : null;
    switch (t) {
      case 's': return v == null ? null : (sst[parseInt(v, 10)] ?? null);
      case 'inlineStr': { const is = child(c, 'is'); return is ? richText(is) : ''; }
      case 'str': return v;
      case 'b': return v === '1';
      case 'e': return null;
      case 'd': return v;
      default: {
        if (v == null || v === '') return null;
        const n = Number(v);
        return isNaN(n) ? v : n;
      }
    }
  }

  function parseSheet(doc, sst) {
    const rows = [];
    let rIdx = 0;
    for (const row of all(doc, 'row')) {
      const ra = parseInt(row.getAttribute('r'), 10);
      rIdx = isNaN(ra) ? rIdx + 1 : ra;
      const arr = [];
      let cIdx = 0;
      for (const c of Array.from(row.children)) {
        if (c.localName !== 'c') continue;
        const m = /^([A-Z]+)/.exec(c.getAttribute('r') || '');
        cIdx = m ? colIndex(m[1]) : cIdx + 1;
        arr[cIdx - 1] = cellValue(c, sst);
      }
      rows[rIdx - 1] = arr;
    }
    return rows;
  }

  /** ArrayBuffer → { sheets: [{ name, rows }], sheet(name) } — rows[r][c] in base 0 */
  async function read(buffer) {
    const z = unzip(buffer);
    const rootRels = await readRels(z, '');
    let wbPath = 'xl/workbook.xml';
    for (const r of Object.values(rootRels)) if (/\/officeDocument$/.test(r.type)) wbPath = r.target;
    const wbText = await z.text(wbPath);
    if (!wbText) throw new Error('cartella di lavoro non trovata nel file');
    const wb = parseXml(wbText);
    const rels = await readRels(z, wbPath);

    let sst = [];
    for (const r of Object.values(rels)) {
      if (!/\/sharedStrings$/.test(r.type)) continue;
      const t = await z.text(r.target);
      if (t) sst = all(parseXml(t), 'si').map(richText);
    }

    const sheets = [];
    for (const s of all(wb, 'sheet')) {
      const rel = rels[relId(s)];
      if (!rel) continue;
      const txt = await z.text(rel.target);
      if (!txt) continue;
      sheets.push({ name: s.getAttribute('name') || '', rows: parseSheet(parseXml(txt), sst) });
    }
    return {
      sheets,
      sheet(name) {
        const n = name.toLowerCase();
        return sheets.find(s => s.name.trim().toLowerCase() === n) || null;
      },
    };
  }

  global.XlsxLite = { Sheet, STYLE, write, read, zip, unzip, colName, dateToSerial, serialToDate };
})(window);
