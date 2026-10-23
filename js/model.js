/*
 * model.js — dati e calcoli: regola 50/30/20, saldi, cuscino (riporti), fondi,
 * obiettivi e conversione da/verso il file Excel annuale.
 *
 * Ogni uscita ha un tipo:
 *   spesa     → usa il budget del mese (per i Risparmi è un accantonamento)
 *   riporto   → usa l'avanzo dei mesi precedenti: non pesa sul budget del mese
 *               (con importo negativo restituisce soldi all'avanzo)
 *   prelievo  → usa soldi già accantonati in un fondo: non pesa né sul budget del
 *               mese né sull'avanzo, riduce il fondo
 * e, facoltativo, `obiettivo` (id): il movimento è una rata, un uso dell'avanzo o
 * una spesa di quell'obiettivo. Gli obiettivi non sono legati alle categorie.
 */
(function (global) {
  'use strict';

  const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

  const DIVISIONI = [
    { key: 'nec', nome: 'Necessità', hint: 'Spese essenziali: affitto, bollette, benzina, spesa' },
    { key: 'des', nome: 'Svago', hint: 'Ciò che non è indispensabile: cene, shopping, vacanze' },
    { key: 'ris', nome: 'Risparmi', hint: 'Fondo di emergenza, pensione, piani a lungo termine' },
  ];
  const KEYS = DIVISIONI.map(d => d.key);
  const DIV = Object.fromEntries(DIVISIONI.map(d => [d.key, d]));
  const GOAL_DIVS = ['des', 'ris'];

  const TIPI = ['spesa', 'riporto', 'prelievo'];
  const TIPO_XLS = { spesa: 'Uscita', riporto: "Dall'avanzo", prelievo: 'Prelievo' };
  const tipoOf = u => (u.tipo === 'riporto' || u.tipo === 'prelievo' ? u.tipo : 'spesa');

  // File annuali: Hose_AAAA.xlsx. Quelli creati prima del cambio di nome
  // (Salvadanaio_AAAA.xlsx) si leggono ancora; gruppo 1 = prefisso, gruppo 2 = anno.
  const FILE_RE = /^(Hose|Salvadanaio)_(\d{4})\.xlsx$/i;
  const fileName = y => `Hose_${y}.xlsx`;

  /* ---------------------------------------------------------------- utilità */

  const r2 = n => (Math.round(n * 100) / 100) || 0;
  const ceil2 = n => (Math.ceil(n * 100 - 1e-6) / 100) || 0; // per le rate: arrotonda per eccesso al centesimo
  const zero = () => ({ nec: 0, des: 0, ris: 0 });
  const add = (a, b) => ({ nec: r2(a.nec + b.nec), des: r2(a.des + b.des), ris: r2(a.ris + b.ris) });
  const total = o => r2(o.nec + o.des + o.ris);
  const sum = arr => r2(arr.reduce((s, x) => s + (Number(x.importo) || 0), 0));
  const uniq = arr => [...new Set(arr)];
  const pad = n => String(n).padStart(2, '0');
  const byDate = arr => [...arr].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  let seq = 0;
  const newId = () => 'x' + Date.now().toString(36) + (seq++).toString(36);

  const norm = s => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function parseAmount(v) {
    if (typeof v === 'number') return r2(v);
    let s = String(v ?? '').trim().replace(/[\s€]/g, '').replace(/^−/, '-');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "3.000" = tremila
    const n = Number(s);
    return isFinite(n) ? r2(n) : NaN;
  }

  const emptyMonth = () => ({ perc: null, entrate: [], uscite: [] });
  const emptyYear = () => ({ riportoIniziale: null, mesi: Array.from({ length: 12 }, emptyMonth) });
  const hasData = mo => !!mo && (mo.entrate.length > 0 || mo.uscite.length > 0);

  /* ------------------------------------------------------------ impostazioni */

  function defaultCategories() {
    return {
      nec: ['Affitto mensile', 'Bollette di luce e gas', 'Benzina', 'Spesa alimentare'],
      des: ['Cene fuori', 'Shopping e abbigliamento', 'Vacanze', 'Abbonamenti in palestra',
        'Abbonamenti per servizi di intrattenimento (Netflix, HBO, Spotify)', 'Generi alimentari non essenziali'],
      ris: ['Fondo di emergenza', 'Investimenti in piani pensionistici', 'Piani finanziari personali a lungo termine',
        'Estinzione anticipata mutuo'],
    };
  }

  // Categorie predefinite della prima versione: se l'elenco non è stato toccato lo aggiorno.
  const OLD_DEFAULTS = {
    nec: ['Mutuo / Affitto', 'Bollette', 'Spesa alimentare', 'Trasporti', 'Assicurazioni', 'Salute'],
    des: ['Cene fuori', 'Shopping', 'Abbonamenti', 'Svago', 'Viaggi', 'Regali'],
    ris: ['Fondo emergenza', 'Investimenti', 'Pensione integrativa'],
  };

  function defaultSettings() {
    return { versione: 3, percentuali: { nec: 50, des: 30, ris: 20 }, categorie: defaultCategories(), obiettivi: [], import: normalizeImport(null) };
  }

  const IMPORT_DESTS = ['nec', 'des', 'entrata', 'prelievo', 'escludi'];

  /**
   * Impostazioni dell'import dalla banca:
   *   regole: { CHIAVE ESERCENTE: { dest, categoria } } — imparate dalle correzioni
   *   conti:  { intestatari, iban } — del titolare, per riconoscere i giroconti
   * I movimenti già importati stanno nei file import/AAAA-MM.json (vedi store.js); il vecchio
   * campo `visti` resta solo finché app.js non li ha spostati lì.
   */
  function normalizeImport(s) {
    const out = { regole: {}, conti: { intestatari: [], iban: [] } };
    if (!s || typeof s !== 'object') return out;
    if (s.regole && typeof s.regole === 'object') {
      for (const [k, r] of Object.entries(s.regole)) {
        if (!k || !r || !IMPORT_DESTS.includes(r.dest)) continue;
        out.regole[k] = r.categoria ? { dest: r.dest, categoria: String(r.categoria) } : { dest: r.dest };
      }
    }
    if (s.visti && typeof s.visti === 'object' && Object.keys(s.visti).length) out.visti = { ...s.visti };
    const strings = a => (Array.isArray(a) ? uniq(a.map(x => String(x).trim()).filter(Boolean)) : []);
    if (s.conti) {
      out.conti.intestatari = strings(s.conti.intestatari);
      out.conti.iban = strings(s.conti.iban).map(x => x.toUpperCase());
    }
    return out;
  }

  function normalizeSettings(s) {
    const d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    const out = { versione: 3, percentuali: { ...d.percentuali }, categorie: {}, obiettivi: [], import: normalizeImport(s.import) };
    if (s.percentuali) {
      const p = KEYS.map(k => Number(s.percentuali[k]));
      if (p.every(isFinite) && Math.abs(p[0] + p[1] + p[2] - 100) < 0.01) KEYS.forEach((k, i) => { out.percentuali[k] = p[i]; });
    }
    for (const k of KEYS) {
      const list = s.categorie && s.categorie[k];
      let cats = Array.isArray(list) ? uniq(list.map(x => String(x).trim()).filter(Boolean)) : d.categorie[k];
      if (!(s.versione >= 2) && cats.length === OLD_DEFAULTS[k].length && cats.every((c, i) => c === OLD_DEFAULTS[k][i])) cats = d.categorie[k];
      out.categorie[k] = cats;
    }
    if (Array.isArray(s.obiettivi)) {
      out.obiettivi = s.obiettivi
        .filter(g => g && g.nome && /^\d{4}-\d{2}/.test(String(g.scadenza || '')))
        .map(g => {
          const goal = {
            id: String(g.id || newId()),
            nome: String(g.nome),
            div: GOAL_DIVS.includes(g.div) ? g.div : 'ris',
            importo: Number(g.importo) || 0,
            scadenza: String(g.scadenza).slice(0, 7),
            iniziale: Number(g.iniziale) || 0,
            rata: Number(g.rata) > 0 ? r2(Number(g.rata)) : 0, // 0 = non ancora pianificata
            creato: g.creato || null,
          };
          // Fino alla versione 2 un obiettivo era legato a una categoria: serve per migrare i movimenti.
          if (!(s.versione >= 3)) goal.legacyCategoria = String(g.categoria || g.nome);
          return goal;
        });
    }
    return out;
  }

  /** Per i dati salvati nel browser (JSON): garantisce la struttura attesa. */
  function normalizeYear(yr) {
    const out = emptyYear();
    if (!yr || !Array.isArray(yr.mesi)) return out;
    if (yr.riportoIniziale) out.riportoIniziale = { ...zero(), ...yr.riportoIniziale };
    yr.mesi.slice(0, 12).forEach((mo, m) => {
      if (!mo) return;
      out.mesi[m] = {
        perc: mo.perc || null,
        entrate: (mo.entrate || []).map(e => ({ ...e, id: e.id || newId() })),
        uscite: (mo.uscite || []).filter(u => KEYS.includes(u.div)).map(u => ({ ...u, id: u.id || newId(), tipo: tipoOf(u) })),
      };
    });
    return out;
  }

  /* ------------------------------------------------------------------ calcoli */

  class Budget {
    constructor() {
      this.settings = defaultSettings();
      this.anni = {};
    }

    years() { return Object.keys(this.anni).map(Number).sort((a, b) => a - b); }

    getMonth(y, m) { return (this.anni[y] && this.anni[y].mesi[m]) || null; }

    /** Crea anno/mese se mancano e "congela" la suddivisione del mese. */
    ensureMonth(y, m) {
      if (!this.anni[y]) this.anni[y] = emptyYear();
      const mo = this.anni[y].mesi[m];
      if (!mo.perc) mo.perc = { ...this.settings.percentuali };
      return mo;
    }

    perc(y, m) {
      const mo = this.getMonth(y, m);
      return (mo && mo.perc) || this.settings.percentuali;
    }

    stats(y, m) {
      const mo = this.getMonth(y, m) || emptyMonth();
      const perc = this.perc(y, m);
      const entrate = sum(mo.entrate);
      const budget = zero(), speso = zero(), saldo = zero(), dalRiporto = zero(), prelievi = zero(), netto = zero();
      const perObiettivi = zero(), accLiberi = zero(), preLiberi = zero(), daObiettivi = zero();
      for (const k of KEYS) {
        const own = mo.uscite.filter(u => u.div === k);
        const free = own.filter(u => !this.goalOf(u));
        budget[k] = r2(entrate * perc[k] / 100);
        speso[k] = sum(own.filter(u => tipoOf(u) === 'spesa'));
        dalRiporto[k] = sum(own.filter(u => tipoOf(u) === 'riporto'));
        prelievi[k] = sum(own.filter(u => tipoOf(u) === 'prelievo'));
        perObiettivi[k] = sum(own.filter(u => tipoOf(u) !== 'prelievo' && this.goalOf(u)));
        accLiberi[k] = sum(free.filter(u => tipoOf(u) !== 'prelievo'));
        preLiberi[k] = sum(free.filter(u => tipoOf(u) === 'prelievo'));
        // soldi tornati liberi da un obiettivo (svincolati): entrano nei risparmi ma non sono nuovi accantonamenti
        daObiettivi[k] = sum(free.filter(u => tipoOf(u) === 'riporto'));
        saldo[k] = r2(budget[k] - speso[k]);
        // Variazione dell'avanzo nel mese. Necessità e Svago: quanto resta del budget meno
        // quanto usato dall'avanzo. Risparmi: quanto accantoni meno i prelievi (sono i
        // risparmi accumulati). I soldi degli obiettivi restano fuori: hanno un fondo loro.
        netto[k] = k === 'ris' ? r2(accLiberi[k] - preLiberi[k]) : r2(saldo[k] - dalRiporto[k]);
      }
      return { y, m, entrate, perc, budget, speso, saldo, dalRiporto, prelievi, netto, perObiettivi, accLiberi, preLiberi, daObiettivi, vuoto: !hasData(mo) };
    }

    yearTotals(y) {
      const fields = ['budget', 'speso', 'saldo', 'dalRiporto', 'prelievi', 'netto', 'perObiettivi', 'accLiberi', 'preLiberi', 'daObiettivi'];
      const t = { entrate: 0 };
      for (const f of fields) t[f] = zero();
      for (let m = 0; m < 12; m++) {
        const s = this.stats(y, m);
        t.entrate = r2(t.entrate + s.entrate);
        for (const f of fields) t[f] = add(t[f], s[f]);
      }
      return t;
    }

    /** Delta dell'anno: di quanto sono cambiati avanzi e risparmi accumulati. */
    delta(y) { return this.yearTotals(y).netto; }

    /**
     * Cuscino all'inizio dell'anno. Se l'anno precedente è caricato si calcola da
     * quello; altrimenti si usa il valore salvato nel foglio "Riepilogo" del file.
     */
    opening(y) {
      if (this.anni[y - 1]) return this.closing(y - 1);
      const own = this.anni[y] && this.anni[y].riportoIniziale;
      if (own) return { ...zero(), ...own };
      const prev = this.years().filter(x => x < y).pop();
      return prev != null ? this.closing(prev) : zero();
    }

    closing(y) { return add(this.opening(y), this.delta(y)); }

    /** Riporto mesi precedenti del mese m: il cuscino accumulato fino al mese prima. */
    riporto(y, m) {
      let r = this.opening(y);
      for (let i = 0; i < m; i++) r = add(r, this.stats(y, i).netto);
      return r;
    }

    /** Avanzo ancora utilizzabile nel mese (avanzo dei mesi precedenti − quanto già usato). */
    disponibile(y, m) {
      const r = this.riporto(y, m), s = this.stats(y, m);
      return { nec: r2(r.nec - s.dalRiporto.nec), des: r2(r.des - s.dalRiporto.des), ris: r2(r.ris - s.dalRiporto.ris) };
    }

    goal(id) { return (id && this.settings.obiettivi.find(g => g.id === id)) || null; }

    goalsOf(div) { return this.settings.obiettivi.filter(g => g.div === div); }

    /** L'obiettivo di un movimento, se esiste ancora. */
    goalOf(u) { const g = this.goal(u.obiettivo); return g && g.div === u.div ? g : null; }

    usage(div, categoria) {
      let n = 0;
      for (const y of this.years()) for (const mo of this.anni[y].mesi) {
        for (const u of mo.uscite) if (u.div === div && u.categoria === categoria && !this.goalOf(u)) n++;
      }
      return n;
    }

    /** Dopo la lettura da Excel: collega i movimenti agli obiettivi tramite il nome. */
    linkGoalNames(yearData) {
      for (const mo of yearData.mesi) for (const u of mo.uscite) {
        if (u.obiettivoNome) {
          const g = this.settings.obiettivi.find(x => x.div === u.div && x.nome === u.obiettivoNome);
          if (g) u.obiettivo = g.id;
        }
        delete u.obiettivoNome;
      }
    }

    /**
     * Migrazione dalla versione 2 (obiettivi legati a una categoria): diventano
     * movimenti dell'obiettivo solo quelli creati dai suoi pulsanti (rata, avanzo,
     * «Usa il fondo») o registrati in una categoria dedicata con il suo nome. Le altre
     * spese della stessa categoria tornano spese normali.
     */
    migrateLegacyGoals() {
      let changed = false;
      for (const g of this.settings.obiettivi) {
        const c = g.legacyCategoria;
        delete g.legacyCategoria;
        if (!c) continue;
        changed = true;
        for (const y of this.years()) for (const mo of this.anni[y].mesi) for (const u of mo.uscite) {
          if (u.div !== g.div || u.obiettivo || u.categoria !== c) continue;
          const t = tipoOf(u);
          const match = c === g.nome
            || (t === 'spesa' && u.descrizione === `Rata ${g.nome}`)
            || (t === 'riporto' && u.descrizione === `Dal riporto per ${g.nome}`)
            || (t === 'prelievo' && u.descrizione === g.nome);
          if (match) { u.obiettivo = g.id; u.categoria = g.nome; }
        }
        const list = this.settings.categorie[g.div];
        if (c === g.nome && list.includes(c) && !this.usage(g.div, c)) list.splice(list.indexOf(c), 1);
      }
      return changed;
    }

    /** Aggiunge alle impostazioni le categorie presenti nei dati ma non in elenco. */
    addMissingCategories(yearData) {
      let changed = false;
      for (const mo of yearData.mesi) for (const u of mo.uscite) {
        const list = this.settings.categorie[u.div];
        if (u.categoria && !list.includes(u.categoria)) { list.push(u.categoria); changed = true; }
      }
      return changed;
    }

    /**
     * Fondi accantonati fino al mese (untilY, untilM) incluso: le categorie dei
     * Risparmi (fondi liberi) e gli obiettivi (fondi vincolati).
     * → [{ div, categoria, obiettivo, iniziale, accantonato, prelevato, saldo }]
     */
    funds(untilY = Infinity, untilM = 11) {
      const map = new Map();
      const get = (div, categoria, obiettivo) => {
        const key = obiettivo ? 'g|' + obiettivo : div + '|' + categoria;
        if (!map.has(key)) map.set(key, { div, categoria, obiettivo: obiettivo || null, iniziale: 0, accantonato: 0, prelevato: 0, saldo: 0 });
        return map.get(key);
      };
      for (const g of this.settings.obiettivi) get(g.div, g.nome, g.id).iniziale = g.iniziale || 0;
      for (const y of this.years()) {
        if (y > untilY) break;
        this.anni[y].mesi.forEach((mo, m) => {
          if (y === untilY && m > untilM) return;
          for (const u of mo.uscite) {
            const g = this.goalOf(u);
            if (!g && u.div !== 'ris') continue; // in Necessità e Svago solo gli obiettivi sono fondi
            const f = g ? get(g.div, g.nome, g.id) : get(u.div, u.categoria, null);
            if (tipoOf(u) === 'prelievo') f.prelevato = r2(f.prelevato + u.importo);
            else f.accantonato = r2(f.accantonato + u.importo);
          }
        });
      }
      const out = [...map.values()];
      for (const f of out) f.saldo = r2(f.iniziale + f.accantonato - f.prelevato);
      return out.filter(f => f.iniziale || f.accantonato || f.prelevato)
        .sort((a, b) => KEYS.indexOf(a.div) - KEYS.indexOf(b.div) || (a.obiettivo ? 1 : 0) - (b.obiettivo ? 1 : 0) || b.saldo - a.saldo);
    }

    /** Saldo di un fondo libero (categoria dei Risparmi, senza obiettivo). */
    fundBalance(div, categoria) {
      const f = this.funds().find(x => x.div === div && x.categoria === categoria && !x.obiettivo);
      return f ? f.saldo : 0;
    }

    /** Stato di un obiettivo rispetto al mese di riferimento ref = { y, m }. */
    goalStatus(g, ref) {
      const div = g.div || 'ris';
      let prima = g.iniziale || 0, mese = 0, dopo = 0, dalRiporto = 0, prelevato = 0, svincolato = 0;
      for (const y of this.years()) {
        this.anni[y].mesi.forEach((mo, m) => {
          for (const u of mo.uscite) {
            if (!g.id || u.obiettivo !== g.id || u.div !== div) continue;
            const t = tipoOf(u);
            if (t === 'prelievo') { prelevato += u.importo; continue; }
            // "riporto" positivo: soldi aggiunti dall'avanzo o dai risparmi;
            // negativo: soldi svincolati, tornati disponibili per altre spese.
            if (t === 'riporto') { if (u.importo < 0) svincolato -= u.importo; else dalRiporto += u.importo; }
            const before = y < ref.y || (y === ref.y && m < ref.m);
            const now = y === ref.y && m === ref.m;
            // Quanto preso dal riporto nel mese corrente abbassa subito la rata.
            if (before || (now && t === 'riporto')) prima += u.importo;
            else if (now) mese += u.importo;
            else dopo += u.importo;
          }
        });
      }
      const accantonato = r2(prima + mese + dopo);
      const [sy, sm] = g.scadenza.split('-').map(Number);
      // Mesi utili per accantonare: dal mese corrente (incluso) al mese prima della scadenza.
      const mesi = (sy - ref.y) * 12 + (sm - 1 - ref.m);
      const residuo = r2(Math.max(0, g.importo - prima));
      const stato = g.importo > 0 && accantonato >= g.importo - 0.004 ? 'raggiunto' : mesi < 0 ? 'scaduto' : 'attivo';
      const attivo = stato === 'attivo';

      // La rata è fissa (quella pianificata), non si ricalcola da sola: se accantoni di più
      // o di meno l'app propone di cambiarla o di spostare la scadenza.
      const necessariaOra = attivo ? ceil2(residuo / Math.max(1, mesi)) : 0;
      const rata = attivo ? (g.rata > 0 ? r2(g.rata) : necessariaOra) : 0;
      const quota = attivo ? r2(Math.min(rata, residuo)) : 0; // rata di questo mese

      // Proiezione: se la rata del mese è già versata si guarda dal mese prossimo.
      const TOLL = 0.05; // pochi centesimi di differenza (arrotondamenti) non contano
      const pagato = attivo && mese >= quota - TOLL;
      const restante = attivo ? r2(Math.max(0, residuo - (pagato ? mese : 0))) : 0;
      const mesiUtili = attivo ? Math.max(pagato ? 0 : 1, mesi - (pagato ? 1 : 0)) : 0;
      const necessaria = attivo ? (restante <= 0 ? 0 : ceil2(restante / Math.max(1, mesiUtili))) : 0;
      const mesiNecessari = attivo && rata > 0 ? Math.ceil(restante / rata - 1e-9) : 0;
      const prontoIdx = ref.y * 12 + ref.m + (pagato ? 1 : 0) + mesiNecessari;
      const pronto = `${Math.floor(prontoIdx / 12)}-${pad((prontoIdx % 12) + 1)}`;
      const scartoMesi = attivo ? mesiUtili - mesiNecessari : 0; // > 0 in anticipo, < 0 in ritardo
      let piano = 'linea';
      if (attivo && restante > 0) {
        if (scartoMesi < 0) piano = 'ritardo';
        // "in anticipo" solo se arrivi almeno un mese prima o la rata potrebbe scendere di almeno il 10%
        else if (scartoMesi > 0 || necessaria < rata * 0.9) piano = 'anticipo';
      }

      return {
        div, accantonato, prima: r2(prima), mese: r2(mese), residuo, mesi, quota, stato,
        rata, necessaria, necessariaOra, mesiNecessari, pronto, scartoMesi, piano,
        dalRiporto: r2(dalRiporto), svincolato: r2(svincolato), prelevato: r2(prelevato), fondo: r2(accantonato - prelevato),
        mancante: r2(Math.max(0, g.importo - accantonato)),
        mancanteMese: attivo && quota - mese > TOLL ? r2(quota - mese) : 0,
        progress: g.importo > 0 ? Math.min(1, accantonato / g.importo) : 0,
      };
    }

    toJSON() { return { settings: this.settings, anni: this.anni }; }
  }

  /* ------------------------------------------------------- Excel: scrittura */

  const HEADERS = ['Tipo', 'Data', 'Suddivisione', 'Categoria', 'Descrizione', 'Importo', 'Ricorrente', 'Obiettivo'];
  const SUMMARY_ROWS = ['Percentuale', 'Budget', 'Speso / accantonato (budget del mese)', 'Saldo del mese',
    'Avanzo / risparmi dei mesi precedenti', 'Variazione del mese', 'Avanzo / risparmi a fine mese',
    "Usato dall'avanzo / spostato agli obiettivi", 'Prelievi dai fondi', 'Messi da parte per obiettivi'];
  // Riepilogo del mese: etichette in colonna J, Necessità/Svago/Risparmi in K–M, totale in N.
  const LC = 10, VC = 11;

  function yearToXlsx(model, y, activeMonth) {
    const X = global.XlsxLite;
    const S = X.STYLE;
    const col = X.colName;
    const year = model.anni[y] || emptyYear();
    const opening = model.opening(y);

    const rip = new X.Sheet('Riepilogo');
    const sheets = [rip];

    for (let m = 0; m < 12; m++) {
      const mo = year.mesi[m];
      const st = model.stats(y, m);
      const riporto = model.riporto(y, m);
      const sh = new X.Sheet(MESI[m]);
      sh.set(1, 1, `${MESI[m]} ${y}`, S.title);
      HEADERS.forEach((h, i) => sh.set(3, i + 1, h, S.header));

      let r = 4;
      const row = (tipo, it, divName, cat, goalName) => {
        sh.set(r, 1, tipo);
        sh.set(r, 2, X.dateToSerial(it.data), S.date);
        sh.set(r, 3, divName);
        sh.set(r, 4, cat);
        sh.set(r, 5, it.descrizione || '');
        sh.set(r, 6, it.importo, S.money);
        sh.set(r, 7, it.ricorrente ? 'Sì' : '');
        sh.set(r, 8, goalName || '');
        r++;
      };
      for (const e of byDate(mo.entrate)) row('Entrata', e, '', '');
      for (const k of KEYS) {
        for (const u of byDate(mo.uscite.filter(u => u.div === k))) {
          const g = model.goalOf(u);
          row(TIPO_XLS[tipoOf(u)], u, DIV[k].nome, g ? g.nome : u.categoria, g ? g.nome : '');
        }
      }

      // Riepilogo del mese, con formule "vive" e valore già calcolato.
      const first = col(VC), last = col(VC + 2);
      sh.set(2, LC, 'Entrate del mese', S.bold);
      sh.set(2, VC, st.entrate, S.moneyBold, 'SUMIFS(F:F,A:A,"Entrata")');
      sh.set(3, LC, '', S.header);
      [...KEYS.map(k => DIV[k].nome), 'Totale'].forEach((h, i) => sh.set(3, VC + i, h, S.header));
      SUMMARY_ROWS.forEach((h, i) => sh.set(4 + i, LC, h, S.bold));
      KEYS.forEach((k, i) => {
        const c = VC + i, L = col(c);
        // goal: '' = movimenti senza obiettivo, '<>' = movimenti di un obiettivo
        const sumif = (tipo, goal) => `SUMIFS($F:$F,$A:$A,"${tipo}",$C:$C,${L}$3${goal != null ? `,$H:$H,"${goal}"` : ''})`;
        sh.set(4, c, st.perc[k] / 100, S.percent);
        sh.set(5, c, st.budget[k], S.money, `$${first}$2*${L}4`);
        sh.set(6, c, st.speso[k], S.money, sumif(TIPO_XLS.spesa));
        sh.set(7, c, st.saldo[k], S.moneyBold, `${L}5-${L}6`);
        sh.set(8, c, riporto[k], S.money, m === 0 ? `Riepilogo!${col(2 + i)}19` : `${MESI[m - 1]}!${L}10`);
        sh.set(9, c, st.netto[k], S.money, k === 'ris'
          ? `${sumif(TIPO_XLS.spesa, '')}+${sumif(TIPO_XLS.riporto, '')}-${sumif(TIPO_XLS.prelievo, '')}`
          : `${L}7-${L}11`);
        sh.set(10, c, r2(riporto[k] + st.netto[k]), S.moneyBold, `${L}8+${L}9`);
        sh.set(11, c, st.dalRiporto[k], S.money, sumif(TIPO_XLS.riporto));
        sh.set(12, c, st.prelievi[k], S.money, sumif(TIPO_XLS.prelievo));
        sh.set(13, c, st.perObiettivi[k], S.money, `${sumif(TIPO_XLS.spesa, '<>')}+${sumif(TIPO_XLS.riporto, '<>')}`);
      });
      sh.set(4, VC + 3, 1, S.percent, `SUM(${first}4:${last}4)`);
      const totals = { 5: st.budget, 6: st.speso, 7: st.saldo, 8: riporto, 9: st.netto, 10: add(riporto, st.netto), 11: st.dalRiporto, 12: st.prelievi, 13: st.perObiettivi };
      for (let rr = 5; rr <= 13; rr++) {
        sh.set(rr, VC + 3, total(totals[rr]), rr === 7 || rr === 10 ? S.moneyBold : S.money, `SUM(${first}${rr}:${last}${rr})`);
      }
      sh.set(15, LC, 'Per i Risparmi l\'avanzo è il totale dei risparmi accumulati: cresce con gli accantonamenti e cala con i prelievi. I soldi degli obiettivi sono esclusi.', S.note);

      [11, 12, 14, 26, 34, 13, 11, 22, 3, 27, 13, 13, 13, 13].forEach((w, i) => sh.width(i + 1, w));
      sheets.push(sh);
    }

    // Foglio Riepilogo: totali mensili + contatori dell'anno.
    rip.set(1, 1, `Riepilogo ${y}`, S.title);
    const head = ['Mese', 'Entrate'];
    for (const k of KEYS) head.push(`Budget ${DIV[k].nome}`, `Speso ${DIV[k].nome}`, `Saldo ${DIV[k].nome}`);
    head.push('Saldo totale');
    head.forEach((h, i) => rip.set(3, i + 1, h, S.header));

    const yt = model.yearTotals(y);
    for (let m = 0; m < 12; m++) {
      const r = 4 + m, st = model.stats(y, m), mn = MESI[m];
      rip.set(r, 1, mn);
      rip.set(r, 2, st.entrate, S.money, `${mn}!${col(VC)}2`);
      KEYS.forEach((k, i) => {
        const base = 3 + i * 3, L = col(VC + i);
        rip.set(r, base, st.budget[k], S.money, `${mn}!${L}5`);
        rip.set(r, base + 1, st.speso[k], S.money, `${mn}!${L}6`);
        rip.set(r, base + 2, st.saldo[k], S.money, `${mn}!${L}7`);
      });
      rip.set(r, 12, total(st.saldo), S.moneyBold, `E${r}+H${r}+K${r}`);
    }
    rip.set(16, 1, 'Totale anno', S.bold);
    rip.set(16, 2, yt.entrate, S.moneyBold, 'SUM(B4:B15)');
    KEYS.forEach((k, i) => {
      const base = 3 + i * 3;
      [yt.budget[k], yt.speso[k], yt.saldo[k]].forEach((v, j) => {
        const L = col(base + j);
        rip.set(16, base + j, v, S.moneyBold, `SUM(${L}4:${L}15)`);
      });
    });
    rip.set(16, 12, total(yt.saldo), S.moneyBold, 'SUM(L4:L15)');

    const delta = yt.netto;
    const closing = add(opening, delta);
    const across = cell => 'SUM(' + MESI.map(mn => `${mn}!${cell}`).join(',') + ')';
    ['Avanzi e risparmi', ...KEYS.map(k => DIV[k].nome), 'Totale'].forEach((h, i) => rip.set(18, i + 1, h, S.header));
    rip.set(19, 1, 'Avanzo iniziale (anni precedenti)', S.bold);
    rip.set(20, 1, 'Delta anno', S.bold);
    rip.set(21, 1, 'Avanzo finale', S.bold);
    rip.set(23, 1, "Usato dall'avanzo / spostato agli obiettivi", S.bold);
    rip.set(24, 1, 'Prelievi dai fondi', S.bold);
    rip.set(25, 1, 'Messi da parte per obiettivi', S.bold);
    KEYS.forEach((k, i) => {
      const c = 2 + i, L = col(c), ML = col(VC + i);
      rip.set(19, c, opening[k], S.money);
      rip.set(20, c, delta[k], S.moneyBold, across(`${ML}9`));
      rip.set(21, c, closing[k], S.moneyBold, `${L}19+${L}20`);
      rip.set(23, c, yt.dalRiporto[k], S.money, across(`${ML}11`));
      rip.set(24, c, yt.prelievi[k], S.money, across(`${ML}12`));
      rip.set(25, c, yt.perObiettivi[k], S.money, across(`${ML}13`));
    });
    [[19, opening], [20, delta], [21, closing], [23, yt.dalRiporto], [24, yt.prelievi], [25, yt.perObiettivi]].forEach(([r, v]) => {
      rip.set(r, 5, total(v), r === 20 || r === 21 ? S.moneyBold : S.money, `SUM(B${r}:D${r})`);
    });
    rip.set(27, 1, 'File generato dall\'app Hose (regola 50/30/20): inserisci e modifica i dati dall\'app. L\'avanzo iniziale serve se il file dell\'anno precedente non è presente. Per i Risparmi l\'avanzo è il totale dei risparmi accumulati (obiettivi esclusi).', S.note);
    [34, 14, 16, 16, 16, 16, 16, 16, 16, 16, 16, 14].forEach((w, i) => rip.width(i + 1, w));

    return X.write(sheets, {
      activeSheet: activeMonth != null ? activeMonth + 1 : 0,
      title: `Hose ${y}`,
    });
  }

  /* --------------------------------------------------------- Excel: lettura */

  const DIV_BY_NAME = { necessita: 'nec', svago: 'des', desideri: 'des', desiderio: 'des', risparmi: 'ris', risparmio: 'ris' };
  const TIPO_BY_NAME = {
    uscita: 'spesa', spesa: 'spesa', "dall'avanzo": 'riporto', 'dall\u2019avanzo': 'riporto',
    'dal riporto': 'riporto', riporto: 'riporto', prelievo: 'prelievo',
  };

  function toIso(v, y, m) {
    if (typeof v === 'number' && isFinite(v)) return global.XlsxLite.serialToDate(v);
    const s = String(v ?? '').trim();
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (r) return `${r[1]}-${pad(+r[2])}-${pad(+r[3])}`;
    r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (r) return `${r[3].length === 2 ? '20' + r[3] : r[3]}-${pad(+r[2])}-${pad(+r[1])}`;
    return `${y}-${pad(m + 1)}-01`;
  }

  function toPct(v) {
    const n = typeof v === 'number' ? v : parseAmount(String(v ?? '').replace('%', ''));
    if (!isFinite(n)) return NaN;
    return typeof v === 'number' && n <= 1.5 ? r2(n * 100) : r2(n);
  }

  const isYes = v => v === true || ['si', 'sì', 'x', 'yes', '1', 'true'].includes(norm(v));
  const str = v => (v == null ? '' : String(v).trim());

  function monthFromRows(rows, y, m) {
    const mo = emptyMonth();
    let hr = rows.findIndex(r => r && norm(r[0]) === 'tipo');
    const header = hr >= 0 ? Array.from(rows[hr], norm) : HEADERS.map(norm);
    if (hr < 0) hr = 2;
    const ci = name => header.indexOf(name);
    const c = {
      tipo: ci('tipo'), data: ci('data'), div: ci('suddivisione'), cat: ci('categoria'),
      desc: ci('descrizione'), imp: ci('importo'), ric: ci('ricorrente'), goal: ci('obiettivo'),
    };

    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const tipo = norm(r[c.tipo]);
      if (tipo !== 'entrata' && !TIPO_BY_NAME[tipo]) continue;
      const importo = parseAmount(r[c.imp]);
      if (!isFinite(importo)) continue;
      const item = { id: newId(), data: toIso(r[c.data], y, m), descrizione: str(r[c.desc]), importo, ricorrente: isYes(r[c.ric]) };
      if (tipo === 'entrata') {
        mo.entrate.push(item);
      } else {
        const div = DIV_BY_NAME[norm(r[c.div])];
        if (!div) continue;
        item.div = div;
        item.tipo = TIPO_BY_NAME[tipo];
        item.categoria = str(r[c.cat]) || 'Altro';
        const goalName = str(r[c.goal]);
        if (goalName) item.obiettivoNome = goalName; // collegato all'id da Budget.linkGoalNames
        mo.uscite.push(item);
      }
    }

    if (hasData(mo)) {
      for (const r of rows) {
        if (!r) continue;
        const j = Array.from(r).findIndex(v => norm(v) === 'percentuale');
        if (j < 0) continue;
        const p = [r[j + 1], r[j + 2], r[j + 3]].map(toPct);
        if (p.every(isFinite) && Math.abs(p[0] + p[1] + p[2] - 100) < 0.5) mo.perc = { nec: p[0], des: p[1], ris: p[2] };
        break;
      }
    }
    return mo;
  }

  async function readWorkbook(buffer) { return global.XlsxLite.read(buffer); }

  /** Prova a capire l'anno dal contenuto (titolo "Riepilogo 2026" o "Ottobre 2026"). */
  function detectYear(wb) {
    for (const s of wb.sheets) {
      const a1 = s.rows[0] && s.rows[0][0];
      const r = /(19|20)\d{2}/.exec(String(a1 ?? ''));
      if (r) return Number(r[0]);
    }
    return null;
  }

  function yearFromWorkbook(wb, y) {
    const year = emptyYear();
    let found = 0;
    for (let m = 0; m < 12; m++) {
      const sh = wb.sheet(MESI[m]);
      if (!sh) continue;
      found++;
      year.mesi[m] = monthFromRows(sh.rows, y, m);
    }
    const rip = wb.sheet('Riepilogo');
    if (rip) {
      for (const r of rip.rows) {
        if (!r || !/^(riporto|avanzo) iniziale/.test(norm(r[0]))) continue;
        const v = [r[1], r[2], r[3]].map(parseAmount);
        if (v.every(isFinite)) year.riportoIniziale = { nec: v[0], des: v[1], ris: v[2] };
        break;
      }
    }
    if (!found) throw new Error('nessun foglio mensile trovato (attesi i fogli Gennaio … Dicembre)');
    return year;
  }

  /* ------------------------------------------------------------- CSV export */

  function yearToCsv(model, y) {
    const lines = [['Mese', 'Tipo', 'Data', 'Suddivisione', 'Categoria', 'Descrizione', 'Importo', 'Ricorrente', 'Obiettivo']];
    const year = model.anni[y] || emptyYear();
    const itDate = s => s.split('-').reverse().join('/');
    const amount = n => n.toFixed(2).replace('.', ',');
    year.mesi.forEach((mo, m) => {
      for (const e of byDate(mo.entrate)) lines.push([MESI[m], 'Entrata', itDate(e.data), '', '', e.descrizione, amount(e.importo), e.ricorrente ? 'Sì' : '']);
      for (const k of KEYS) for (const u of byDate(mo.uscite.filter(u => u.div === k))) {
        const g = model.goalOf(u);
        lines.push([MESI[m], TIPO_XLS[tipoOf(u)], itDate(u.data), DIV[k].nome, g ? g.nome : u.categoria, u.descrizione, amount(u.importo), u.ricorrente ? 'Sì' : '', g ? g.nome : '']);
      }
    });
    const cell = v => {
      const s = String(v ?? '');
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + lines.map(l => l.map(cell).join(';')).join('\r\n');
  }

  global.Model = {
    MESI, DIVISIONI, KEYS, DIV, GOAL_DIVS, TIPI, FILE_RE,
    Budget, defaultSettings, normalizeSettings, normalizeYear, tipoOf,
    emptyMonth, emptyYear, hasData, newId, parseAmount, norm, r2, add, total, zero, byDate,
    fileName, yearToXlsx, readWorkbook, detectYear, yearFromWorkbook, yearToCsv,
  };
})(window);
