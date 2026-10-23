/*
 * xls-lite.js — lettura minimale dei vecchi file Excel .xls (BIFF8), senza librerie esterne.
 *
 * Un .xls è un contenitore OLE (Compound File Binary) con dentro lo stream "Workbook":
 * una sequenza di record BIFF8. Qui si leggono solo i valori delle celle (testi, numeri,
 * booleani, risultati delle formule), non stili né formati: le date restano numeri seriali.
 * Serve per gli estratti conto delle banche che esportano ancora in .xls (es. BPER).
 */
(function (global) {
  'use strict';

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const i32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  const f64 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);

  /* ------------------------------------------------------ contenitore OLE (CFB) */

  const END = 0xfffffffa; // da qui in su: fine catena / settori speciali

  function cfbStream(u8, wanted) {
    if (u32(u8, 0) !== 0xe011cfd0 || u32(u8, 4) !== 0xe11ab1a1) throw new Error('il file non è un .xls valido');
    const ssz = 1 << u16(u8, 30);
    const mssz = 1 << u16(u8, 32);
    const nFat = u32(u8, 44);
    const dirStart = u32(u8, 48);
    const cutoff = u32(u8, 56);
    const miniFatStart = u32(u8, 60);
    let difSect = u32(u8, 68);
    const sector = i => u8.subarray((i + 1) * ssz, (i + 2) * ssz);

    // DIFAT: i primi 109 settori della FAT sono nell'header, gli altri in una catena a parte.
    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(u32(u8, 76 + i * 4));
    for (let guard = 0; fatSectors.length < nFat && difSect < END && guard < 1e5; guard++) {
      const s = sector(difSect);
      for (let i = 0; i < ssz / 4 - 1 && fatSectors.length < nFat; i++) fatSectors.push(u32(s, i * 4));
      difSect = u32(s, ssz - 4);
    }
    const fat = [];
    for (const fs of fatSectors) { const s = sector(fs); for (let i = 0; i < ssz; i += 4) fat.push(u32(s, i)); }

    const chain = (start, table) => {
      const out = [];
      for (let s = start; s < END && out.length <= table.length; s = table[s]) out.push(s);
      return out;
    };
    const join = (parts, size) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return size != null ? out.subarray(0, size) : out;
    };

    const dir = join(chain(dirStart, fat).map(sector));
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nl = Math.min(64, u16(dir, o + 64));
      let name = '';
      for (let i = 0; i + 1 < nl - 1; i += 2) name += String.fromCharCode(u16(dir, o + i));
      entries.push({ name, type: dir[o + 66], start: u32(dir, o + 116), size: u32(dir, o + 120) });
    }
    const root = entries[0];
    const e = entries.find(x => x.type === 2 && wanted.includes(x.name.toLowerCase()));
    if (!e) return null;
    if (e.size >= cutoff) return join(chain(e.start, fat).map(sector), e.size);

    // Stream piccoli: stanno nel "mini stream" del root, a blocchi da 64 byte.
    const mini = join(chain(root.start, fat).map(sector));
    const miniFat = [];
    for (const s of chain(miniFatStart, fat)) { const b = sector(s); for (let i = 0; i < ssz; i += 4) miniFat.push(u32(b, i)); }
    return join(chain(e.start, miniFat).map(i => mini.subarray(i * mssz, (i + 1) * mssz)), e.size);
  }

  /* ------------------------------------------------------------ record BIFF8 */

  const R = {
    BOF: 0x0809, EOF: 0x000a, FILEPASS: 0x002f, BOUNDSHEET: 0x0085, SST: 0x00fc, CONTINUE: 0x003c,
    LABELSST: 0x00fd, LABEL: 0x0204, NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, BOOLERR: 0x0205,
    FORMULA: 0x0006, STRING: 0x0207,
  };

  function records(wb) {
    const out = [];
    for (let p = 0; p + 4 <= wb.length;) {
      const len = u16(wb, p + 2);
      out.push({ type: u16(wb, p), pos: p, data: wb.subarray(p + 4, p + 4 + len) });
      p += 4 + len;
    }
    return out;
  }

  /** Caratteri: compressi (1 byte = Latin-1) o UTF-16LE. */
  function chars(b, o, n, wide) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(wide ? u16(b, o + i * 2) : b[o + i]);
    return s;
  }

  /** XLUnicodeString con lunghezza a 16 bit (LABEL, STRING) o a 8 bit (BOUNDSHEET). */
  function xlString(b, o, short) {
    const cch = short ? b[o] : u16(b, o);
    const p = o + (short ? 1 : 2);
    return chars(b, p + 1, cch, b[p] & 1);
  }

  /**
   * Tabella delle stringhe condivise. Se una stringa non sta in un record prosegue nel
   * CONTINUE successivo, che inizia con un byte di flag (compressa / UTF-16).
   */
  function sstStrings(chunks) {
    let ci = 0, buf = chunks[0], off = 8;
    const count = u32(buf, 4);
    const out = [];
    const next = () => { buf = chunks[++ci]; off = 0; return !!buf; };
    for (let i = 0; i < count; i++) {
      if (off >= buf.length && !next()) break;
      const cch = u16(buf, off);
      let flags = buf[off + 2];
      off += 3;
      let skip = 0;
      if (flags & 8) { skip += u16(buf, off) * 4; off += 2; }   // formattazione (rich text)
      if (flags & 4) { skip += u32(buf, off); off += 4; }        // dati fonetici
      let s = '', left = cch;
      while (left > 0) {
        let wide = flags & 1;
        let avail = Math.floor((buf.length - off) / (wide ? 2 : 1));
        if (avail <= 0) {
          if (!next()) return out;
          flags = buf[0];
          off = 1;
          continue;
        }
        const n = Math.min(left, avail);
        s += chars(buf, off, n, wide);
        off += n * (wide ? 2 : 1);
        left -= n;
      }
      while (skip > 0) {
        if (off >= buf.length && !next()) return out;
        const k = Math.min(skip, buf.length - off);
        off += k;
        skip -= k;
      }
      out.push(s);
    }
    return out;
  }

  /** Valore RK: intero a 30 bit o i 30 bit alti di un double, eventualmente ×100. */
  function rk(v) {
    let n;
    if (v & 2) n = v >> 2;
    else {
      const dv = new DataView(new ArrayBuffer(8));
      dv.setUint32(4, (v & 0xfffffffc) >>> 0, true);
      n = dv.getFloat64(0, true);
    }
    return v & 1 ? n / 100 : n;
  }

  /* ----------------------------------------------------------------- lettura */

  /** ArrayBuffer → { sheets: [{ name, rows }], sheet(name) } — rows[r][c] in base 0 */
  function read(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const wb = cfbStream(u8, ['workbook', 'book']);
    if (!wb) throw new Error('il file .xls non contiene una cartella di lavoro');
    const recs = records(wb);
    if (!recs.length || recs[0].type !== R.BOF || u16(recs[0].data, 0) !== 0x0600) {
      throw new Error('formato .xls troppo vecchio: aprilo e salvalo come .xlsx');
    }

    let sst = [];
    const bounds = [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.type === R.FILEPASS) throw new Error('il file è protetto da password');
      if (r.type === R.BOUNDSHEET) {
        if (r.data[5] === 0) bounds.push({ pos: u32(r.data, 0), name: xlString(r.data, 6, true) });
      } else if (r.type === R.SST) {
        const chunks = [r.data];
        for (let j = i + 1; j < recs.length && recs[j].type === R.CONTINUE; j++) chunks.push(recs[j].data);
        sst = sstStrings(chunks);
      } else if (r.type === R.EOF) break;
    }

    const byPos = new Map(recs.map((r, i) => [r.pos, i]));
    const sheets = bounds.map(({ pos, name }) => {
      const rows = [];
      const set = (r, c, v) => { (rows[r] || (rows[r] = []))[c] = v; };
      let i = byPos.get(pos);
      if (i == null) return { name, rows };
      let pending = null; // FORMULA con risultato testuale: il testo arriva nel record STRING
      for (i++; i < recs.length && recs[i].type !== R.EOF; i++) {
        const { type, data: d } = recs[i];
        switch (type) {
          case R.LABELSST: set(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? ''); break;
          case R.LABEL: set(u16(d, 0), u16(d, 2), xlString(d, 6)); break;
          case R.NUMBER: set(u16(d, 0), u16(d, 2), f64(d, 6)); break;
          case R.RK: set(u16(d, 0), u16(d, 2), rk(i32(d, 6))); break;
          case R.MULRK: {
            const row = u16(d, 0), first = u16(d, 2), last = u16(d, d.length - 2);
            for (let c = first; c <= last; c++) set(row, c, rk(i32(d, 4 + (c - first) * 6 + 2)));
            break;
          }
          case R.BOOLERR: if (d[7] === 0) set(u16(d, 0), u16(d, 2), d[6] === 1); break;
          case R.FORMULA: {
            const row = u16(d, 0), col = u16(d, 2);
            if (u16(d, 12) !== 0xffff) set(row, col, f64(d, 6));
            else if (d[6] === 0) pending = [row, col];
            else if (d[6] === 1) set(row, col, d[8] === 1);
            else if (d[6] === 3) set(row, col, '');
            break;
          }
          case R.STRING: if (pending) { set(pending[0], pending[1], xlString(d, 0)); pending = null; } break;
          default: break;
        }
      }
      return { name, rows };
    });

    return {
      sheets,
      sheet(name) {
        const n = name.toLowerCase();
        return sheets.find(s => s.name.trim().toLowerCase() === n) || null;
      },
    };
  }

  /** true se i byte iniziali sono quelli di un contenitore OLE (.xls). */
  function isXls(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return u8.length >= 8 && u32(u8, 0) === 0xe011cfd0 && u32(u8, 4) === 0xe11ab1a1;
  }

  global.XlsLite = { read, isXls };
})(window);
