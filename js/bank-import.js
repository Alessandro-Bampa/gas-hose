/*
 * bank-import.js — import degli estratti movimenti delle banche (ING, BPER).
 *
 *  1. load: legge il file (.xls, .xlsx o .csv, riconosciuto dai primi byte), trova la banca
 *     dall'intestazione delle colonne e normalizza ogni movimento: data, importo con segno,
 *     descrizione pulita, "chiave" dell'esercente (es. FAMILA SUPERSTORE) e un riferimento
 *     stabile (rif) per non importarlo due volte.
 *  2. analyze: per ogni movimento propone una destinazione — Necessità o Svago (con
 *     categoria), Entrata, Prelievo dai Risparmi o Escludi — con una catena di regole:
 *     casi speciali, regole imparate dalle correzioni, dizionario di parole chiave, default.
 *     Quando non è sicuro segna il movimento come dubbio e spiega il motivo.
 * Nessun accesso al DOM: l'interfaccia è in app.js. Non crea mai accantonamenti nei Risparmi.
 */
(function (global) {
  'use strict';

  const { r2, norm, DIV } = global.Model;

  /** Uscite da qui in su (senza regola imparata) si propongono come prelievo dai Risparmi. */
  const SOGLIA_PRELIEVO = 500;
  /** Dove vanno le uscite non riconosciute. */
  const DEFAULT = { div: 'des', categoria: 'Altro' };
  const FONDO_PREDEFINITO = 'Fondo di emergenza';

  /* ----------------------------------------------------------------- utilità */

  const pad = n => String(n).padStart(2, '0');
  const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const up = s => norm(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const cut = s => (s.length > 80 ? s.slice(0, 79).trimEnd() + '…' : s);
  const money = n => Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.') + ' €';
  const shortIt = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;

  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  /**
   * Chiave dell'esercente o della controparte: maiuscolo, senza accenti e punteggiatura,
   * senza numeri di negozio (6111 FAMILA → FAMILA) né codici con cifre in mezzo alle
   * lettere (G1SK002M, mhOm3MciUpJ6CLo), al massimo 5 parole.
   */
  function makeKey(s) {
    return up(s).split(' ')
      .filter(t => t && !/^\d{3,}$/.test(t) && !(t.length >= 6 && /[A-Z]\d+[A-Z]/.test(t)))
      .slice(0, 5).join(' ');
  }

  /** Chiavi troppo generiche per ricordarle (valgono per esercenti diversi). */
  const GENERICHE = new Set(['', 'PAYPAL', 'SUMUP', 'SATISPAY', 'GOOGLE', 'APPLE', 'AMAZON', 'STORNO SCRITTURA']);
  const learnable = chiave => !GENERICHE.has(chiave);

  /** Stessa persona? Confronta le parole del nome in qualunque ordine (BAMPA ALESSANDRO = Alessandro Bampa). */
  const nameKey = s => up(s).split(' ').filter(t => t.length > 1).sort().join(' ');

  const MESI_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  function isoDate(y, m, d) {
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1900 && y < 3000 ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  /** Data in formato ISO da: seriale Excel, "gg/mm/aaaa", "aaaa-mm-gg" o "19 ottobre 2026". */
  function toIso(v) {
    if (typeof v === 'number' && isFinite(v)) return v > 20000 && v < 90000 ? global.XlsxLite.serialToDate(v) : null;
    const s = norm(v);
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (r) return isoDate(+r[1], +r[2], +r[3]);
    r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
    if (r) return isoDate(r[3].length === 2 ? 2000 + +r[3] : +r[3], +r[2], +r[1]);
    r = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s);
    if (r) return isoDate(+r[3], MESI_IT.indexOf(r[2]) + 1, +r[1]);
    return null;
  }

  const amount = v => (typeof v === 'number' ? r2(v) : global.Model.parseAmount(v));

  /* ------------------------------------------------------------- lettura file */

  function decodeText(u8) {
    let s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch { s = new TextDecoder('windows-1252').decode(u8); }
    return s.replace(/^\uFEFF/, '');
  }

  /** CSV → righe. Separatore (; , o tab) scelto dalla prima riga; gestisce le virgolette. */
  function parseCsv(text) {
    const head = text.split(/\r?\n/, 1)[0];
    const count = ch => head.split(ch).length - 1;
    const sep = [';', '\t', ','].reduce((a, b) => (count(b) > count(a) ? b : a));
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') cell += ch;
        else if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row);
        row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /** ArrayBuffer → { formato, sheets: [{ name, rows }] } */
  async function readTable(buffer) {
    const u8 = new Uint8Array(buffer);
    if (global.XlsLite.isXls(u8)) return { formato: 'xls', sheets: global.XlsLite.read(u8).sheets };
    if (u8[0] === 0x50 && u8[1] === 0x4b) return { formato: 'xlsx', sheets: (await global.XlsxLite.read(u8)).sheets };
    return { formato: 'csv', sheets: [{ name: 'CSV', rows: parseCsv(decodeText(u8)) }] };
  }

  /** Cerca la riga d'intestazione che contiene tutte le colonne richieste. → { index, col } */
  function findHeader(rows, required, optional = []) {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const cells = Array.from(rows[i] || [], v => norm(v));
      if (!required.every(n => cells.includes(n))) continue;
      const col = {};
      for (const n of [...required, ...optional]) col[n] = cells.indexOf(n);
      return { index: i, col };
    }
    return null;
  }

  /** Titolari e IBAN dalle righe sopra l'intestazione ("Intestazione: X" oppure "IBAN | X"). */
  function headerMeta(rows, upto) {
    const meta = { intestatari: [], iban: [] };
    for (let i = 0; i < upto; i++) {
      const r = rows[i] || [];
      for (let j = 0; j < r.length; j++) {
        if (typeof r[j] !== 'string') continue;
        const next = () => { for (let k = j + 1; k < r.length; k++) if (squash(r[k])) return squash(r[k]); return ''; };
        let m = /^(?:intestazione|intestatari[oa]?|titolar[ei])\s*:?\s*(.*)$/i.exec(r[j].trim());
        if (m) (m[1] || next()).split(/[,;]| - /).map(squash).filter(Boolean).forEach(n => meta.intestatari.push(n));
        m = /^(?:codice\s+)?iban\s*:?\s*([A-Z]{2}\d{2}[A-Z0-9]{10,})?$/i.exec(r[j].trim());
        if (m) { const v = (m[1] || next()).replace(/\s+/g, '').toUpperCase(); if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(v)) meta.iban.push(v); }
      }
    }
    return meta;
  }

  /* ------------------------------------------------------------------ banche */

  const merchant = s => squash(String(s).replace(/\s*-\s*Transazione C-less\s*$/i, '').replace(/[\s-]+$/, '')
    .replace(/^(?:SumUp|i?Zettle|SQ)\s*\*\s*/i, ''));

  /** Dettagli di un movimento ING dalla descrizione dell'operazione. */
  function ingDetails(causale, testo) {
    const t = squash(testo);
    const out = { tipo: 'altro', controparte: '', ibanControparte: '', nota: '', numero: '' };
    out.numero = (/\bN\.\s*([A-Z0-9]{10,})/.exec(t) || [])[1] || '';
    let m;
    if ((m = /\bpresso\s+(.+)$/i.exec(t))) {
      out.tipo = 'carta';
      out.descrizione = merchant(m[1]);
      out.chiave = makeKey(out.descrizione);
    } else if ((m = /A favore di\s+(.+?)\s+IBAN beneficiario\s+(\S+)(?:\s+Note:\s*(.*))?$/i.exec(t))) {
      Object.assign(out, { tipo: 'bonifico', controparte: m[1], ibanControparte: m[2], nota: squash(m[3]) });
      out.descrizione = `Bonifico a ${out.controparte}${out.nota ? ' · ' + out.nota : ''}`;
      out.chiave = 'BONIFICO A ' + makeKey(out.controparte);
    } else if ((m = /Anagrafica Ordinante\s+(.+?)(?:\s+Note:\s*(.*))?$/i.exec(t))) {
      Object.assign(out, { tipo: 'bonifico', controparte: m[1], nota: squash(m[2]) });
      out.ibanControparte = (/Codifica Ordinante\s+(\S+)/i.exec(t) || [])[1] || '';
      out.descrizione = `Da ${out.controparte}${out.nota ? ' · ' + out.nota : ''}`;
      out.chiave = 'BONIFICO DA ' + makeKey(out.controparte);
    } else {
      out.descrizione = causale ? `${causale} · ${t}` : t;
      out.chiave = makeKey(causale || t);
    }
    if (/\bcarta\b/i.test(causale)) out.tipo = 'carta';
    return out;
  }

  /** Dettagli di un movimento BPER: la descrizione è libera, i bonifici hanno una forma fissa. */
  function bperDetails(importo, testo) {
    const t = squash(testo);
    const out = { tipo: /\b(POS|CARTA|BANCOMAT|MASTERCARD|VISA|MAESTRO)\b/i.test(t) ? 'carta' : 'altro', controparte: '', ibanControparte: '', nota: '', numero: '' };
    if (/^BONIFICO/i.test(t)) {
      out.tipo = 'bonifico';
      const ordinante = (/o\/c:\s*(.+?)\s+ABI-CAB/i.exec(t) || [])[1] || '';
      const beneficiario = (/a favore di\s+(.+?)\s+(?:Num\.|IBAN|$)/i.exec(t) || [])[1] || '';
      out.nota = squash((/Bon\.Sepa\s+\d+\s*(.*?)\s+[\d.]+,\d{2}\s*EUR/i.exec(t) || [])[1]);
      out.numero = (/Bon\.Sepa\s+(\d+)/i.exec(t) || [])[1] || '';
      out.controparte = importo > 0 ? ordinante : beneficiario;
      out.descrizione = `${importo > 0 ? 'Bonifico da' : 'Bonifico a'} ${out.controparte}${out.nota ? ' · ' + out.nota : ''}`;
      out.chiave = (importo > 0 ? 'BONIFICO DA ' : 'BONIFICO A ') + makeKey(out.controparte);
    } else {
      out.descrizione = squash(t.replace(/Num\.\s*Bon\.Sepa\s*\d+/gi, '').replace(/-?\s*RIF\.\s*[\d/]+/gi, '')
        .replace(/Spese:\s*[\d.,]+\s*EUR/gi, '').replace(/\b[\d.]+,\d{2}\s*EUR\b/gi, ''));
      out.chiave = makeKey(out.descrizione);
    }
    return out;
  }

  /**
   * Registro delle banche. parse(rows) → null se il foglio non è di quella banca, altrimenti
   * { movimenti, intestatari, iban, nonContabilizzati }.
   * Data del movimento: la valuta (per le carte coincide con il giorno dell'acquisto).
   */
  const BANKS = [
    {
      nome: 'ING',
      parse(rows) {
        const h = findHeader(rows, ['data contabile', 'data valuta', 'causale', 'descrizione operazione'], ['importo in euro', 'uscite', 'entrate']);
        if (!h || (h.col['importo in euro'] < 0 && (h.col.uscite < 0 || h.col.entrate < 0))) return null;
        const c = h.col;
        const movimenti = [];
        for (let i = h.index + 1; i < rows.length; i++) {
          const r = rows[i] || [];
          const dataContabile = toIso(r[c['data contabile']]);
          const causale = squash(r[c.causale]);
          const testo = squash(r[c['descrizione operazione']]);
          if (!dataContabile || (!causale && /^saldo (iniziale|finale)/i.test(testo))) continue;
          let importo;
          if (c['importo in euro'] >= 0) importo = amount(r[c['importo in euro']]);
          else { const u = amount(r[c.uscite]); importo = isFinite(u) && u !== 0 ? -Math.abs(u) : Math.abs(amount(r[c.entrate])); }
          if (!isFinite(importo) || !importo) continue;
          const d = ingDetails(causale, testo);
          movimenti.push({ dataContabile, data: toIso(r[c['data valuta']]) || dataContabile, importo, causale, testo, ...d });
        }
        return { movimenti, ...headerMeta(rows, h.index), nonContabilizzati: 0 };
      },
    },
    {
      nome: 'BPER',
      parse(rows) {
        const h = findHeader(rows, ['data operazione', 'data valuta', 'descrizione', 'entrate', 'uscite'], ['stato', 'categoria']);
        if (!h) return null;
        const c = h.col;
        const movimenti = [];
        let nonContabilizzati = 0;
        for (let i = h.index + 1; i < rows.length; i++) {
          const r = rows[i] || [];
          const dataContabile = toIso(r[c['data operazione']]);
          if (!dataContabile) continue;
          const e = amount(r[c.entrate]), u = amount(r[c.uscite]);
          const importo = isFinite(e) && e !== 0 ? Math.abs(e) : isFinite(u) && u !== 0 ? -Math.abs(u) : 0;
          if (!importo) continue;
          // movimenti in lavorazione: arriveranno contabilizzati in un prossimo estratto
          if (c.stato >= 0 && squash(r[c.stato]) && norm(r[c.stato]) !== 'contabilizzato') { nonContabilizzati++; continue; }
          const testo = squash(r[c.descrizione]);
          const causale = c.categoria >= 0 ? squash(r[c.categoria]) : '';
          const d = bperDetails(importo, testo);
          movimenti.push({ dataContabile, data: toIso(r[c['data valuta']]) || dataContabile, importo, causale, testo, ...d });
        }
        return { movimenti, ...headerMeta(rows, h.index), nonContabilizzati };
      },
    },
  ];

  /**
   * Legge un file di movimenti. → null se non è di una banca riconosciuta, altrimenti
   * { nome, banca, formato, movimenti, intestatari, iban, nonContabilizzati, dal, al }.
   */
  async function load(name, buffer) {
    const t = await readTable(buffer);
    for (const bank of BANKS) {
      for (const sh of t.sheets) {
        const res = bank.parse(sh.rows || []);
        if (!res) continue;
        const seen = new Map();
        for (const mv of res.movimenti) {
          const base = `${bank.nome}|${mv.dataContabile}|${mv.importo.toFixed(2)}|${hash(up(mv.testo))}`;
          const n = (seen.get(base) || 0) + 1;
          seen.set(base, n);
          mv.rif = n > 1 ? `${base}#${n}` : base;
          mv.banca = bank.nome;
          mv.descrizione = cut(mv.descrizione || mv.testo || mv.causale || 'Movimento');
          mv.chiave = mv.chiave || makeKey(mv.descrizione);
        }
        const dates = res.movimenti.map(x => x.data).sort();
        return { nome: name, banca: bank.nome, formato: t.formato, ...res, dal: dates[0] || null, al: dates[dates.length - 1] || null };
      }
    }
    return null;
  }

  /* --------------------------------------------------------- classificazione */

  // [suddivisione, categoria, parole (inizio di parola; \b per quelle da prendere intere), opzioni]
  // L'ordine conta: vince la prima regola che corrisponde. grande: importi alti normali (no prelievo).
  const DIZIONARIO = [
    ['nec', 'Affitto mensile', 'AFFITT|LOCAZION|MUTUO|CONDOMIN', { grande: true }],
    ['nec', 'Bollette di luce e gas', 'BOLLETT|ENEL\\b|ENEL ENERGIA|HERA\\b|A2A\\b|EDISON|IREN\\b|ACEA\\b|SORGENIA|PLENITUDE|ENI GAS|VERITAS|ACQUEDOTT|ILLUMIA|OCTOPUS|DOLOMITI ENERGIA|ASCOTRADE|ETRA\\b', { grande: true }],
    ['nec', 'Telefono e internet', 'ILIAD|TIM\\b|TELECOM|VODAFONE|WIND|FASTWEB|HO MOBILE|KENA|VERY MOBILE|POSTEMOBILE|SKY WIFI|EOLO|TISCALI|LINKEM'],
    ['nec', 'Spesa alimentare', 'FAMILA|ALI SUPERMERCAT|IPERLANDO|CONAD|COOP\\b|IPERCOOP|ESSELUNGA|LIDL|EUROSPIN|CARREFOUR|DESPAR|INTERSPAR|SPAR\\b|ALDI\\b|PENNY|MD\\b|PAM\\b|PANORAMA|TIGROS|BENNET|SUPERMERCAT|SUPERSTORE|ALIMENTARI|MACELLERI|PANIFICI|ORTOFRUTT|FRUTTA|DECO\\b|CRAI\\b|EMISFERO|PRIX\\b|NATURASI'],
    ['nec', 'Benzina', 'VEGA\\b|ENI\\b|ENILIVE|AGIP|Q8\\b|ESSO\\b|IP\\b|TAMOIL|API\\b|TOTALERG|SHELL\\b|CARBURANT|DISTRIBUTOR|STAZIONE DI SERVIZIO'],
    ['nec', 'Auto e trasporti', 'CASELLO|AUTOSTRAD|PEDAGGI|SPV\\b|ASPIT|PEDEMONTAN|TELEPASS|TRENITALIA|ITALO\\b|TRENORD|AVM\\b|ACTV|VELA M|BUSITALIA|FLIXBUS|ATAC\\b|ATM\\b|PARCHEGG|PARKING|EASYPARK|CAR WASH|STARWASH|AUTOLAVAGG|GOMMIST|OFFICINA|MECCANIC|BOLLO AUTO|ACI\\b'],
    ['nec', 'Salute', 'FARMACI|PARAFARMACI|ULSS|ASL\\b|OSPEDAL|POLIAMBULATOR|DENTIST|ODONTOIATR|OTTICA|LABORATORIO ANALISI'],
    ['nec', 'Assicurazioni', 'ASSICURAZ|POLIZZ|PREMI ASSICURATIVI|UNIPOL|ALLIANZ|AXA\\b|REALE MUTUA|ZURICH|GENIALLOYD|LINEAR\\b'],
    ['nec', 'Tasse e commissioni', 'BOLLI GOVERNATIVI|IMPOSTA DI BOLLO|COMMISSION|CANONE CONTO|SPESE TENUTA|F24\\b|AGENZIA ENTRATE|PAGOPA|TARI\\b|IMU\\b'],
    ['des', 'Abbonamenti per servizi di intrattenimento (Netflix, HBO, Spotify)', 'NETFLIX|SPOTIFY|DISNEY|DAZN|NOW TV|NOWTV|SKY\\b|PRIME VIDEO|AMAZON PRIME|GOOGLE|YOUTUBE|APPLE|ITUNES|ANTHROPIC|CLAUDE|OPENAI|CHATGPT|STEAM|PLAYSTATION|XBOX|NINTENDO|AUDIBLE|PARAMOUNT|TIMVISION|CRUNCHYROLL'],
    ['des', 'Abbonamenti in palestra', 'PALESTR|FITNESS|GYM\\b|MCFIT|VIRGIN ACTIVE|PISCIN|CROSSFIT'],
    ['des', 'Cene fuori', 'RISTORANT|TRATTORI|OSTERI|PIZZERI|PIADIN|BAR\\b|CAFFE|CAFE\\b|PUB\\b|SUSHI|BIRRERI|BIRRIFICI|GELATERI|PASTICCERI|ENOTEC|BRACERI|PANINOTEC|KEBAB|AGRITURISM|BISTROT|TAVERN|LOCANDA|ROSTICCERI|SNACK|JUST EAT|JUSTEAT|DELIVEROO|GLOVO|MCDONALD|BURGER|ROADHOUSE|OLD WILD WEST|STARBUCKS|AUTOGRILL'],
    ['des', 'Shopping e abbigliamento', 'DECATHLON|ZARA\\b|OVS\\b|AMAZON|AMZN|ZALANDO|PRIMARK|UNIQLO|BERSHKA|STRADIVARIUS|CALZEDONIA|INTIMISSIMI|TEZENIS|FOOT LOCKER|NIKE\\b|ADIDAS|MEDIAWORLD|MEDIA WORLD|UNIEURO|EURONICS|IKEA\\b|LEROY MERLIN|SHEIN|TEMU\\b|ALIEXPRESS|EBAY|DOUGLAS|SEPHORA|KIKO\\b|FELTRINELLI|MONDADORI|LIBRERI'],
    ['des', 'Cura della persona', 'BARBER|BARBIERE|PARRUCCHIER|ACCONCIATUR|ESTETIC|NAILS\\b|CENTRO BENESSERE'],
  ].map(([div, categoria, words, opts]) => ({ div, categoria, re: new RegExp('\\b(?:' + words + ')'), ...(opts || {}) }));

  function dictionary(mv) {
    const hay = [mv.chiave, up(mv.causale), up(mv.nota)].join(' | ');
    for (const rule of DIZIONARIO) {
      const m = rule.re.exec(hay);
      if (m) return { ...rule, parola: m[0] };
    }
    return null;
  }

  /** Movimento già presente nel mese (inserito a mano o in un altro modo)? */
  function findDuplicate(budget, mv, used) {
    const entrata = mv.importo > 0;
    const a = Math.abs(mv.importo), d = dayNum(mv.data);
    const y = +mv.data.slice(0, 4), m = +mv.data.slice(5, 7) - 1;
    for (const delta of [0, -1, 1]) {
      const t = y * 12 + m + delta;
      const mo = budget.getMonth(Math.floor(t / 12), t % 12);
      if (!mo) continue;
      // un accredito può essere un'entrata o un rimborso (spesa negativa); un addebito una spesa o un prelievo
      const spese = mo.uscite.filter(u => !u.obiettivo && (u.div !== 'ris' || global.Model.tipoOf(u) === 'prelievo'));
      const list = entrata ? [...mo.entrate, ...spese.filter(u => u.importo < 0)] : spese.filter(u => u.importo > 0);
      const hit = list.find(it => !used.has(it.id) && (
        (Math.abs(Math.abs(it.importo) - a) < 0.005 && Math.abs(dayNum(it.data) - d) <= 3)
        || (entrata && delta === 0 && it.ricorrente && Math.abs(it.importo - a) <= a * 0.1)));
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Proposte per i movimenti dei file letti con load().
   * → { proposte, giaImportati, nonContabilizzati, intestatari, iban }
   * Ogni proposta: { ...movimento, y, m, dest, categoria, dubbio, motivo, origine, ricorrente }
   *   dest: 'nec' | 'des' (spesa, o rimborso se l'importo è positivo) | 'entrata' | 'prelievo'
   *         (categoria = fondo dei Risparmi) | 'escludi'
   */
  function analyze(files, budget) {
    const s = budget.settings;
    const imp = s.import;
    const intestatari = [...new Set(files.flatMap(f => f.intestatari))];
    const iban = [...new Set(files.flatMap(f => f.iban))];
    const ownNames = new Set([...imp.conti.intestatari, ...intestatari].map(nameKey).filter(Boolean));
    const ownIban = new Set([...imp.conti.iban, ...iban]);
    const fondi = s.categorie.ris;
    const fondo = fondi.includes(FONDO_PREDEFINITO) ? FONDO_PREDEFINITO : fondi[0] || null;

    let giaImportati = 0;
    const nuovi = [];
    for (const f of files) for (const mv of f.movimenti) {
      if (imp.visti[mv.rif]) giaImportati++;
      else nuovi.push(mv);
    }

    // storni: il movimento annullato ha lo stesso numero di operazione e segno opposto
    const stornati = new Set();
    for (const mv of nuovi) {
      if (!/storno|cancellazione|annullament/i.test(mv.causale + ' ' + mv.testo) || !mv.numero) continue;
      const orig = nuovi.find(x => x !== mv && x.numero === mv.numero && Math.sign(x.importo) !== Math.sign(mv.importo) && !stornati.has(x));
      if (orig) { stornati.add(mv); stornati.add(orig); }
    }

    const used = new Set();
    const proposte = nuovi.map(mv => {
      const p = { ...mv, y: +mv.data.slice(0, 4), m: +mv.data.slice(5, 7) - 1, dest: 'escludi', categoria: '', dubbio: false, motivo: '', origine: 'speciale', ricorrente: false };
      const set = (dest, categoria, motivo, dubbio, origine) => Object.assign(p, { dest, categoria: categoria || '', motivo, dubbio: !!dubbio, origine: origine || p.origine });
      const entrata = mv.importo > 0;
      const hay = up(`${mv.causale} ${mv.nota}`);

      if (stornati.has(mv)) return set('escludi', '', 'Operazione annullata dalla banca (storno)');
      if (/storno/i.test(mv.causale)) return set('escludi', '', 'Storno di un movimento che non è in questo file: se l\'avevi già importato, registralo come rimborso', true);
      if (/\bGIROCONT/.test(hay) || (mv.controparte && ownNames.has(nameKey(mv.controparte))) || (mv.ibanControparte && ownIban.has(mv.ibanControparte.toUpperCase()))) {
        return set('escludi', '', 'Trasferimento tra i tuoi conti');
      }
      const dup = findDuplicate(budget, mv, used);
      if (dup) {
        used.add(dup.id);
        const label = dup.div ? `${dup.categoria}${dup.descrizione ? ' · ' + dup.descrizione : ''}` : (dup.descrizione || 'Entrata');
        return set('escludi', '', `Forse già inserito: «${label}» ${money(dup.importo)} del ${shortIt(dup.data)}`, true);
      }
      if (entrata && /STIPENDIO|PENSIONE/.test(hay)) {
        const m = /STIPENDIO MESE DI\s+([A-Za-z]+)\s+(\d{4})/i.exec(mv.nota);
        p.descrizione = m ? `Stipendio ${m[1].toLowerCase()} ${m[2]}` : 'Stipendio';
        return set('entrata', '', 'Stipendio');
      }

      const rule = learnable(mv.chiave) ? imp.regole[mv.chiave] : null;
      if (rule && !(entrata && rule.dest === 'prelievo') && !(!entrata && rule.dest === 'entrata')) {
        if (rule.dest !== 'prelievo' || fondi.includes(rule.categoria)) {
          return set(rule.dest, rule.categoria, `Come le altre volte per «${mv.chiave}»`, false, 'appresa');
        }
      }

      const hit = !entrata || mv.tipo === 'carta' ? dictionary(mv) : null;
      if (!entrata && Math.abs(mv.importo) >= SOGLIA_PRELIEVO && !(hit && hit.grande) && fondo) {
        const alt = hit ? `${DIV[hit.div].nome} › ${hit.categoria}` : `${DIV[DEFAULT.div].nome} › ${DEFAULT.categoria}`;
        return set('prelievo', fondo, `Importo alto: se l'hai pagato con i risparmi è un prelievo, altrimenti scegli ${alt}`, true, 'grande');
      }
      if (hit) {
        return set(hit.div, hit.categoria, entrata ? `Rimborso da «${hit.parola.trim()}»` : `Riconosciuto da «${hit.parola.trim()}»`, false, 'dizionario');
      }
      if (entrata) {
        return mv.tipo === 'carta'
          ? set(DEFAULT.div, DEFAULT.categoria, 'Accredito sulla carta: probabilmente un rimborso, riduce le spese', true, 'default')
          : set('entrata', '', 'Entrata non riconosciuta: aumenta il budget del mese. Se è un rimborso o un giroconto cambiala', true, 'default');
      }
      return set(DEFAULT.div, DEFAULT.categoria, 'Non riconosciuto', true, 'default');
    });

    proposte.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const nonContabilizzati = files.reduce((n, f) => n + (f.nonContabilizzati || 0), 0);
    return { proposte, giaImportati, nonContabilizzati, intestatari, iban };
  }

  global.BankImport = { BANKS, SOGLIA_PRELIEVO, DEFAULT, load, analyze, learnable, parseCsv, toIso, makeKey };
})(window);
