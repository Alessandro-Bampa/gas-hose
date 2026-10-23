/*
 * app.js — interfaccia: viste (Mese, Riepilogo, Obiettivi, Impostazioni),
 * dialoghi di inserimento, salvataggio automatico, import/export.
 */
(function () {
  'use strict';

  const { MESI, KEYS, DIV } = Model;
  const budget = new Model.Budget();

  const $app = document.getElementById('app');
  const $dialog = document.getElementById('dialog');
  const $status = document.getElementById('save-status');
  const $import = document.getElementById('import-input');
  let tooltip = null;

  const state = {
    ready: false,
    dirtyYears: new Set(),
    dirtySettings: false,
    saving: false,
    saveState: 'idle', // idle | pending | saving | saved | error
    savedAt: null,
    yearErrors: {},    // { anno: 'messaggio' } — file non leggibili: mai sovrascritti
  };

  /* ================================================================ utilità */

  const fmtEur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
  const eur = n => fmtEur.format(Math.abs(n) < 0.005 ? 0 : n);
  const signed = n => (n > 0.004 ? '+' : '') + eur(n);
  const pctTxt = n => (Math.round(n * 10) / 10).toLocaleString('it-IT') + '%';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const shortDate = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const monthLabel = (y, m) => `${MESI[m]} ${y}`;
  const monthHref = (y, m) => `#/mese/${y}/${m + 1}`;
  const moneyInput = n => (n || n === 0 ? n.toFixed(2).replace('.', ',') : '');
  const r2 = Model.r2;

  function today() {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  }
  const isoToday = () => { const t = today(); return iso(t.y, t.m, t.d); };

  function shiftMonth(y, m, delta) {
    const t = y * 12 + m + delta;
    return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
  }

  function defaultDate(y, m) {
    const t = today();
    return t.y === y && t.m === m ? iso(y, m, t.d) : iso(y, m, 1);
  }

  const tone = (k, v) => (v < -0.004 ? (k === 'ris' ? 'extra' : 'neg') : v > 0.004 && k !== 'ris' ? 'pos' : '');

  const ICONS = {
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  };
  const icon = name => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function toast(msg, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' error' : '');
    const span = document.createElement('span');
    span.textContent = msg;
    el.append(span);
    if (opts.action) {
      const b = document.createElement('button');
      b.textContent = opts.action.label;
      b.addEventListener('click', () => { opts.action.fn(); el.remove(); });
      el.append(b);
    }
    document.getElementById('toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, opts.ms || (opts.error ? 7000 : 4000));
  }

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ============================================================ salvataggio */

  let saveTimer = null;

  function markDirty(y) {
    for (const yy of budget.years()) if (yy >= y && !state.yearErrors[yy]) state.dirtyYears.add(yy);
    scheduleSave();
  }
  function markSettings() { state.dirtySettings = true; scheduleSave(); }
  const hasPending = () => state.dirtyYears.size > 0 || state.dirtySettings || state.saving;

  function scheduleSave() {
    state.saveState = 'pending';
    renderStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 450);
  }

  function describeError(e) {
    const name = e && e.name;
    if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') return 'il file potrebbe essere aperto in Excel: chiudilo e premi «Riprova».';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'permesso di scrittura negato: ricarica la pagina e riconnetti la cartella.';
    if (name === 'NotFoundError') return 'la cartella non esiste più: sceglila di nuovo dalle Impostazioni.';
    if (name === 'QuotaExceededError') return 'spazio del browser esaurito: esporta i dati e passa al salvataggio su cartella.';
    return (e && e.message) || String(e);
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (state.saving) { saveTimer = setTimeout(flush, 300); return; }
    if (!state.dirtyYears.size && !state.dirtySettings) {
      if (state.saveState === 'pending') state.saveState = 'saved';
      renderStatus();
      return;
    }
    state.saving = true;
    state.saveState = 'saving';
    renderStatus();
    try {
      if (Store.mode === 'folder') {
        if (state.dirtySettings) {
          state.dirtySettings = false;
          try { await Store.writeFile(Store.SETTINGS_FILE, JSON.stringify(budget.settings, null, 2)); }
          catch (e) { state.dirtySettings = true; throw e; }
        }
        const t = today();
        for (const y of [...state.dirtyYears].sort()) {
          state.dirtyYears.delete(y);
          try { await Store.writeFile(Model.fileName(y), Model.yearToXlsx(budget, y, y === t.y ? t.m : null)); }
          catch (e) { state.dirtyYears.add(y); throw e; }
        }
      } else {
        state.dirtySettings = false;
        state.dirtyYears.clear();
        Store.saveBrowser(budget.toJSON());
      }
      state.saveState = 'saved';
      state.savedAt = new Date();
    } catch (e) {
      console.error(e);
      state.saveState = 'error';
      toast('Salvataggio non riuscito: ' + describeError(e), { error: true, action: { label: 'Riprova', fn: flush } });
    } finally {
      state.saving = false;
      renderStatus();
    }
  }

  window.addEventListener('beforeunload', e => {
    if (hasPending()) { flush(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && hasPending()) flush(); });

  function renderStatus() {
    if (!Store.mode || !state.ready) { $status.innerHTML = ''; return; }
    const where = Store.mode === 'folder'
      ? `<span class="where" title="Dati salvati nella cartella «${esc(Store.folderName())}»">${icon('folder')}${esc(Store.folderName())}</span>`
      : `<span class="where" title="Dati salvati in questo browser">${icon('globe')}Browser</span>`;
    let txt = '';
    if (state.saveState === 'pending' || state.saveState === 'saving') txt = 'Salvataggio…';
    else if (state.saveState === 'saved' && state.savedAt) txt = 'Salvato alle ' + state.savedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    else if (state.saveState === 'error') txt = 'Non salvato';
    $status.innerHTML = `${where}<span class="dot ${state.saveState}"></span><span class="txt">${esc(txt)}</span>` +
      (state.saveState === 'error' ? '<button class="link" data-action="retry-save">Riprova</button>' : '');
  }

  /* ============================================================= caricamento */

  async function loadData() {
    budget.anni = {};
    state.yearErrors = {};
    state.dirtyYears.clear();
    state.dirtySettings = false;
    if (Store.mode === 'folder') {
      const res = await Store.readFolder();
      if (res.settingsError) toast('impostazioni.json non leggibile: uso le impostazioni predefinite.', { error: true });
      budget.settings = Model.normalizeSettings(res.settings);
      for (const f of res.years) {
        try {
          const wb = await Model.readWorkbook(f.buffer);
          budget.anni[f.year] = Model.yearFromWorkbook(wb, f.year);
          budget.linkGoalNames(budget.anni[f.year]);
        } catch (e) {
          console.error(e);
          state.yearErrors[f.year] = `${f.name}: ${e.message}`;
        }
      }
      if (!res.settings && !res.settingsError) markSettings();
      migrateSettings(res.settings);
      // file col nome precedente (Salvadanaio_AAAA.xlsx): si riscrive subito come Hose_AAAA.xlsx
      const legacy = res.years.filter(f => f.legacy && budget.anni[f.year]);
      if (legacy.length) {
        for (const f of legacy) markDirty(f.year);
        toast(`Ho copiato ${legacy.map(f => f.name).join(', ')} in ${legacy.map(f => Model.fileName(f.year)).join(', ')}: il vecchio file non viene più usato e puoi eliminarlo.`, { ms: 12000 });
      }
      return res;
    }
    const data = Store.loadBrowser();
    budget.settings = Model.normalizeSettings(data && data.settings);
    if (data && data.anni) for (const [y, yr] of Object.entries(data.anni)) budget.anni[y] = Model.normalizeYear(yr);
    migrateSettings(data && data.settings);
    return null;
  }

  // Impostazioni di versioni precedenti: categorie predefinite aggiornate (v1) e
  // obiettivi non più legati alle categorie (v2).
  function migrateSettings(raw) {
    if (!raw || raw.versione >= 3) return;
    if (!(raw.versione >= 2)) for (const y of budget.years()) budget.addMissingCategories(budget.anni[y]);
    if (budget.migrateLegacyGoals()) for (const y of budget.years()) markDirty(y);
    markSettings();
  }

  // Obiettivi senza rata pianificata (versioni precedenti): fisso quella necessaria oggi.
  function planLegacyGoals() {
    const t = today();
    let changed = false;
    for (const g of budget.settings.obiettivi) {
      if (g.rata > 0) continue;
      const s = budget.goalStatus(g, t);
      if (s.stato !== 'attivo') continue;
      g.rata = s.necessariaOra;
      changed = true;
    }
    if (changed) markSettings();
  }

  async function enterApp() {
    try {
      await loadData();
    } catch (e) {
      console.error(e);
      toast('Errore nel caricamento dei dati: ' + describeError(e), { error: true });
    }
    planLegacyGoals();
    state.ready = true;
    document.body.classList.remove('gated');
    render();
    const errs = Object.values(state.yearErrors);
    if (errs.length) toast(`Alcuni file non sono leggibili (${errs.length}): non verranno modificati.`, { error: true });
  }

  async function chooseFolder() {
    if (!Store.supportsFolder) {
      toast('Questo browser non può salvare nelle cartelle: usa Chrome o Edge.', { error: true });
      return;
    }
    if (state.ready && hasPending()) await flush();
    const hadData = state.ready && budget.years().length > 0;
    const snapshot = hadData ? JSON.parse(JSON.stringify(budget.toJSON())) : null;
    try {
      await Store.pickFolder();
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('Impossibile usare la cartella: ' + describeError(e), { error: true });
      return;
    }
    await enterApp();
    const folderEmpty = budget.years().length === 0 && !Object.keys(state.yearErrors).length;
    if (snapshot && folderEmpty) {
      budget.settings = Model.normalizeSettings(snapshot.settings);
      for (const [y, yr] of Object.entries(snapshot.anni)) budget.anni[y] = Model.normalizeYear(yr);
      markSettings();
      for (const y of budget.years()) markDirty(y);
      render();
      toast(`Dati copiati nella cartella «${Store.folderName()}».`);
    } else if (snapshot) {
      toast(`Caricati i dati presenti nella cartella «${Store.folderName()}».`);
    }
  }

  /* ================================================================= routing */

  function route() {
    const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const t = today();
    if (p[0] === 'mese') {
      const y = Number(p[1]), m = Number(p[2]) - 1;
      if (y > 1900 && y < 3000 && m >= 0 && m < 12) return { view: 'mese', y, m };
      return { view: 'mese', y: t.y, m: t.m };
    }
    if (p[0] === 'riepilogo') {
      const y = Number(p[1]);
      return { view: 'riepilogo', y: y > 1900 && y < 3000 ? y : t.y };
    }
    if (p[0] === 'obiettivi') return { view: 'obiettivi' };
    if (p[0] === 'impostazioni') return { view: 'impostazioni' };
    return { view: 'mese', y: t.y, m: t.m };
  }

  let pendingCharts = [];

  function render() {
    if (!state.ready) return;
    if (tooltip) tooltip.hide();
    const r = route();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r.view));
    pendingCharts = [];
    let html;
    if (r.view === 'mese') html = viewMese(r.y, r.m);
    else if (r.view === 'riepilogo') html = viewRiepilogo(r.y);
    else if (r.view === 'obiettivi') html = viewObiettivi();
    else html = viewImpostazioni();
    $app.innerHTML = html;
    for (const [id, spec] of pendingCharts) {
      const el = document.getElementById(id);
      if (el) Charts.mount(el, spec);
    }
    document.title = r.view === 'mese' ? `${monthLabel(r.y, r.m)} · Hose` : 'Hose';
    renderStatus();
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  /* ============================================================= vista: mese */

  function recurringSource(y, m) {
    for (let i = 1; i <= 12; i++) {
      const p = shiftMonth(y, m, -i);
      const mo = budget.getMonth(p.y, p.m);
      if (!Model.hasData(mo)) continue;
      const entrate = mo.entrate.filter(e => e.ricorrente);
      const uscite = mo.uscite.filter(u => u.ricorrente);
      return entrate.length + uscite.length ? { ...p, entrate, uscite } : null;
    }
    return null;
  }

  function viewMese(y, m) {
    const t = today();
    const st = budget.stats(y, m);
    const rip = budget.riporto(y, m);
    const mo = budget.getMonth(y, m) || Model.emptyMonth();
    const prev = shiftMonth(y, m, -1), next = shiftMonth(y, m, 1);
    const isNow = y === t.y && m === t.m;
    const locked = state.yearErrors[y];

    let h = `<div class="month-head">
      <a class="icon-btn" href="${monthHref(prev.y, prev.m)}" aria-label="Mese precedente" title="${monthLabel(prev.y, prev.m)}">${icon('left')}</a>
      <div class="month-title"><h1>${MESI[m]} <span>${y}</span></h1>${isNow ? '<span class="pill now">Mese corrente</span>' : ''}</div>
      <a class="icon-btn" href="${monthHref(next.y, next.m)}" aria-label="Mese successivo" title="${monthLabel(next.y, next.m)}">${icon('right')}</a>
      <div class="month-tools">
        ${isNow ? '' : '<a class="btn ghost sm" href="#/">Torna al mese corrente</a>'}
        <input type="month" class="month-jump" value="${y}-${pad(m + 1)}" data-change="jump-month" aria-label="Vai a un mese">
      </div>
    </div>`;

    if (locked) {
      h += `<div class="banner error">${icon('alert')}<p><strong>Il file di quest'anno non è leggibile</strong>, quindi è protetto da modifiche.<br><span class="small">${esc(locked)}</span></p></div>`;
    } else if (st.vuoto) {
      const src = recurringSource(y, m);
      if (src) {
        const n = src.entrate.length + src.uscite.length;
        const names = [...src.entrate.map(e => e.descrizione || 'Entrata'), ...src.uscite.map(u => u.categoria)].slice(0, 4).join(', ');
        h += `<div class="banner">${icon('repeat')}<p><strong>${n} ${n === 1 ? 'voce ricorrente' : 'voci ricorrenti'}</strong> a ${monthLabel(src.y, src.m).toLowerCase()}: ${esc(names)}${n > 4 ? '…' : ''}</p>
          <button class="btn primary sm" data-action="copy-recurring">${icon('copy')} Copia in ${MESI[m].toLowerCase()}</button></div>`;
      }
    }

    h += incomeCard(st, mo, locked);
    h += `<div class="divisions">${KEYS.map(k => divisionCard(y, m, k, st, rip, mo, locked)).join('')}</div>`;
    return h;
  }

  function incomeCard(st, mo, locked) {
    const dis = locked ? 'disabled' : '';
    const items = Model.byDate(mo.entrate);
    return `<section class="card income">
      <div class="income-top">
        <div>
          <div class="eyebrow">Entrate del mese</div>
          <div class="hero-num">${eur(st.entrate)}</div>
        </div>
        <div class="split">
          <div class="split-bar" aria-hidden="true">${KEYS.map(k => `<span class="bg-${k}" style="flex:${st.perc[k]}"></span>`).join('')}</div>
          <div class="split-legend">${KEYS.map(k => `<div><span class="k"><span class="swatch sw-${k}"></span>${DIV[k].nome} · ${pctTxt(st.perc[k])}</span><strong>${eur(st.budget[k])}</strong></div>`).join('')}</div>
        </div>
        <div class="income-actions">
          <button class="btn ghost sm" data-action="edit-perc" ${dis} title="Cambia la suddivisione di questo mese">Modifica %</button>
          <button class="btn primary" data-action="add-entrata" ${dis}>${icon('plus')} Entrata</button>
        </div>
      </div>
      ${items.length
        ? `<ul class="mov-list income-list">${items.map(e => movRow(e, 'entrata')).join('')}</ul>`
        : '<p class="empty">Nessuna entrata registrata. Aggiungi lo stipendio e le altre entrate del mese: il budget delle tre suddivisioni si calcola da qui.</p>'}
    </section>`;
  }

  function movRow(it, tipo) {
    const isIn = tipo === 'entrata';
    const kind = isIn ? 'entrata' : Model.tipoOf(it);
    const goal = isIn ? null : budget.goalOf(it);
    const title = isIn ? (it.descrizione || 'Entrata') : goal ? goal.nome : it.categoria;
    const sub = isIn ? '' : it.descrizione;
    let tag = '';
    if (kind === 'riporto') {
      if (goal && it.importo < 0) {
        tag = `<span class="tag t-rip" title="Soldi svincolati dal fondo dell'obiettivo: tornano ${it.div === 'ris' ? 'nei risparmi liberi' : 'nell\'avanzo'}">svincolato</span>`;
      } else if (it.div === 'ris') {
        tag = goal
          ? '<span class="tag t-rip" title="Soldi spostati dai risparmi già accumulati: non contano come nuovo accantonamento">dai risparmi</span>'
          : '<span class="tag t-rip" title="Soldi svincolati da un obiettivo e tornati nei risparmi liberi">dall\'obiettivo</span>';
      } else {
        tag = it.importo < 0
          ? '<span class="tag t-rip" title="Soldi restituiti all\'avanzo dei mesi precedenti">all\'avanzo</span>'
          : '<span class="tag t-rip" title="Pagato con l\'avanzo dei mesi precedenti: non pesa sul budget del mese">dall\'avanzo</span>';
      }
    } else if (kind === 'prelievo') {
      tag = '<span class="tag t-pre" title="Pagato con soldi già accantonati: non pesa sul budget del mese">prelievo</span>';
    }
    const goalTag = goal ? `<span class="tag t-goal" title="Movimento dell'obiettivo «${esc(goal.nome)}»">${icon('target')}obiettivo</span>` : '';
    return `<li><button class="mov${kind === 'prelievo' ? ' is-pre' : ''}" data-action="${isIn ? 'edit-entrata' : 'edit-uscita'}" data-id="${esc(it.id)}">
      <span class="mov-main">${esc(title)}</span>
      <span class="mov-amt">${kind === 'prelievo' ? '−' : ''}${eur(it.importo)}</span>
      <span class="mov-sub">${shortDate(it.data)}${goalTag}${tag}${it.ricorrente ? `<span title="Voce ricorrente">${icon('repeat')}</span>` : ''}${sub ? `<span class="d">· ${esc(sub)}</span>` : ''}</span>
    </button></li>`;
  }

  function divisionCard(y, m, k, st, rip, mo, locked) {
    const dis = locked ? 'disabled' : '';
    const d = DIV[k];
    const isRis = k === 'ris';
    const items = Model.byDate(mo.uscite.filter(u => u.div === k));
    const b = st.budget[k], s = st.speso[k], sal = st.saldo[k];
    const used = st.dalRiporto[k], pre = st.prelievi[k];
    // rate degli obiettivi pagate con il budget del mese (non gli spostamenti da avanzo o risparmi)
    const forGoals = r2(items.filter(u => Model.tipoOf(u) === 'spesa' && budget.goalOf(u)).reduce((a, u) => a + u.importo, 0));
    const disp = r2(rip[k] - used);          // avanzo ancora utilizzabile
    const fine = r2(rip[k] + st.netto[k]);   // passa al mese successivo
    const ratio = b > 0 ? s / b : s > 0 ? 1 : 0;
    const over = sal < -0.004;
    const verb = isRis ? 'Accantonato' : 'Speso';

    let saldoHtml, note = '';
    if (isRis) {
      const daFare = r2(Math.max(0, sal));
      saldoHtml = b > 0 && daFare <= 0
        ? `<div class="saldo pos"><span>Obiettivo di risparmio del mese</span><strong>${icon('check')} Raggiunto</strong></div>`
        : `<div class="saldo"><span>Da accantonare questo mese</span><strong>${eur(daFare)}</strong></div>`;
      if (over) note = `<div class="foot-note pos">Hai accantonato ${eur(-sal)} in più del previsto</div>`;
    } else {
      let tone_ = '';
      if (over) {
        const deficit = r2(-sal);
        if (disp >= deficit - 0.004) { tone_ = 'warn'; note = `Budget superato di ${eur(deficit)}, coperto dall'avanzo dei mesi precedenti`; }
        else if (disp > 0.004) { tone_ = 'neg'; note = `Budget superato di ${eur(deficit)}: l'avanzo dei mesi precedenti ne copre ${eur(disp)}, restano scoperti ${eur(r2(deficit - disp))}`; }
        else { tone_ = 'neg'; note = `Budget superato di ${eur(deficit)} e nessun avanzo dei mesi precedenti a coprirlo`; }
        note = `<div class="foot-note ${tone_}">${note}</div>`;
      } else if (sal > 0.004) tone_ = 'pos';
      saldoHtml = `<div class="saldo ${tone_}"><span>Saldo del mese</span><strong>${eur(sal)}</strong></div>`;
    }

    const cushion = isRis
      ? `<dl class="cushion">
          <dt><span class="help" title="Quanto hai accantonato in tutti i mesi precedenti, meno i prelievi. I soldi degli obiettivi sono esclusi: hanno un fondo a parte.">Risparmi dei mesi precedenti</span></dt><dd>${eur(rip[k])}</dd>
          ${r2(st.accLiberi[k] - st.daObiettivi[k]) ? `<dt>Accantonati questo mese</dt><dd class="pos">+${eur(r2(st.accLiberi[k] - st.daObiettivi[k]))}</dd>` : ''}
          ${st.daObiettivi[k] ? `<dt>Svincolati dagli obiettivi</dt><dd class="pos">+${eur(st.daObiettivi[k])}</dd>` : ''}
          ${st.preLiberi[k] ? `<dt>Prelievi questo mese</dt><dd class="neg">−${eur(st.preLiberi[k])}</dd>` : ''}
          <dt class="total"><span class="help" title="Risparmi dei mesi precedenti + accantonamenti − prelievi. Passa al mese successivo.">Risparmi totali a fine mese</span></dt><dd class="total">${eur(fine)}</dd>
        </dl>`
      : `<dl class="cushion">
          <dt><span class="help" title="Quanto ti è avanzato in tutti i mesi precedenti (se negativo: quanto hai sforato). I soldi degli obiettivi sono esclusi. Non si azzera a fine anno.">Avanzo dei mesi precedenti</span></dt><dd class="${tone(k, rip[k])}">${signed(rip[k])}</dd>
          ${used ? `<dt>${used > 0 ? 'Usato dall\'avanzo' : 'Restituito all\'avanzo'}</dt><dd>${signed(-used)}</dd>` : ''}
          <dt class="total"><span class="help" title="Avanzo dei mesi precedenti + saldo del mese − quanto usato. Passa al mese successivo.">Avanzo totale a fine mese</span></dt><dd class="total ${tone(k, fine)}">${signed(fine)}</dd>
        </dl>`;

    const funds = k === 'nec' ? [] : budget.funds(y, m).filter(f => f.div === k);
    const freeFunds = funds.filter(f => !f.obiettivo), goalFunds = funds.filter(f => f.obiettivo);

    return `<section class="card division div-${k}">
      <header class="div-head">
        <h2><span class="swatch sw-${k}"></span>${d.nome}</h2>
        <span class="div-pct">${pctTxt(st.perc[k])}</span>
      </header>
      <div class="div-hint">${esc(d.hint)}</div>
      <div class="div-budget"><span>Budget</span><strong>${eur(b)}</strong></div>
      <div class="meter ${over ? 'over' : ''}" role="progressbar" aria-label="${verb} rispetto al budget" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, ratio) * 100)}"><span style="width:${Math.min(100, ratio * 100)}%"></span></div>
      <div class="meter-cap"><span>${verb} ${eur(s)}${forGoals ? ` · di cui ${eur(forGoals)} per obiettivi` : ''}</span><span>${b > 0 ? Math.round(ratio * 100) + '%' : ''}</span></div>
      ${!isRis && pre ? `<div class="meter-cap pre"><span class="help" title="Spese pagate con il fondo di un obiettivo: non pesano sul budget del mese">Spese dai fondi degli obiettivi</span><span>−${eur(pre)}</span></div>` : ''}
      ${goalHints(y, m, k, locked)}
      <ul class="mov-list">${items.map(u => movRow(u, 'uscita')).join('') || `<li class="empty">Nessuna voce in ${d.nome.toLowerCase()}</li>`}</ul>
      <button class="btn add" data-action="add-uscita" data-div="${k}" ${dis}>${icon('plus')} ${isRis ? 'Accantona o preleva' : 'Aggiungi spesa'}</button>
      <footer class="div-foot">
        ${saldoHtml}
        ${note}
        ${cushion}
        ${freeFunds.length ? fundsBox('Dove sono i risparmi', freeFunds) : ''}
        ${goalFunds.length ? fundsBox('Messi da parte per obiettivi', goalFunds, isRis ? 'Non inclusi nei risparmi totali: si usano solo per l\'obiettivo.' : 'Non inclusi nell\'avanzo: si usano solo per l\'obiettivo.') : ''}
      </footer>
    </section>`;
  }

  function fundsBox(title, funds, note) {
    const tot = r2(funds.reduce((a, f) => a + f.saldo, 0));
    return `<details class="funds"><summary><span>${title}</span><strong>${eur(tot)}</strong></summary>
      ${note ? `<p class="funds-note">${note}</p>` : ''}
      <ul>${funds.map(f => `<li><span class="n" title="${esc(f.categoria)}">${f.obiettivo ? icon('target') + ' ' : ''}${esc(f.categoria)}</span>${f.obiettivo ? `<span class="tag t-lock" title="Fondo dell'obiettivo: si usa solo con «Usa il fondo» nella scheda dell'obiettivo">${icon('lock')}vincolato</span>` : ''}<span class="v ${f.saldo < -0.004 ? 'neg' : ''}">${eur(f.saldo)}</span></li>`).join('')}</ul>
    </details>`;
  }

  function goalHints(y, m, k, locked) {
    const t = today();
    if (y !== t.y || m !== t.m) return '';
    const active = budget.goalsOf(k).map(g => ({ g, s: budget.goalStatus(g, t) })).filter(x => x.s.stato === 'attivo');
    if (!active.length) return '';
    return `<div class="goal-hints"><div class="gh-title">${icon('target')} Rate degli obiettivi di questo mese</div>
      ${active.map(({ g, s }) => `<div class="goal-hint">
        <span class="n">${esc(g.nome)}</span>
        <span class="v">${eur(s.mese)} / ${eur(s.quota)}</span>
        ${s.mancanteMese > 0
          ? `<button class="btn sm" data-action="goal-contribute" data-id="${esc(g.id)}" ${locked ? 'disabled' : ''} title="Accantona ${eur(s.mancanteMese)}" aria-label="Accantona ${eur(s.mancanteMese)} per ${esc(g.nome)}">${icon('plus')}</button>`
          : `<span class="done" title="Rata del mese completata">${icon('check')}</span>`}
      </div>`).join('')}
    </div>`;
  }

  /* ========================================================= vista: riepilogo */

  function viewRiepilogo(y) {
    const t = today();
    const years = [...new Set([...budget.years(), t.y, y])].sort((a, b) => a - b);
    const stats = Array.from({ length: 12 }, (_, m) => budget.stats(y, m));
    const yt = budget.yearTotals(y);
    const opening = budget.opening(y);
    const delta = yt.netto;
    const closing = Model.add(opening, delta);
    const spese = r2(yt.speso.nec + yt.speso.des);
    const avanzato = r2(delta.nec + delta.des);
    const hasAny = stats.some(s => !s.vuoto);
    const abbr = MESI.map(n => n.slice(0, 3));
    const fineLabel = y === t.y ? 'attuale' : y < t.y ? 'a fine anno' : 'previsto a fine anno';

    let lastIdx = y < t.y ? 11 : y > t.y ? -1 : t.m;
    stats.forEach((s, i) => { if (!s.vuoto) lastIdx = Math.max(lastIdx, i); });

    let h = `<div class="page-head"><h1>Riepilogo ${y}</h1><span class="grow"></span>
      <nav class="year-tabs" aria-label="Anno">${years.map(yy => `<a href="#/riepilogo/${yy}" class="${yy === y ? 'active' : ''}">${yy}</a>`).join('')}</nav></div>`;

    if (state.yearErrors[y]) h += `<div class="banner error">${icon('alert')}<p>${esc(state.yearErrors[y])}</p></div>`;

    const ofIncome = v => (yt.entrate > 0 ? pctTxt(r2(v / yt.entrate * 100)) + ' delle entrate' : '—');
    const valTone = v => (v < -0.004 ? 'neg' : v > 0.004 ? 'pos' : '');
    h += `<div class="kpis">
      <div class="card kpi"><div class="label">Entrate ${y}</div><div class="value">${eur(yt.entrate)}</div><div class="sub">${stats.filter(s => s.entrate > 0).length} mesi con entrate</div></div>
      <div class="card kpi"><div class="label">Spese (necessità + svago)</div><div class="value">${eur(spese)}</div><div class="sub">${ofIncome(spese)}</div></div>
      <div class="card kpi"><div class="label">Risparmi accumulati nel ${y}</div><div class="value ${valTone(delta.ris)}">${signed(delta.ris)}</div><div class="sub">accantonati ${eur(r2(yt.accLiberi.ris - yt.daObiettivi.ris))}${yt.daObiettivi.ris ? ` · svincolati ${eur(yt.daObiettivi.ris)}` : ''}${yt.preLiberi.ris ? ` · prelievi −${eur(yt.preLiberi.ris)}` : ''}</div></div>
      <div class="card kpi"><div class="label">Avanzato (necessità + svago)</div><div class="value ${valTone(avanzato)}">${signed(avanzato)}</div><div class="sub">Quanto è cambiato l'avanzo nell'anno</div></div>
    </div>`;

    h += `<h2 class="section-title">Avanzi e risparmi accumulati</h2><div class="counters">${KEYS.map(k => k === 'ris' ? `
      <div class="counter"><h3><span class="swatch sw-${k}"></span>${DIV[k].nome}</h3>
        <dl>
          <dt>Risparmi a inizio ${y}</dt><dd>${eur(opening[k])}</dd>
          <dt>Accantonati</dt><dd class="pos">+${eur(r2(yt.accLiberi[k] - yt.daObiettivi[k]))}</dd>
          ${yt.daObiettivi[k] ? `<dt>Svincolati dagli obiettivi</dt><dd class="pos">+${eur(yt.daObiettivi[k])}</dd>` : ''}
          ${yt.preLiberi[k] ? `<dt>Prelievi</dt><dd class="neg">−${eur(yt.preLiberi[k])}</dd>` : ''}
          <div class="total" style="display:contents"><dt>Risparmi ${y === t.y ? 'attuali' : y < t.y ? 'a fine anno' : 'previsti a fine anno'}</dt><dd>${eur(closing[k])}</dd></div>
        </dl>
        ${yt.perObiettivi[k] ? `<p class="counter-note">In più ${eur(yt.perObiettivi[k])} messi da parte per obiettivi (fondi a parte).</p>` : ''}
      </div>` : `
      <div class="counter"><h3><span class="swatch sw-${k}"></span>${DIV[k].nome}</h3>
        <dl>
          <dt>Avanzo a inizio ${y}</dt><dd class="${tone(k, opening[k])}">${signed(opening[k])}</dd>
          <dt>Saldi dei mesi</dt><dd class="${tone(k, yt.saldo[k])}">${signed(yt.saldo[k])}</dd>
          ${yt.dalRiporto[k] ? `<dt>${yt.dalRiporto[k] > 0 ? 'Usato dall\'avanzo' : 'Restituito all\'avanzo'}</dt><dd>${signed(-yt.dalRiporto[k])}</dd>` : ''}
          <div class="total" style="display:contents"><dt>Avanzo ${fineLabel}</dt><dd class="${tone(k, closing[k])}">${signed(closing[k])}</dd></div>
        </dl>
        ${yt.perObiettivi[k] ? `<p class="counter-note">Le rate degli obiettivi (${eur(yt.perObiettivi[k])}) non sono comprese nell'avanzo.</p>` : ''}
      </div>`).join('')}</div>`;

    if (!hasAny) {
      h += `<div class="card" style="margin-top:16px"><p class="chart-empty">Nessun dato registrato nel ${y}. <a href="${monthHref(y, y === t.y ? t.m : 0)}">Vai al mese</a> per inserire entrate e spese.</p></div>`;
    } else {
      const legendDiv = KEYS.map(k => `<span><i class="swatch sw-${k}"></i>${DIV[k].nome}</span>`).join('');
      h += `<h2 class="section-title">Andamento</h2>
      <div class="grid-2">
        <section class="card chart-card">
          <h3>Uscite ed entrate per mese</h3>
          <div class="sub">Colonne: spese e accantonamenti del mese · trattino: entrate del mese</div>
          <div class="legend">${legendDiv}<span><i class="swatch sw-inc"></i>Entrate</span></div>
          <div class="chart-box" id="ch-stack"></div>
        </section>
        <section class="card chart-card">
          <h3>Avanzi e risparmi a fine mese</h3>
          <div class="sub">Necessità e Svago: avanzo accumulato · Risparmi: totale accumulato (obiettivi esclusi)</div>
          <div class="legend">${legendDiv}</div>
          <div class="chart-box" id="ch-line"></div>
        </section>
      </div>`;
      pendingCharts.push(['ch-stack', {
        type: 'stack', height: 270, aria: `Uscite ed entrate per mese, ${y}`,
        labels: abbr, titles: MESI.map(n => `${n} ${y}`),
        series: KEYS.map(k => ({ key: k, name: DIV[k].nome, values: stats.map(s => s.speso[k]) })),
        line: { name: 'Entrate', values: stats.map(s => s.entrate) },
      }]);
      const lineVals = k => [opening[k], ...stats.map((_, i) => (i <= lastIdx ? budget.riporto(y, i + 1)[k] : null))];
      pendingCharts.push(['ch-line', {
        type: 'line', height: 270, aria: `Andamento di avanzi e risparmi, ${y}`,
        labels: ['Inizio', ...abbr], titles: [`Inizio ${y}`, ...MESI.map(n => `Fine ${n.toLowerCase()} ${y}`)],
        series: KEYS.map(k => ({ key: k, name: DIV[k].nome, values: lineVals(k) })),
      }]);

      // uscite per categoria (i prelievi non contano: sono soldi già accantonati)
      const agg = new Map();
      for (let m = 0; m < 12; m++) {
        const mo = budget.getMonth(y, m);
        if (!mo) continue;
        for (const u of mo.uscite) {
          if (Model.tipoOf(u) === 'prelievo') continue;
          const g = budget.goalOf(u);
          const label = g ? '🎯 ' + g.nome : u.categoria;
          const key = u.div + '|' + label;
          const cur = agg.get(key) || { label, key: u.div, group: DIV[u.div].nome, value: 0 };
          cur.value = r2(cur.value + u.importo);
          agg.set(key, cur);
        }
      }
      let rows = [...agg.values()].filter(r => r.value > 0).sort((a, b) => b.value - a.value);
      if (rows.length > 10) {
        const rest = rows.slice(9);
        rows = rows.slice(0, 9);
        rows.push({ label: `Altre ${rest.length} categorie`, key: 'other', group: 'Varie', value: r2(rest.reduce((s, r) => s + r.value, 0)) });
      }
      if (rows.length) {
        h += `<section class="card chart-card" style="margin-top:16px">
          <h3>Dove vanno i soldi</h3>
          <div class="sub">Totale ${y} per categoria (spese e accantonamenti)</div>
          <div class="legend">${legendDiv}</div>
          <div class="chart-box" id="ch-cat"></div>
        </section>`;
        pendingCharts.push(['ch-cat', { type: 'hbar', rows, aria: `Uscite per categoria, ${y}` }]);
      }
    }

    // fondi accantonati fino alla fine dell'anno scelto
    const funds = budget.funds(y, 11);
    if (funds.length) {
      h += `<h2 class="section-title">Fondi accantonati</h2>
      <section class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>Fondo</th><th>Suddivisione</th><th class="n">Messi da parte</th><th class="n">Prelevati</th><th class="n">Saldo a fine ${y}</th></tr></thead>
        <tbody>${funds.map(f => `<tr><td>${f.obiettivo ? icon('target') + ' ' : ''}${esc(f.categoria)}${f.obiettivo ? ` <span class="tag t-lock" title="Fondo dell'obiettivo: si usa solo con «Usa il fondo»">${icon('lock')}vincolato</span>` : ''}</td>
            <td><span class="swatch sw-${f.div}"></span> ${DIV[f.div].nome}</td>
            <td class="n">${eur(r2(f.iniziale + f.accantonato))}</td><td class="n">${f.prelevato ? '−' + eur(f.prelevato) : '—'}</td>
            <td class="n ${f.saldo < -0.004 ? 'neg' : ''}"><strong>${eur(f.saldo)}</strong></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">Totali dall'inizio fino a dicembre ${y}. I fondi degli obiettivi sono vincolati e non rientrano nei risparmi accumulati: si usano solo per l'obiettivo, con «Usa il fondo».</p></section>`;
    }

    // tabella mesi
    h += `<h2 class="section-title">Dettaglio mesi</h2>
    <section class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Mese</th><th class="n">Entrate</th>${['nec', 'des'].map(k => `<th class="n">Speso ${DIV[k].nome.toLowerCase()}</th><th class="n">Saldo ${DIV[k].nome.toLowerCase()}</th>`).join('')}<th class="n">Accantonato</th><th class="n">Prelievi</th></tr></thead>
      <tbody>${stats.map((s, m) => `<tr class="clickable" data-action="open-month" data-y="${y}" data-m="${m}">
          <td><a href="${monthHref(y, m)}">${MESI[m]}</a></td>
          <td class="n ${s.vuoto ? 'dim' : ''}">${eur(s.entrate)}</td>
          ${['nec', 'des'].map(k => `<td class="n ${s.vuoto ? 'dim' : ''}">${eur(s.speso[k])}</td><td class="n ${s.vuoto ? 'dim' : tone(k, s.saldo[k])}">${eur(s.saldo[k])}</td>`).join('')}
          <td class="n ${s.vuoto ? 'dim' : ''}">${eur(s.speso.ris)}</td>
          <td class="n ${s.vuoto ? 'dim' : ''}">${s.prelievi.ris ? '−' + eur(s.prelievi.ris) : '—'}</td>
        </tr>`).join('')}</tbody>
      <tfoot><tr><td>Totale</td><td class="n">${eur(yt.entrate)}</td>${['nec', 'des'].map(k => `<td class="n">${eur(yt.speso[k])}</td><td class="n ${tone(k, yt.saldo[k])}">${eur(yt.saldo[k])}</td>`).join('')}<td class="n">${eur(yt.speso.ris)}</td><td class="n">${yt.prelievi.ris ? '−' + eur(yt.prelievi.ris) : '—'}</td></tr></tfoot>
    </table></div></section>`;

    // storico anni
    const all = budget.years();
    if (all.length) {
      h += `<h2 class="section-title">Storico anni</h2>
      <section class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>Anno</th><th class="n">Entrate</th><th class="n">Spese</th><th class="n">Delta necessità</th><th class="n">Delta svago</th><th class="n">Risparmi accumulati</th><th class="n">Avanzi e risparmi a fine anno</th></tr></thead>
        <tbody>${all.map(yy => {
          const tt = budget.yearTotals(yy);
          const cl = Model.total(budget.closing(yy));
          return `<tr class="clickable" data-action="open-year" data-y="${yy}">
            <td><a href="#/riepilogo/${yy}">${yy}</a></td>
            <td class="n">${eur(tt.entrate)}</td><td class="n">${eur(r2(tt.speso.nec + tt.speso.des))}</td>
            <td class="n ${tone('nec', tt.netto.nec)}">${signed(tt.netto.nec)}</td><td class="n ${tone('des', tt.netto.des)}">${signed(tt.netto.des)}</td>
            <td class="n">${signed(tt.netto.ris)}</td><td class="n">${signed(cl)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">Il delta di ogni anno è salvato anche nel foglio «Riepilogo» del relativo file Excel.</p></section>`;
    }
    return h;
  }

  /* ========================================================= vista: obiettivi */

  function viewObiettivi() {
    const t = today();
    const order = { attivo: 0, raggiunto: 1, scaduto: 2 };
    const goals = budget.settings.obiettivi.map(g => ({ g, s: budget.goalStatus(g, t) }))
      .sort((a, b) => order[a.s.stato] - order[b.s.stato] || a.g.scadenza.localeCompare(b.g.scadenza));
    const st = budget.stats(t.y, t.m);

    let h = `<div class="page-head"><h1>Obiettivi</h1><span class="grow"></span>
      <button class="btn primary" data-action="add-goal">${icon('plus')} Nuovo obiettivo</button></div>`;

    if (!goals.length) {
      return h + `<section class="card setup" style="margin:0;max-width:none">
        <h2>${icon('target')} Metti da parte i soldi per qualcosa di preciso</h2>
        <p class="explain" style="margin-top:10px">Indica quanto ti serve e per quando: Hose calcola la rata da accantonare ogni mese.
        Scegli da quale budget prenderla:</p>
        <p class="explain" style="margin-top:8px"><span class="swatch sw-des"></span> <strong>${DIV.des.nome}</strong> per qualcosa che vuoi, es. <em>Viaggio · 3.000 € · maggio 2028</em>.<br>
        <span class="swatch sw-ris"></span> <strong>${DIV.ris.nome}</strong> per una spesa futura prevista, es. <em>Caldaia nuova · 2.500 € · tra 3 anni</em>.</p>
        <p class="explain" style="margin-top:8px">La rata resta fissa: se accantoni di più o di meno l'app ti propone di cambiarla o di spostare la scadenza. Puoi coprire subito una parte con l'avanzo (o con i risparmi già accumulati). Ogni obiettivo ha un fondo tutto suo, escluso da avanzi e risparmi.</p>
        <div class="actions"><button class="btn primary lg" data-action="add-goal">${icon('plus')} Crea il primo obiettivo</button></div>
      </section>`;
    }

    const sums = Model.GOAL_DIVS.map(k => {
      const act = goals.filter(x => x.g.div === k && x.s.stato === 'attivo');
      return { k, n: act.length, quota: r2(act.reduce((a, x) => a + x.s.quota, 0)), budget: st.budget[k] };
    }).filter(x => x.n);
    if (sums.length) {
      h += `<div class="goal-summaries">${sums.map(x => {
        const share = x.budget > 0 ? x.quota / x.budget : 0;
        return `<section class="card goal-summary">
          <div><div class="eyebrow"><span class="swatch sw-${x.k}"></span> Rate ${DIV[x.k].nome}</div><div class="big">${eur(x.quota)}</div><div class="muted small">questo mese · ${x.n} ${x.n === 1 ? 'obiettivo' : 'obiettivi'}</div></div>
          <div class="grow">
            ${x.budget > 0
              ? `<div>${pctTxt(r2(share * 100))} del budget ${DIV[x.k].nome.toLowerCase()} di ${MESI[t.m].toLowerCase()} (${eur(x.budget)})</div>
                 <div class="meter m-${x.k} ${share > 1 ? 'over' : ''}"><span style="width:${Math.min(100, share * 100)}%"></span></div>
                 ${share > 1 ? `<div class="foot-note neg" style="margin-top:6px">Le rate superano il budget ${DIV[x.k].nome.toLowerCase()}: sposta una scadenza, riduci un obiettivo o coprine una parte con ${x.k === 'ris' ? 'i risparmi accumulati' : 'l\'avanzo dei mesi precedenti'}.</div>` : ''}`
              : `<div class="muted">Registra le entrate di ${MESI[t.m].toLowerCase()} per confrontare le rate con il budget.</div>`}
          </div>
        </section>`;
      }).join('')}</div>`;
    }

    h += `<div class="goal-grid">${goals.map(goalCard).join('')}</div>`;
    return h;
  }

  const monthName = ym => { const [yy, mm] = ym.split('-').map(Number); return `${MESI[mm - 1].toLowerCase()} ${yy}`; };
  const nMesi = n => `${n} ${n === 1 ? 'mese' : 'mesi'}`;
  /** "a maggio 2028" / "ad aprile 2028" */
  const aMese = ym => { const n = monthName(ym); return (/^[aeiou]/.test(n) ? 'ad ' : 'a ') + n; };

  /** Quanto si può usare subito per un obiettivo: avanzo (Svago) o risparmi liberi (Risparmi). */
  function coverable(div) {
    const t = today();
    if (div === 'ris') return r2(budget.funds().filter(f => f.div === 'ris' && !f.obiettivo && f.saldo > 0).reduce((a, f) => a + f.saldo, 0));
    return r2(Math.max(0, budget.disponibile(t.y, t.m)[div]));
  }

  /** Stato del piano: in linea, in anticipo (proposte: riduci rata / anticipa) o in ritardo. */
  function planBox(g, s) {
    if (s.stato !== 'attivo') return '';
    const id = esc(g.id);
    const pronto = aMese(s.pronto);
    if (s.piano === 'anticipo') {
      const btns = [];
      if (s.necessaria < s.rata - 0.004) btns.push(`<button class="btn sm" data-action="goal-plan" data-id="${id}" data-rata="${s.necessaria}">Riduci la rata a ${eur(s.necessaria)}</button>`);
      if (s.scartoMesi > 0) btns.push(`<button class="btn sm" data-action="goal-plan" data-id="${id}" data-scadenza="${s.pronto}">Anticipa la scadenza ${pronto}</button>`);
      const txt = s.scartoMesi > 0
        ? `Con ${eur(s.rata)} al mese il fondo è pronto <strong>${pronto}</strong>, ${nMesi(s.scartoMesi)} prima della scadenza.`
        : `Hai messo da parte più del previsto: per la scadenza basterebbero ${eur(s.necessaria)} al mese.`;
      return `<div class="goal-plan ok"><strong>${icon('check')} Sei in anticipo.</strong> ${txt}
        <div class="plan-actions">${btns.join('')}<span class="muted small">oppure lascia tutto com'è</span></div></div>`;
    }
    if (s.piano === 'ritardo') {
      return `<div class="goal-plan warn"><strong>${icon('alert')} Sei indietro.</strong> Con ${eur(s.rata)} al mese il fondo sarebbe pronto <strong>${pronto}</strong>, ${nMesi(-s.scartoMesi)} dopo la scadenza.
        <div class="plan-actions">
          <button class="btn sm" data-action="goal-plan" data-id="${id}" data-rata="${s.necessaria}">Aumenta la rata a ${eur(s.necessaria)}</button>
          <button class="btn sm" data-action="goal-plan" data-id="${id}" data-scadenza="${s.pronto}">Sposta la scadenza ${pronto}</button>
        </div></div>`;
    }
    return `<div class="goal-plan">${icon('check')} In linea: con ${eur(s.rata)} al mese arrivi alla scadenza.</div>`;
  }

  function goalCard({ g, s }) {
    const [sy, sm] = g.scadenza.split('-').map(Number);
    const disp = coverable(g.div);
    const pill = s.stato === 'raggiunto' ? '<span class="pill ok">Raggiunto</span>'
      : s.stato === 'scaduto' ? '<span class="pill bad">Scaduto</span>'
        : `<span class="pill">${s.mesi <= 0 ? 'Ultimo mese' : nMesi(s.mesi)}</span>`;
    const useFund = s.fondo > 0.004
      ? `<button class="btn sm" data-action="goal-spend" data-id="${esc(g.id)}" title="Spesa per l'obiettivo (es. i biglietti del volo), pagata con i soldi del suo fondo">Usa il fondo</button>` : '';
    const release = s.fondo > 0.004
      ? `<button class="btn sm ghost" data-action="goal-release" data-id="${esc(g.id)}" title="Libera una parte del fondo per altre spese ${g.div === 'ris' ? 'dei Risparmi' : 'di Svago'}, non legate all'obiettivo">Svincola</button>` : '';

    let month = '';
    if (s.stato === 'attivo') {
      month = `<div class="goal-month"><span class="grow">Questo mese: <strong>${eur(s.mese)}</strong> di ${eur(s.quota)}</span>
        ${s.mancanteMese > 0
          ? `<button class="btn sm primary" data-action="goal-contribute" data-id="${esc(g.id)}">${icon('plus')} Accantona ${eur(s.mancanteMese)}</button>`
          : `<span class="pill ok">${icon('check')} Rata fatta</span>`}</div>`;
      month += planBox(g, s);
      if (disp > 0.004 && s.mancante > 0.004) {
        month += `<button class="btn sm ghost goal-rip" data-action="goal-riporto" data-id="${esc(g.id)}">Copri una parte con ${g.div === 'ris' ? 'i risparmi accumulati' : 'l\'avanzo dei mesi precedenti'} (${eur(disp)} disponibili)</button>`;
      }
    } else if (s.stato === 'scaduto') {
      month = `<div class="goal-month"><span class="grow">Scadenza passata: mancano ${eur(s.mancante)}. Modifica la data per ricalcolare la rata.</span>${useFund}</div>`;
    } else {
      month = `<div class="goal-month"><span class="grow">${icon('check')} Hai messo da parte ${eur(s.accantonato)}.</span>${useFund}</div>`;
    }

    const extra = [];
    if (s.dalRiporto) extra.push(`di cui ${eur(s.dalRiporto)} ${g.div === 'ris' ? 'dai risparmi accumulati' : 'dall\'avanzo'}`);
    if (s.svincolato) extra.push(`svincolati ${eur(s.svincolato)} per altre spese`);
    if (s.prelevato) extra.push(`già usati per l'obiettivo ${eur(s.prelevato)}, nel fondo restano ${eur(s.fondo)}`);

    return `<article class="card goal ${s.stato}">
      <header><div><h3>${esc(g.nome)}</h3><span class="goal-div"><span class="swatch sw-${g.div}"></span>${DIV[g.div].nome}</span></div>${pill}</header>
      <div class="goal-amounts"><strong>${eur(s.accantonato)}</strong><span>di ${eur(g.importo)}</span></div>
      <div class="meter m-${g.div}"><span style="width:${s.progress * 100}%"></span></div>
      ${extra.length ? `<div class="goal-extra">${esc(extra.join(' · '))}</div>` : ''}
      <dl class="goal-facts">
        <div><dt>Scadenza</dt><dd>${MESI[sm - 1]} ${sy}</dd></div>
        <div><dt>Mancano</dt><dd>${eur(s.mancante)}</dd></div>
        <div><dt>Rata mensile</dt><dd class="big">${s.stato === 'attivo' ? eur(s.rata) : '—'}</dd></div>
        <div><dt>Pronto a</dt><dd>${s.stato === 'attivo' ? monthName(s.pronto) : '—'}</dd></div>
      </dl>
      ${month}
      <footer><span title="Le spese normali e i prelievi non toccano questo fondo">${icon('lock')} Fondo vincolato all'obiettivo</span>
        <span>${s.stato === 'attivo' ? useFund : ''}${release}<button class="btn ghost sm" data-action="edit-goal" data-id="${esc(g.id)}">${icon('edit')} Modifica</button></span></footer>
    </article>`;
  }

  /* ====================================================== vista: impostazioni */

  function viewImpostazioni() {
    const p = budget.settings.percentuali;
    const theme = (() => { try { return localStorage.getItem('salvadanaio.theme') || 'auto'; } catch { return 'auto'; } })();
    const t = today();
    const years = [...new Set([...budget.years(), t.y])].sort((a, b) => a - b);

    let storage;
    if (Store.mode === 'folder') {
      const files = budget.years().map(Model.fileName);
      storage = `<div class="data-row">${icon('folder')}<div class="grow"><strong>Cartella «${esc(Store.folderName())}»</strong>
        <p>${files.length ? esc(files.join(', ')) + ', ' : ''}impostazioni.json — un file Excel per ogni anno, aggiornato automaticamente.</p></div>
        <button class="btn" data-action="change-folder">Cambia cartella</button>
        <button class="btn ghost" data-action="use-browser">Usa il browser</button></div>`;
    } else {
      storage = `<div class="data-row">${icon('globe')}<div class="grow"><strong>Dati salvati nel browser</strong>
        <p>Restano solo in questo browser su questo computer. Usa «Esporta» per avere i file Excel${Store.supportsFolder ? ', oppure salva in una cartella per aggiornarli in automatico' : ''}.</p></div>
        ${Store.supportsFolder ? '<button class="btn primary" data-action="change-folder">' + icon('folder') + ' Salva in una cartella</button>' : ''}</div>`;
    }

    return `<div class="page-head"><h1>Impostazioni</h1></div>

    <h2 class="section-title" style="margin-top:0">Suddivisione predefinita</h2>
    <section class="card">
      <form data-form="perc-default" class="perc-row">
        ${KEYS.map(k => `<label><span><span class="swatch sw-${k}"></span> ${DIV[k].nome}</span><input type="number" name="${k}" min="0" max="100" step="1" value="${p[k]}" data-perc></label>`).join('')}
        <span class="perc-total" data-perc-total>Totale 100%</span>
        <button class="btn primary" type="submit">Salva</button>
      </form>
      <p class="muted small" style="margin-top:10px">Vale per i mesi nuovi. Ogni mese ricorda la propria suddivisione: per cambiarla in un singolo mese usa «Modifica %» nella pagina del mese.</p>
    </section>

    <h2 class="section-title">Categorie</h2>
    <div class="settings-grid">${KEYS.map(k => `
      <section class="card cat-col">
        <h3><span class="swatch sw-${k}"></span>${DIV[k].nome}</h3>
        <ul class="cat-list">${budget.settings.categorie[k].map((c, i) => {
          const n = budget.usage(k, c);
          return `<li><span title="${esc(c)}">${esc(c)}</span>${n ? `<small title="Voci registrate">${n}</small>` : ''}
            <button class="icon-btn sm" data-action="del-cat" data-div="${k}" data-i="${i}" aria-label="Rimuovi ${esc(c)}" title="Rimuovi">${icon('x')}</button></li>`;
        }).join('') || '<li class="muted">Nessuna categoria</li>'}</ul>
        <form class="inline-form" data-form="add-cat" data-div="${k}">
          <input name="nome" maxlength="40" placeholder="Nuova categoria" required aria-label="Nuova categoria ${DIV[k].nome}">
          <button class="btn" type="submit">${icon('plus')}</button>
        </form>
      </section>`).join('')}</div>

    <h2 class="section-title">Dati e file</h2>
    <section class="card">
      ${storage}
      <div class="data-row">${icon('upload')}<div class="grow"><strong>Importa</strong>
        <p>File Excel di un anno (Hose_AAAA.xlsx), backup completo (.zip) o impostazioni (.json).</p></div>
        <button class="btn" data-action="import">Scegli file…</button></div>
      <div class="data-row">${icon('download')}<div class="grow"><strong>Esporta</strong>
        <p>Scarica una copia dei dati: Excel dell'anno, CSV dei movimenti o un backup .zip con tutto.</p></div>
        <select data-export-year aria-label="Anno da esportare">${years.map(y => `<option ${y === t.y ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <button class="btn" data-action="export-xlsx">Excel</button>
        <button class="btn" data-action="export-csv">CSV</button>
        <button class="btn primary" data-action="export-all">${icon('download')} Backup completo</button></div>
    </section>

    <h2 class="section-title">Aspetto</h2>
    <section class="card"><div class="data-row" style="padding:0"><div class="grow"><strong>Tema</strong></div>
      <div class="seg" role="group" aria-label="Tema">${[['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([v, l]) => `<button data-action="theme" data-v="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></section>

    <h2 class="section-title">Come funziona</h2>
    <section class="card explain">
      <p>Le <strong>entrate</strong> del mese vengono divise in tre budget: <strong>Necessità</strong>, <strong>Svago</strong> e <strong>Risparmi</strong> (di base 50/30/20).</p>
      <p><strong>Necessità e Svago.</strong> Il <strong>saldo del mese</strong> è budget meno uscite e può andare in negativo. L'<strong>avanzo dei mesi precedenti</strong> somma quanto ti è avanzato (o hai sforato) in tutti i mesi precedenti: non include il mese in corso e non si azzera a fine anno. Se sfori il budget l'app ti dice se lo sforamento è <strong>coperto dall'avanzo</strong> (arancione) o <strong>scoperto</strong> (rosso).</p>
      <p><strong>Risparmi.</strong> Il budget è quanto dovresti accantonare nel mese. I <strong>risparmi accumulati</strong> crescono con gli accantonamenti e calano con i <strong>prelievi</strong> (es. la lavatrice rotta pagata con il Fondo di emergenza): un prelievo è una spesa fatta con i risparmi e non toglie nulla all'obiettivo di risparmio del mese.</p>
      <p><strong>Obiettivi.</strong> Si accantonano dallo Svago (es. un viaggio) o dai Risparmi (es. la caldaia) e hanno un <strong>fondo tutto loro</strong>: non rientrano negli avanzi né nei risparmi accumulati, e contano solo le rate e quanto destini a loro. La <strong>rata è fissa</strong>: se sei in anticipo l'app propone di ridurla o di anticipare la scadenza, se sei indietro di aumentarla o di spostare la scadenza. I soldi di un obiettivo si usano solo con «Usa il fondo».</p>
      <p>Il <strong>delta</strong> di un anno è di quanto sono cambiati avanzi e risparmi accumulati. Viene salvato nel foglio «Riepilogo» del file Excel insieme ai valori di inizio anno, così ogni file resta coerente anche da solo.</p>
      <p>Le voci <strong>ricorrenti</strong> (affitto, stipendio, abbonamenti…) si possono copiare con un clic nel mese successivo.</p>
    </section>`;
  }

  /* ================================================================ dialoghi */

  function openDialog(html, onSubmit, onOpen) {
    $dialog.innerHTML = html;
    const form = $dialog.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const action = e.submitter ? e.submitter.value : 'save';
      const err = form.querySelector('.error-msg');
      const res = onSubmit(form, action);
      if (typeof res === 'string') { if (err) err.textContent = res; return; }
      if (res !== false) $dialog.close();
    });
    const del = form.querySelector('[data-dlg-delete]');
    if (del) del.addEventListener('click', () => {
      const res = onSubmit(form, 'delete');
      if (typeof res === 'string') { const err = form.querySelector('.error-msg'); if (err) err.textContent = res; }
      else if (res === true) $dialog.close();
    });
    $dialog.showModal();
    if (onOpen) onOpen(form);
  }

  $dialog.addEventListener('click', e => { if (e.target === $dialog) $dialog.close(); });

  /**
   * Opzioni del campo categoria. Gli obiettivi compaiono a parte ("goal:<id>"):
   * per rate e uso dell'avanzo quelli in corso, per i prelievi solo `allowGoal`
   * (l'obiettivo di «Usa il fondo»), perché i loro soldi sono vincolati.
   */
  function catOptions(div, sel, tipo, allowGoal) {
    const list = [...budget.settings.categorie[div]];
    const selCat = sel && !String(sel).startsWith('goal:') && sel !== '__new' ? sel : null;
    if (selCat && !list.includes(selCat)) list.unshift(selCat);
    let html = list.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const t = today();
    const goals = budget.goalsOf(div).filter(g => (tipo === 'prelievo'
      ? g.id === allowGoal
      : budget.goalStatus(g, t).stato === 'attivo' || 'goal:' + g.id === sel));
    if (goals.length) {
      html = `<optgroup label="Categorie">${html}</optgroup><optgroup label="Obiettivi">${goals.map(g =>
        `<option value="goal:${esc(g.id)}" ${'goal:' + g.id === sel ? 'selected' : ''}>🎯 ${esc(g.nome)}</option>`).join('')}</optgroup>`;
    }
    return html + '<option value="__new">+ Nuova categoria…</option>';
  }

  function findItem(y, m, id) {
    const mo = budget.getMonth(y, m);
    if (!mo) return null;
    for (const list of [mo.entrate, mo.uscite]) {
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) return { list, i, item: list[i] };
    }
    return null;
  }

  function removeWithUndo(y, m, found, label) {
    const [removed] = found.list.splice(found.i, 1);
    markDirty(y);
    render();
    toast(`${label} eliminata`, {
      action: { label: 'Annulla', fn: () => { found.list.splice(found.i, 0, removed); markDirty(y); render(); } },
      ms: 6000,
    });
  }

  function readAmount(form) {
    const v = Model.parseAmount(form.importo.value);
    if (!isFinite(v) || v === 0) return null;
    return v;
  }

  function clampDate(v, y, m) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return defaultDate(y, m);
    if (v < iso(y, m, 1)) return iso(y, m, 1);
    if (v > iso(y, m, daysIn(y, m))) return iso(y, m, daysIn(y, m));
    return v;
  }

  function tipoOptions(div, withPrelievo, withRisRiporto) {
    if (div === 'nec') return [['spesa', 'Spesa'], ['riporto', 'Dall\'avanzo']];
    if (div === 'des') return [['spesa', 'Spesa'], ['riporto', 'Dall\'avanzo'], ...(withPrelievo ? [['prelievo', 'Usa fondo obiettivo']] : [])];
    return [['spesa', 'Accantonamento'], ['prelievo', 'Prelievo'], ...(withRisRiporto ? [['riporto', 'Dai risparmi']] : [])];
  }

  function tipoRadios(div, sel, withPrelievo, withRisRiporto) {
    const opts = tipoOptions(div, withPrelievo, withRisRiporto);
    if (!opts.some(o => o[0] === sel)) sel = 'spesa';
    return opts.map(([v, l]) => `<label><input type="radio" name="tipo" value="${v}" ${v === sel ? 'checked' : ''}><span>${l}</span></label>`).join('');
  }

  const checkedTipo = form => { const el = form.querySelector('input[name="tipo"]:checked'); return el ? el.value : 'spesa'; };
  const selectedGoal = form => (form.categoria.value.startsWith('goal:') ? budget.goal(form.categoria.value.slice(5)) : null);

  function tipoHint(y, m, form, item, allowGoal) {
    const div = form.div.value;
    const tipo = checkedTipo(form);
    const sel = form.categoria.value;
    const goal = selectedGoal(form);
    const v = Model.parseAmount(form.importo.value);
    const amount = isFinite(v) ? v : 0;
    const nome = DIV[div].nome.toLowerCase();
    const mese = MESI[m].toLowerCase();
    const itemTipo = item ? Model.tipoOf(item) : null;
    const st = budget.stats(y, m);

    if (tipo === 'riporto' && div === 'ris') return 'Soldi spostati dai risparmi già accumulati al fondo di un obiettivo: non contano come nuovo accantonamento del mese.';
    if (tipo === 'riporto') {
      const own = item && item.div === div && itemTipo === 'riporto' ? item.importo : 0; // già incluso nei totali
      const disp = r2(budget.disponibile(y, m)[div] + own);
      let txt = amount < 0
        ? `Restituisci ${eur(-amount)} all'avanzo di ${nome}.`
        : `Usa l'avanzo dei mesi precedenti di ${nome}: disponibili <strong>${eur(disp)}</strong>. Non pesa sul budget del mese.`;
      if (goal) txt += ` Conta per l'obiettivo «${esc(goal.nome)}».`;
      if (amount > disp + 0.004) txt += ` <span class="neg">Supera il disponibile di ${eur(r2(amount - disp))}.</span>`;
      return txt;
    }
    if (tipo === 'prelievo') {
      const a = Math.abs(amount);
      if (sel === '__new') return 'Scegli il fondo da cui prendere i soldi.';
      let f, txt;
      if (goal) {
        if (goal.id !== allowGoal) return '<span class="neg">I soldi degli obiettivi sono vincolati: si usano solo con «Usa il fondo» nella scheda dell\'obiettivo.</span>';
        const same = item && itemTipo === 'prelievo' && item.obiettivo === goal.id;
        f = r2(budget.goalStatus(goal, today()).fondo + (same ? item.importo : 0));
        txt = `Spesa per l'obiettivo «${esc(goal.nome)}»: nel suo fondo ci sono <strong>${eur(f)}</strong>.`;
      } else {
        const same = item && itemTipo === 'prelievo' && !budget.goalOf(item) && item.categoria === sel;
        f = r2(budget.fundBalance(div, sel) + (same ? item.importo : 0));
        txt = `Prendi soldi già accantonati in «${esc(sel)}»: nel fondo ci sono <strong>${eur(f)}</strong>. Non pesa sul budget del mese e non tocca l'avanzo.`;
      }
      if (a > f + 0.004) txt += ` <span class="neg">Il fondo andrà sotto di ${eur(r2(a - f))}.</span>`;
      return txt;
    }
    if (div === 'ris' && amount < 0) return 'Importo negativo: verrà registrato come <strong>prelievo</strong> dal fondo scelto, senza toccare l\'accantonamento del mese.';
    const left = r2(st.saldo[div] + (item && itemTipo === 'spesa' && item.div === div ? item.importo : 0));
    if (goal) return `Rata dell'obiettivo «${esc(goal.nome)}», presa dal budget ${nome} di ${mese}: restano ${eur(left)}.`;
    return div === 'ris'
      ? `Metti da parte una quota del budget Risparmi di ${mese}: ${left > 0 ? `mancano ${eur(left)} all'obiettivo del mese` : 'l\'obiettivo del mese è già raggiunto'}.`
      : `Usa il budget ${nome} di ${mese}: restano ${eur(left)}.`;
  }

  function dlgUscita(y, m, id, preset = {}) {
    const found = id ? findItem(y, m, id) : null;
    const item = found ? found.item : null;
    const div = item ? item.div : preset.div || 'nec';
    const tipo0 = item ? Model.tipoOf(item) : preset.tipo || 'spesa';
    const itemGoal = item ? budget.goalOf(item) : null;
    const sel0 = item ? (itemGoal ? 'goal:' + itemGoal.id : item.categoria) : preset.obiettivo ? 'goal:' + preset.obiettivo : preset.categoria;
    // Obiettivo i cui soldi questo dialogo può usare per un prelievo: quello di
    // «Usa il fondo» o quello del prelievo che si sta modificando.
    const allowGoal = preset.perObiettivo ? preset.obiettivo : itemGoal && tipo0 === 'prelievo' ? itemGoal.id : null;
    const withPrelievo = !!allowGoal || tipo0 === 'prelievo';
    const withRisRiporto = !!item && item.div === 'ris' && tipo0 === 'riporto';
    const isNew = !item;
    const title = !isNew ? 'Modifica voce' : preset.perObiettivo ? 'Usa il fondo dell\'obiettivo' : preset.obiettivo ? 'Rata dell\'obiettivo' : div === 'ris' ? 'Accantona o preleva' : 'Nuova spesa';

    openDialog(`<form class="dlg" novalidate>
      <header><h2>${title}</h2><div class="muted">${monthLabel(y, m)}</div></header>
      <div class="fields">
        <label class="f"><span>Importo (€)</span><input name="importo" class="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${item ? moneyInput(item.importo) : moneyInput(preset.importo)}"></label>
        <div class="two">
          <label class="f"><span>Suddivisione</span><select name="div">${KEYS.map(k => `<option value="${k}" ${k === div ? 'selected' : ''}>${DIV[k].nome}</option>`).join('')}</select></label>
          <label class="f"><span data-cat-label>Categoria</span><select name="categoria">${catOptions(div, sel0, tipo0, allowGoal)}</select></label>
        </div>
        <div class="f"><span>Tipo di movimento</span><div class="seg seg-radio" data-tipi>${tipoRadios(div, tipo0, withPrelievo, withRisRiporto)}</div></div>
        <div class="calc" data-tipo-hint></div>
        <label class="f" data-newcat hidden><span>Nome della nuova categoria</span><input name="nuova" maxlength="40" placeholder="Es. Palestra"></label>
        <div class="two">
          <label class="f"><span>Descrizione <span class="hint">(facoltativa)</span></span><input name="descrizione" maxlength="80" value="${esc(item ? item.descrizione : preset.descrizione || '')}"></label>
          <label class="f"><span>Data</span><input type="date" name="data" value="${item ? item.data : defaultDate(y, m)}" min="${iso(y, m, 1)}" max="${iso(y, m, daysIn(y, m))}"></label>
        </div>
        <label class="check"><input type="checkbox" name="ricorrente" ${item && item.ricorrente ? 'checked' : ''}><span>Voce ricorrente: proponi di copiarla nei mesi successivi</span></label>
        <div class="error-msg" role="alert"></div>
      </div>
      <footer>
        ${isNew ? '' : `<button type="button" data-dlg-delete class="btn danger">${icon('trash')} Elimina</button>`}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Annulla</button>
        <button type="submit" value="save" class="btn primary">Salva</button>
      </footer>
    </form>`, (form, action) => {
      if (action === 'delete') { removeWithUndo(y, m, findItem(y, m, id), 'Voce'); return true; }
      let importo = readAmount(form);
      if (importo == null) return 'Inserisci un importo valido (es. 12,50).';
      const d = form.div.value;
      let tipo = checkedTipo(form);
      if (d === 'ris' && tipo === 'spesa' && importo < 0) tipo = 'prelievo';
      if (tipo === 'prelievo') importo = Math.abs(importo);
      const sel = form.categoria.value;
      let categoria, obiettivo = null;
      if (sel === '__new') {
        categoria = form.nuova.value.trim();
        if (!categoria) return 'Scrivi il nome della nuova categoria.';
      } else if (sel.startsWith('goal:')) {
        const g = budget.goal(sel.slice(5));
        if (!g) return 'Obiettivo non trovato.';
        obiettivo = g.id;
        categoria = g.nome;
      } else {
        categoria = sel;
      }
      if (tipo === 'prelievo' && obiettivo && obiettivo !== allowGoal) return 'I soldi degli obiettivi sono vincolati: si usano solo con «Usa il fondo» nella scheda dell\'obiettivo.';
      if (tipo === 'prelievo' && d === 'des' && !obiettivo) return `In ${DIV.des.nome} si preleva solo dal fondo di un obiettivo.`;
      if (sel === '__new' && !budget.settings.categorie[d].includes(categoria)) { budget.settings.categorie[d].push(categoria); markSettings(); }
      const data = {
        div: d, tipo, categoria, importo,
        descrizione: form.descrizione.value.trim(),
        data: clampDate(form.data.value, y, m),
        ricorrente: form.ricorrente.checked,
      };
      if (obiettivo) data.obiettivo = obiettivo;
      const mo = budget.ensureMonth(y, m);
      const cur = id ? findItem(y, m, id) : null;
      if (cur) {
        Object.assign(cur.item, data);
        if (!obiettivo) delete cur.item.obiettivo;
      } else {
        mo.uscite.push({ id: Model.newId(), ...data });
      }
      markDirty(y);
      render();
      return true;
    }, form => {
      const newCat = form.querySelector('[data-newcat]');
      const hint = form.querySelector('[data-tipo-hint]');
      const catLabel = form.querySelector('[data-cat-label]');
      const tipi = form.querySelector('[data-tipi]');
      const refresh = () => {
        newCat.hidden = form.categoria.value !== '__new';
        catLabel.textContent = checkedTipo(form) === 'prelievo' ? 'Da quale fondo' : 'Categoria o obiettivo';
        hint.innerHTML = tipoHint(y, m, form, item, allowGoal);
      };
      const rebuildCats = () => {
        const sel = form.categoria.value;
        form.categoria.innerHTML = catOptions(form.div.value, sel, checkedTipo(form), allowGoal);
      };
      form.div.addEventListener('change', () => {
        tipi.innerHTML = tipoRadios(form.div.value, checkedTipo(form), withPrelievo, withRisRiporto);
        form.categoria.innerHTML = catOptions(form.div.value, null, checkedTipo(form), allowGoal);
        refresh();
      });
      tipi.addEventListener('change', () => { rebuildCats(); refresh(); });
      form.categoria.addEventListener('change', () => { refresh(); if (!newCat.hidden) form.nuova.focus(); });
      form.importo.addEventListener('input', refresh);
      refresh();
      form.importo.focus();
      form.importo.select();
    });
  }

  function dlgEntrata(y, m, id) {
    const found = id ? findItem(y, m, id) : null;
    const item = found ? found.item : null;
    openDialog(`<form class="dlg" novalidate>
      <header><h2>${item ? 'Modifica entrata' : 'Nuova entrata'}</h2><div class="muted">${monthLabel(y, m)}</div></header>
      <div class="fields">
        <label class="f"><span>Importo (€)</span><input name="importo" class="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${item ? moneyInput(item.importo) : ''}"></label>
        <div class="two">
          <label class="f"><span>Descrizione</span><input name="descrizione" maxlength="80" placeholder="Es. Stipendio" value="${esc(item ? item.descrizione : '')}"></label>
          <label class="f"><span>Data</span><input type="date" name="data" value="${item ? item.data : defaultDate(y, m)}" min="${iso(y, m, 1)}" max="${iso(y, m, daysIn(y, m))}"></label>
        </div>
        <label class="check"><input type="checkbox" name="ricorrente" ${!item || item.ricorrente ? 'checked' : ''}><span>Entrata ricorrente (es. stipendio)</span></label>
        <div class="error-msg" role="alert"></div>
      </div>
      <footer>
        ${item ? `<button type="button" data-dlg-delete class="btn danger">${icon('trash')} Elimina</button>` : ''}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Annulla</button>
        <button type="submit" value="save" class="btn primary">Salva</button>
      </footer>
    </form>`, (form, action) => {
      if (action === 'delete') { removeWithUndo(y, m, findItem(y, m, id), 'Entrata'); return true; }
      const importo = readAmount(form);
      if (importo == null) return 'Inserisci un importo valido (es. 1.850,00).';
      const data = {
        importo,
        descrizione: form.descrizione.value.trim() || 'Entrata',
        data: clampDate(form.data.value, y, m),
        ricorrente: form.ricorrente.checked,
      };
      const mo = budget.ensureMonth(y, m);
      const cur = id ? findItem(y, m, id) : null;
      if (cur) Object.assign(cur.item, data);
      else mo.entrate.push({ id: Model.newId(), ...data });
      markDirty(y);
      render();
      return true;
    }, form => { form.importo.focus(); form.importo.select(); });
  }

  function percInputs(p) {
    return KEYS.map(k => `<label class="f"><span><span class="swatch sw-${k}"></span> ${DIV[k].nome} (%)</span><input type="number" name="${k}" min="0" max="100" step="1" value="${p[k]}" data-perc></label>`).join('');
  }

  function readPerc(form) {
    const p = {};
    for (const k of KEYS) p[k] = Number(String(form[k].value).replace(',', '.'));
    if (KEYS.some(k => !isFinite(p[k]) || p[k] < 0)) return null;
    if (Math.abs(p.nec + p.des + p.ris - 100) > 0.01) return null;
    return p;
  }

  function wirePercTotal(form) {
    const out = form.querySelector('[data-perc-total]');
    const upd = () => {
      const s = KEYS.reduce((a, k) => a + (Number(String(form[k].value).replace(',', '.')) || 0), 0);
      out.textContent = `Totale ${pctTxt(r2(s))}`;
      out.classList.toggle('bad', Math.abs(s - 100) > 0.01);
    };
    form.addEventListener('input', upd);
    upd();
  }

  function dlgPerc(y, m) {
    const p = budget.perc(y, m);
    openDialog(`<form class="dlg" novalidate>
      <header><h2>Suddivisione di ${monthLabel(y, m).toLowerCase()}</h2><div class="muted">La somma deve fare 100%</div></header>
      <div class="fields">
        <div class="two" style="grid-template-columns:1fr 1fr 1fr">${percInputs(p)}</div>
        <div class="perc-total" data-perc-total></div>
        <label class="check"><input type="checkbox" name="predef"><span>Usala anche come predefinita per i mesi nuovi</span></label>
        <div class="error-msg" role="alert"></div>
      </div>
      <footer><button type="button" class="btn ghost" data-action="reset-perc">Ripristina 50/30/20</button><span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Annulla</button><button type="submit" class="btn primary">Applica</button></footer>
    </form>`, form => {
      const np = readPerc(form);
      if (!np) return 'Le tre percentuali devono essere positive e sommare a 100.';
      budget.ensureMonth(y, m).perc = np;
      if (form.predef.checked) { budget.settings.percentuali = { ...np }; markSettings(); }
      markDirty(y);
      render();
      return true;
    }, wirePercTotal);
  }

  /** Calcoli del dialogo obiettivo: copertura con avanzo/risparmi, rata e proiezione. */
  function goalCalc(form, g) {
    const t = today();
    const checkedDiv = form.querySelector('input[name="gdiv"]:checked');
    const div = g ? g.div : checkedDiv ? checkedDiv.value : 'des';
    const importo = Model.parseAmount(form.importo.value);
    const ini = Model.parseAmount(form.iniziale.value);
    const iniziale = isFinite(ini) ? ini : 0;
    const scadenza = form.scadenza.value;
    // Risparmi: si copre con un fondo libero scelto; Svago: con l'avanzo dei mesi precedenti.
    const sources = div === 'ris' ? budget.funds().filter(f => f.div === 'ris' && !f.obiettivo && f.saldo > 0.004) : [];
    const fonte = div === 'ris' && form.fonte ? form.fonte.value : null;
    const disp = div === 'ris'
      ? r2((sources.find(f => f.categoria === fonte) || { saldo: 0 }).saldo)
      : r2(Math.max(0, budget.disponibile(t.y, t.m)[div]));
    const ok = isFinite(importo) && importo > 0 && /^\d{4}-\d{2}$/.test(scadenza);
    const probe = { id: g ? g.id : null, div, importo, scadenza, iniziale, rata: 0 };
    const base = ok ? budget.goalStatus(probe, t) : null;
    const max = base && base.stato === 'attivo' ? r2(Math.min(disp, base.mancante)) : 0;
    const choice = (form.querySelector('input[name="rip"]:checked') || {}).value || 'no';
    let amount = 0;
    if (choice === 'max') amount = max;
    else if (choice === 'custom') { const v = Model.parseAmount(form.ripImporto.value); amount = isFinite(v) ? v : NaN; }
    const covered = { ...probe, iniziale: iniziale + (isFinite(amount) && amount > 0 ? amount : 0) };
    const withRip = ok ? budget.goalStatus(covered, t) : null;
    const suggerita = withRip && withRip.stato === 'attivo' ? withRip.necessaria : 0;
    const rv = Model.parseAmount(form.rata.value);
    const rata = isFinite(rv) && rv > 0 ? rv : 0;
    const proj = withRip && withRip.stato === 'attivo' && rata > 0 ? budget.goalStatus({ ...covered, rata }, t) : null;
    return { t, div, importo, iniziale, scadenza, sources, fonte, disp, max, choice, amount, base, withRip, suggerita, rata, proj };
  }

  function goalPreview(form, g) {
    const auto = form.rata.dataset.auto === '1';
    let c = goalCalc(form, g);
    if (auto && c.suggerita > 0 && Model.parseAmount(form.rata.value) !== c.suggerita) {
      form.rata.value = moneyInput(c.suggerita);
      c = goalCalc(form, g);
    }
    const box = form.querySelector('[data-ripbox]');
    const isRis = c.div === 'ris';
    const nome = DIV[c.div].nome.toLowerCase();
    box.querySelector('[data-rip-title]').textContent = isRis
      ? 'Coprire una parte con i risparmi già accumulati?'
      : `Coprire una parte con l'avanzo dei mesi precedenti di ${nome}?`;
    const fonteWrap = box.querySelector('[data-fonte]');
    fonteWrap.hidden = !isRis || !c.sources.length;
    if (isRis && c.sources.length) {
      const sel = form.fonte.value;
      const html = c.sources.map(f => `<option value="${esc(f.categoria)}" ${f.categoria === sel ? 'selected' : ''}>${esc(f.categoria)} · ${eur(f.saldo)}</option>`).join('');
      if (form.fonte.innerHTML !== html) { form.fonte.innerHTML = html; c = goalCalc(form, g); }
    }
    const already = g ? budget.goalStatus(g, c.t).dalRiporto : 0;
    const alreadyTxt = already ? ` Già usati per questo obiettivo: ${eur(already)}.` : '';
    box.querySelector('[data-rip-sub]').innerHTML = c.disp > 0
      ? (isRis
        ? `Nel fondo scelto ci sono <strong>${eur(c.disp)}</strong>: quello che sposti abbassa la rata ed esce dai risparmi liberi.${alreadyTxt}`
        : `Avanzo disponibile ora: <strong>${eur(c.disp)}</strong>. Quello che usi abbassa la rata e viene tolto dall'avanzo.${alreadyTxt}`)
      : (isRis ? `Non hai ancora risparmi liberi accumulati.${alreadyTxt}` : `Non c'è avanzo disponibile in ${nome} questo mese.${alreadyTxt}`);
    box.querySelectorAll('input[name="rip"]').forEach(r => { if (r.value !== 'no') r.disabled = c.max <= 0; });
    form.ripImporto.disabled = c.max <= 0;
    box.querySelector('[data-rip-max]').textContent = c.max > 0 ? `Usa il massimo utile: ${eur(c.max)}` : 'Usa il massimo utile';
    if (c.max <= 0 && c.choice !== 'no') { form.querySelector('input[name="rip"][value="no"]').checked = true; c = goalCalc(form, g); }

    const rataHint = form.querySelector('[data-rata-hint]');
    rataHint.innerHTML = c.suggerita > 0 && Math.abs(c.suggerita - c.rata) > 0.004
      ? `Per arrivare alla scadenza servono ${eur(c.suggerita)} al mese. <button type="button" class="link" data-rata-auto>Usa questa</button>`
      : c.suggerita > 0 ? 'Calcolata per arrivare alla scadenza.' : '';

    const out = form.querySelector('[data-calc]');
    if (!c.base) { out.innerHTML = 'Inserisci importo e scadenza per vedere la rata mensile.'; return; }
    if (c.base.stato === 'scaduto') { out.innerHTML = 'La scadenza è già passata.'; return; }
    if (!c.withRip || c.withRip.stato === 'raggiunto') { out.innerHTML = 'Con quanto già messo da parte l\'obiettivo è raggiunto.'; return; }
    if (!c.proj) { out.innerHTML = 'Inserisci la rata mensile.'; return; }
    const p = c.proj;
    let txt = `Con <strong>${eur(c.rata)}</strong> al mese il fondo è pronto <strong>${aMese(p.pronto)}</strong>`;
    if (p.scartoMesi > 0) txt += `, ${nMesi(p.scartoMesi)} prima della scadenza`;
    else if (p.scartoMesi < 0) txt += `, <span class="neg">${nMesi(-p.scartoMesi)} dopo la scadenza</span>`;
    else txt += ', in tempo per la scadenza';
    txt += '.';
    if (c.amount > 0 && isFinite(c.amount)) txt += ` Senza usare ${isRis ? 'i risparmi' : 'l\'avanzo'} servirebbero ${eur(c.base.necessaria)} al mese.`;
    const bud = budget.stats(c.t.y, c.t.m).budget[c.div];
    if (bud > 0) txt += ` La rata è il ${pctTxt(r2(c.rata / bud * 100))} del budget ${nome} di ${MESI[c.t.m].toLowerCase()}.`;
    out.innerHTML = txt;
  }

  /** Stato dell'obiettivo se oggi si svincolassero x euro dal suo fondo. */
  const afterRelease = (g, x) => budget.goalStatus({ ...g, iniziale: (g.iniziale || 0) - x }, today());

  /**
   * Svincola una parte del fondo per spese non legate all'obiettivo. Svago: i soldi tornano
   * nell'avanzo di Svago. Risparmi: tornano nei risparmi liberi, nel fondo scelto. Il messo da
   * parte cala, quindi si sceglie se ricalcolare la rata o spostare la scadenza.
   */
  function dlgRelease(id) {
    const g = budget.goal(id);
    if (!g) return;
    const t = today();
    if (state.yearErrors[t.y]) { toast('Il file dell\'anno corrente non è leggibile.', { error: true }); return; }
    const s = budget.goalStatus(g, t);
    const isRis = g.div === 'ris';
    const dests = budget.settings.categorie.ris;
    const defDest = dests.includes('Fondo di emergenza') ? 'Fondo di emergenza' : dests[0];

    openDialog(`<form class="dlg" novalidate>
      <header><h2>Svincola dal fondo</h2><div class="muted">${esc(g.nome)} · nel fondo ci sono ${eur(s.fondo)}</div></header>
      <div class="fields">
        <p class="small muted">${isRis
          ? 'I soldi svincolati tornano nei risparmi accumulati, nel fondo che scegli: da lì potrai prelevarli per altre spese.'
          : `I soldi svincolati tornano nell'avanzo di ${DIV.des.nome}: potrai usarli per altre spese di svago.`}
          Per una spesa che riguarda l'obiettivo (es. i biglietti del volo) usa invece «Usa il fondo».</p>
        <label class="f"><span>Importo da svincolare (€)</span><input name="importo" class="amount" inputmode="decimal" autocomplete="off" placeholder="0,00">
          <span class="hint">Al massimo ${eur(s.fondo)} · <button type="button" class="link" data-all>tutto</button></span></label>
        ${isRis && dests.length ? `<label class="f"><span>Sposta nel fondo</span><select name="dest">${dests.map(c => `<option value="${esc(c)}" ${c === defDest ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
        <label class="f"><span>Per cosa <span class="hint">(facoltativo)</span></span><input name="descrizione" maxlength="80" placeholder="Es. regalo di compleanno"></label>
        <fieldset class="rip-box"><legend>Dopo lo svincolo</legend><div class="small" data-plan></div></fieldset>
        <div class="error-msg" role="alert"></div>
      </div>
      <footer><span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Annulla</button>
        <button type="submit" value="save" class="btn primary">Svincola</button>
      </footer>
    </form>`, form => {
      const x = Model.parseAmount(form.importo.value);
      if (!isFinite(x) || x <= 0) return 'Inserisci l\'importo da svincolare.';
      if (x > s.fondo + 0.004) return `Nel fondo ci sono solo ${eur(s.fondo)}.`;
      if (isRis && !(form.dest && form.dest.value)) return 'Scegli il fondo dei risparmi in cui spostare i soldi.';
      const amt = r2(x);
      const a = afterRelease(g, amt);
      const plan = (form.querySelector('input[name="plan"]:checked') || {}).value;
      const desc = form.descrizione.value.trim();
      const mo = budget.ensureMonth(t.y, t.m);
      mo.uscite.push({
        id: Model.newId(), div: g.div, tipo: 'riporto', obiettivo: g.id, categoria: g.nome, importo: -amt,
        descrizione: desc ? `Svincolati: ${desc}` : 'Svincolati dal fondo', data: isoToday(), ricorrente: false,
      });
      if (isRis) {
        mo.uscite.push({
          id: Model.newId(), div: 'ris', tipo: 'riporto', categoria: form.dest.value, importo: amt,
          descrizione: `Svincolati dall'obiettivo «${g.nome}»`, data: isoToday(), ricorrente: false,
        });
      }
      let msg = `Svincolati ${eur(amt)} da «${g.nome}»: ${isRis ? `ora sono in «${form.dest.value}»` : `ora sono nell'avanzo di ${DIV.des.nome}`}.`;
      if (plan === 'rata' && a.necessaria > 0) { g.rata = a.necessaria; msg += ` Nuova rata: ${eur(a.necessaria)}.`; }
      if (plan === 'data' && a.piano === 'ritardo') { g.scadenza = a.pronto; msg += ` Nuova scadenza: ${monthName(a.pronto)}.`; }
      markDirty(t.y);
      markSettings();
      render();
      toast(msg, { ms: 7000 });
      return true;
    }, form => {
      const box = form.querySelector('[data-plan]');
      const upd = () => {
        const v = Model.parseAmount(form.importo.value);
        if (!isFinite(v) || v <= 0) { box.innerHTML = 'Inserisci l\'importo per vedere come cambia il piano.'; return; }
        const a = afterRelease(g, Math.min(v, s.fondo));
        if (a.stato === 'scaduto') { box.innerHTML = 'La scadenza è già passata: la rata non cambia.'; return; }
        if (a.stato === 'raggiunto') { box.innerHTML = 'Anche dopo lo svincolo l\'obiettivo resta raggiunto.'; return; }
        if (a.piano !== 'ritardo') { box.innerHTML = `Il piano resta in linea: con ${eur(a.rata)} al mese arrivi comunque alla scadenza.`; return; }
        const prev = (form.querySelector('input[name="plan"]:checked') || {}).value || 'rata';
        const opt = (value, html) => `<label class="check"><input type="radio" name="plan" value="${value}" ${value === prev ? 'checked' : ''}><span>${html}</span></label>`;
        box.innerHTML = `<p class="muted" style="margin:0 0 6px">Nel fondo resteranno ${eur(r2(a.fondo))} e con la rata attuale saresti indietro.</p>` +
          opt('rata', `<strong>Ricalcola la rata</strong>: ${eur(a.necessaria)} al mese invece di ${eur(a.rata)}, scadenza invariata (${monthName(g.scadenza)})`) +
          opt('data', `<strong>Mantieni la rata</strong> di ${eur(a.rata)}: il fondo sarà pronto ${aMese(a.pronto)} invece che ${aMese(g.scadenza)}`) +
          opt('dopo', 'Decido dopo: la scheda dell\'obiettivo ti mostrerà le proposte');
      };
      form.addEventListener('input', e => { if (e.target.name === 'importo') upd(); });
      form.querySelector('[data-all]').addEventListener('click', () => { form.importo.value = moneyInput(s.fondo); upd(); });
      upd();
      form.importo.focus();
    });
  }

  /** Elimina un obiettivo. Svago: i soldi rimasti tornano nell'avanzo. Risparmi: tornano nei risparmi liberi. */
  function deleteGoal(g) {
    const t = today();
    const s = budget.goalStatus(g, t);
    const inApp = r2(Math.max(0, Math.min(s.fondo, s.accantonato - (g.iniziale || 0))));
    let msg = `Eliminare l'obiettivo «${g.nome}»?`;
    if (inApp > 0) {
      msg += g.div === 'des'
        ? `\n\nI ${eur(inApp)} messi da parte tornano nell'avanzo di ${DIV.des.nome}.`
        : `\n\nI ${eur(inApp)} messi da parte tornano nei risparmi accumulati, come fondo libero «${g.nome}».`;
    }
    if (!confirm(msg)) return false;
    if (inApp > 0 && g.div === 'des') {
      if (state.yearErrors[t.y]) return 'Il file dell\'anno corrente non è leggibile: non posso restituire i soldi all\'avanzo.';
      budget.ensureMonth(t.y, t.m).uscite.push({
        id: Model.newId(), div: g.div, tipo: 'riporto', categoria: g.nome, importo: -inApp,
        descrizione: `Rientro dall'obiettivo «${g.nome}»`, data: isoToday(), ricorrente: false,
      });
      markDirty(t.y);
    }
    if (inApp > 0 && g.div === 'ris' && !budget.settings.categorie.ris.includes(g.nome)) budget.settings.categorie.ris.push(g.nome);
    for (const y of budget.years()) {
      let touched = false;
      for (const mo of budget.anni[y].mesi) for (const u of mo.uscite) if (u.obiettivo === g.id) { delete u.obiettivo; touched = true; }
      if (touched) markDirty(y);
    }
    budget.settings.obiettivi = budget.settings.obiettivi.filter(x => x !== g);
    markSettings();
    render();
    return true;
  }

  function dlgGoal(id, opts = {}) {
    const g = id ? budget.goal(id) : null;
    const t = today();
    const minMonth = `${t.y}-${pad(t.m + 1)}`;
    const div0 = g ? g.div : 'des';
    const rata0 = g ? budget.goalStatus(g, t).rata || g.rata : 0;

    const divField = g
      ? `<div class="f"><span>Si accantona dal budget</span><div class="goal-div fixed"><span class="swatch sw-${g.div}"></span>${DIV[g.div].nome}</div></div>`
      : `<div class="f"><span>Da quale budget accantonare?</span>
          <div class="seg seg-radio">${Model.GOAL_DIVS.map(k => `<label><input type="radio" name="gdiv" value="${k}" ${k === div0 ? 'checked' : ''}><span>${DIV[k].nome}</span></label>`).join('')}</div>
          <span class="hint">${DIV.des.nome}: qualcosa che vuoi (es. Viaggio). ${DIV.ris.nome}: una spesa futura prevista (es. caldaia tra 3 anni).</span></div>`;

    openDialog(`<form class="dlg" novalidate>
      <header><h2>${g ? 'Modifica obiettivo' : 'Nuovo obiettivo'}</h2><div class="muted">Es. Viaggio · 3.000 € · maggio 2028</div></header>
      <div class="fields">
        <label class="f"><span>Nome</span><input name="nome" maxlength="40" placeholder="Viaggio" value="${esc(g ? g.nome : '')}"></label>
        ${divField}
        <div class="two">
          <label class="f"><span>Importo da raggiungere (€)</span><input name="importo" inputmode="decimal" placeholder="3.000,00" value="${g ? moneyInput(g.importo) : ''}"></label>
          <label class="f"><span>Mi servono entro</span><input type="month" name="scadenza" min="${minMonth}" value="${g ? g.scadenza : ''}"></label>
        </div>
        <label class="f"><span>Già messi da parte fuori dall'app (€) <span class="hint">facoltativo</span></span><input name="iniziale" inputmode="decimal" placeholder="0,00" value="${g && g.iniziale ? moneyInput(g.iniziale) : ''}"></label>
        <fieldset class="rip-box" data-ripbox>
          <legend data-rip-title></legend>
          <div class="small muted" data-rip-sub></div>
          <label class="f" data-fonte hidden><span>Da quale fondo</span><select name="fonte"></select></label>
          <label class="check"><input type="radio" name="rip" value="no" checked><span>No, accantono tutto con le rate</span></label>
          <label class="check"><input type="radio" name="rip" value="max"><span data-rip-max>Usa il massimo utile</span></label>
          <label class="check"><input type="radio" name="rip" value="custom"><span>Un importo a piacere</span><input name="ripImporto" class="rip-amount" inputmode="decimal" placeholder="0,00" aria-label="Importo da usare subito"></label>
        </fieldset>
        <label class="f"><span>Rata mensile (€)</span><input name="rata" class="amount" inputmode="decimal" placeholder="0,00" data-auto="${g ? '0' : '1'}" value="${rata0 ? moneyInput(rata0) : ''}"><span class="hint" data-rata-hint></span></label>
        <div class="calc" data-calc></div>
        <p class="hint small muted">La rata resta fissa: se accantoni di più o di meno, nella scheda dell'obiettivo ti verrà proposto di cambiarla o di spostare la scadenza. L'obiettivo ha un fondo tutto suo, escluso da avanzi e risparmi.</p>
        <div class="error-msg" role="alert"></div>
      </div>
      <footer>
        ${g ? `<button type="button" data-dlg-delete class="btn danger">${icon('trash')} Elimina</button>` : ''}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Annulla</button>
        <button type="submit" value="save" class="btn primary">Salva</button>
      </footer>
    </form>`, (form, action) => {
      if (action === 'delete') return deleteGoal(g);
      const nome = form.nome.value.trim();
      const c = goalCalc(form, g);
      if (!nome) return 'Dai un nome all\'obiettivo.';
      if (!isFinite(c.importo) || c.importo <= 0) return 'Inserisci l\'importo da raggiungere.';
      if (!/^\d{4}-\d{2}$/.test(c.scadenza)) return 'Scegli il mese di scadenza.';
      if (!isFinite(c.amount) || c.amount < 0) return 'Importo da usare subito non valido.';
      if (c.amount > c.max + 0.004) return `Puoi usare al massimo ${eur(c.max)}.`;
      if (c.withRip && c.withRip.stato === 'attivo' && !(c.rata > 0)) return 'Inserisci la rata mensile.';
      if (c.amount > 0 && state.yearErrors[t.y]) return 'Il file dell\'anno corrente non è leggibile: non posso registrare il movimento.';
      const dup = budget.goalsOf(c.div).find(x => x !== g && x.nome.toLowerCase() === nome.toLowerCase());
      if (dup) return `Esiste già un obiettivo «${dup.nome}» in ${DIV[c.div].nome}.`;
      const data = { nome, importo: c.importo, scadenza: c.scadenza, iniziale: c.iniziale, rata: r2(c.rata) };
      let goalId;
      if (g) {
        if (g.nome !== nome) {
          // il nome dell'obiettivo compare nei movimenti e nel file Excel
          for (const y of budget.years()) {
            let touched = false;
            for (const mo of budget.anni[y].mesi) for (const u of mo.uscite) if (u.obiettivo === g.id) { u.categoria = nome; touched = true; }
            if (touched) markDirty(y);
          }
        }
        Object.assign(g, data);
        goalId = g.id;
      } else {
        goalId = Model.newId();
        budget.settings.obiettivi.push({ id: goalId, div: c.div, creato: isoToday(), ...data });
      }
      if (c.amount > 0) {
        const amt = r2(c.amount);
        const mo = budget.ensureMonth(t.y, t.m);
        if (c.div === 'ris') {
          // dai risparmi liberi al fondo dell'obiettivo: esce dal fondo scelto, entra nell'obiettivo
          mo.uscite.push({ id: Model.newId(), div: 'ris', tipo: 'prelievo', categoria: c.fonte, importo: amt, descrizione: `Spostati all'obiettivo «${nome}»`, data: isoToday(), ricorrente: false });
          mo.uscite.push({ id: Model.newId(), div: 'ris', tipo: 'riporto', obiettivo: goalId, categoria: nome, importo: amt, descrizione: `Dai risparmi (${c.fonte})`, data: isoToday(), ricorrente: false });
          toast(`Spostati ${eur(amt)} da «${c.fonte}» all'obiettivo «${nome}».`);
        } else {
          mo.uscite.push({ id: Model.newId(), div: c.div, tipo: 'riporto', obiettivo: goalId, categoria: nome, importo: amt, descrizione: `Dall'avanzo per ${nome}`, data: isoToday(), ricorrente: false });
          toast(`Usati ${eur(amt)} dell'avanzo di ${DIV[c.div].nome.toLowerCase()} per «${nome}».`);
        }
        markDirty(t.y);
      }
      markSettings();
      render();
      return true;
    }, form => {
      const upd = () => goalPreview(form, g);
      form.addEventListener('input', e => { if (e.target.name === 'rata') form.rata.dataset.auto = '0'; upd(); });
      form.addEventListener('change', upd);
      form.addEventListener('click', e => { if (e.target.closest('[data-rata-auto]')) { form.rata.dataset.auto = '1'; upd(); } });
      form.ripImporto.addEventListener('focus', () => { form.querySelector('input[name="rip"][value="custom"]').checked = true; upd(); });
      upd();
      if (opts.focusRiporto) {
        form.rata.dataset.auto = '1';
        const max = form.querySelector('input[name="rip"][value="max"]');
        if (!max.disabled) { max.checked = true; upd(); }
        form.querySelector('[data-ripbox]').scrollIntoView({ block: 'center' });
      } else {
        form.nome.focus();
      }
    });
  }

  /* ========================================================== import/export */

  function yearFromName(name) {
    const r = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(name);
    return r ? Number(r[1]) : null;
  }

  async function importYear(name, buffer) {
    let wb;
    try { wb = await Model.readWorkbook(buffer); } catch (e) { toast(`«${name}» non è leggibile: ${e.message}`, { error: true }); return false; }
    let y = yearFromName(name) || Model.detectYear(wb);
    if (!y) {
      const ans = prompt(`A quale anno si riferisce «${name}»?`, String(today().y));
      y = Number(ans);
      if (!(y > 1900 && y < 3000)) return false;
    }
    let data;
    try { data = Model.yearFromWorkbook(wb, y); } catch (e) { toast(`«${name}»: ${e.message}`, { error: true }); return false; }
    const existing = budget.anni[y];
    if (existing && existing.mesi.some(Model.hasData) && !confirm(`Sostituire i dati del ${y} con quelli di «${name}»?`)) return false;
    budget.anni[y] = data;
    delete state.yearErrors[y];
    budget.linkGoalNames(data);
    if (budget.addMissingCategories(data)) markSettings();
    markDirty(y);
    return y;
  }

  function importSettings(text, name) {
    let obj;
    try { obj = JSON.parse(text); } catch { toast(`«${name}» non è un file di impostazioni valido.`, { error: true }); return false; }
    if (!confirm('Sostituire percentuali, categorie e obiettivi con quelli del file importato?')) return false;
    budget.settings = Model.normalizeSettings(obj);
    for (const y of budget.years()) budget.addMissingCategories(budget.anni[y]);
    markSettings();
    return true;
  }

  async function importFiles(files) {
    const done = [];
    for (const file of files) {
      try {
        if (/\.zip$/i.test(file.name)) {
          const z = XlsxLite.unzip(await file.arrayBuffer());
          for (const n of z.names()) {
            const base = n.split('/').pop();
            if (/\.xlsx$/i.test(base) && !base.startsWith('~$')) { const y = await importYear(base, await z.bytes(n)); if (y) done.push(String(y)); }
            else if (/^impostazioni\.json$/i.test(base) && importSettings(await z.text(n), base)) done.push('impostazioni');
          }
        } else if (/\.xlsx$/i.test(file.name)) {
          const y = await importYear(file.name, await file.arrayBuffer());
          if (y) done.push(String(y));
        } else if (/\.json$/i.test(file.name)) {
          if (importSettings(await file.text(), file.name)) done.push('impostazioni');
        } else {
          toast(`Formato non supportato: ${file.name}`, { error: true });
        }
      } catch (e) {
        console.error(e);
        toast(`Errore con «${file.name}»: ${e.message}`, { error: true });
      }
    }
    if (done.length) {
      toast('Importato: ' + done.join(', '));
      render();
    }
  }

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function exportYear(y) {
    const t = today();
    download(Model.fileName(y), Model.yearToXlsx(budget, y, y === t.y ? t.m : null), XLSX_MIME);
  }

  function exportAll() {
    const files = budget.years().map(y => ({ name: Model.fileName(y), data: Model.yearToXlsx(budget, y) }));
    files.push({ name: 'impostazioni.json', data: JSON.stringify(budget.settings, null, 2) });
    download(`Hose_backup_${isoToday()}.zip`, XlsxLite.zip(files), 'application/zip');
  }

  function copyRecurring(y, m) {
    const src = recurringSource(y, m);
    if (!src) return;
    const mo = budget.ensureMonth(y, m);
    const dim = daysIn(y, m);
    const remap = it => ({ ...it, id: Model.newId(), data: iso(y, m, Math.min(Number(it.data.slice(8, 10)) || 1, dim)) });
    src.entrate.forEach(e => mo.entrate.push(remap(e)));
    src.uscite.forEach(u => mo.uscite.push(remap(u)));
    markDirty(y);
    render();
    const n = src.entrate.length + src.uscite.length;
    toast(`${n === 1 ? 'Copiata 1 voce ricorrente' : `Copiate ${n} voci ricorrenti`} da ${MESI[src.m].toLowerCase()}.`);
  }

  function applyTheme() {
    let t = 'auto';
    try { t = localStorage.getItem('salvadanaio.theme') || 'auto'; } catch { /* nessuno storage */ }
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  /* ================================================================= eventi */

  document.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { $dialog.close(); return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    const r = route();
    const locked = r.view === 'mese' && state.yearErrors[r.y];

    switch (a) {
      case 'setup-folder': await chooseFolder(); break;
      case 'setup-browser': Store.useBrowser(); await enterApp(); break;
      case 'reconnect':
        try {
          if (await Store.reconnect()) await enterApp();
          else toast('Permesso non concesso.', { error: true });
        } catch (err) { toast('Impossibile riconnettere la cartella: ' + describeError(err), { error: true }); }
        break;
      case 'retry-save': flush(); break;

      case 'add-entrata': if (!locked) dlgEntrata(r.y, r.m); break;
      case 'edit-entrata': if (!locked) dlgEntrata(r.y, r.m, el.dataset.id); break;
      case 'add-uscita': if (!locked) dlgUscita(r.y, r.m, null, { div: el.dataset.div }); break;
      case 'edit-uscita': if (!locked) dlgUscita(r.y, r.m, el.dataset.id); break;
      case 'edit-perc': if (!locked) dlgPerc(r.y, r.m); break;
      case 'reset-perc': {
        const form = el.closest('form');
        form.nec.value = 50; form.des.value = 30; form.ris.value = 20;
        form.dispatchEvent(new Event('input'));
        break;
      }
      case 'copy-recurring': if (!locked) copyRecurring(r.y, r.m); break;

      case 'goal-contribute': {
        const g = budget.goal(el.dataset.id);
        if (!g) break;
        const t = today();
        if (state.yearErrors[t.y]) { toast('Il file dell\'anno corrente non è leggibile.', { error: true }); break; }
        const s = budget.goalStatus(g, t);
        if (r.view !== 'mese' || r.y !== t.y || r.m !== t.m) location.hash = monthHref(t.y, t.m);
        dlgUscita(t.y, t.m, null, { div: g.div, obiettivo: g.id, importo: s.mancanteMese, descrizione: `Rata ${g.nome}` });
        break;
      }
      case 'goal-riporto': dlgGoal(el.dataset.id, { focusRiporto: true }); break;
      case 'goal-release': dlgRelease(el.dataset.id); break;
      case 'goal-spend': {
        const g = budget.goal(el.dataset.id);
        if (!g) break;
        const t = today();
        if (state.yearErrors[t.y]) { toast('Il file dell\'anno corrente non è leggibile.', { error: true }); break; }
        const s = budget.goalStatus(g, t);
        if (r.view !== 'mese' || r.y !== t.y || r.m !== t.m) location.hash = monthHref(t.y, t.m);
        dlgUscita(t.y, t.m, null, { div: g.div, tipo: 'prelievo', obiettivo: g.id, perObiettivo: true, importo: s.fondo, descrizione: g.nome });
        break;
      }
      case 'goal-plan': {
        const g = budget.goal(el.dataset.id);
        if (!g) break;
        if (el.dataset.rata) {
          g.rata = Number(el.dataset.rata);
          toast(`Rata di «${g.nome}» aggiornata a ${eur(g.rata)}.`);
        }
        if (el.dataset.scadenza) {
          const [yy, mm] = el.dataset.scadenza.split('-').map(Number);
          g.scadenza = el.dataset.scadenza;
          toast(`Scadenza di «${g.nome}» spostata ${/^[aeiou]/i.test(MESI[mm - 1]) ? 'ad' : 'a'} ${MESI[mm - 1].toLowerCase()} ${yy}.`);
        }
        markSettings();
        render();
        break;
      }
      case 'add-goal': dlgGoal(); break;
      case 'edit-goal': dlgGoal(el.dataset.id); break;

      case 'open-month': if (!e.target.closest('a')) location.hash = monthHref(Number(el.dataset.y), Number(el.dataset.m)); break;
      case 'open-year': if (!e.target.closest('a')) location.hash = `#/riepilogo/${el.dataset.y}`; break;

      case 'del-cat': {
        const k = el.dataset.div, i = Number(el.dataset.i);
        const name = budget.settings.categorie[k][i];
        const n = budget.usage(k, name);
        let msg = `Rimuovere la categoria «${name}»?`;
        if (n) msg += `\n\nÈ usata in ${n} ${n === 1 ? 'voce' : 'voci'}: le voci esistenti la manterranno, ma non sarà più proposta.`;
        if (!confirm(msg)) break;
        budget.settings.categorie[k].splice(i, 1);
        markSettings();
        render();
        break;
      }
      case 'change-folder': await chooseFolder(); break;
      case 'use-browser':
        if (!confirm('Passare al salvataggio nel browser? I dati attuali verranno copiati nel browser e la cartella non sarà più aggiornata.')) break;
        Store.useBrowser();
        Store.saveBrowser(budget.toJSON());
        state.dirtyYears.clear();
        state.dirtySettings = false;
        state.saveState = 'saved';
        state.savedAt = new Date();
        render();
        toast('Ora i dati vengono salvati nel browser.');
        break;
      case 'import': $import.value = ''; $import.click(); break;
      case 'export-xlsx': exportYear(Number(document.querySelector('[data-export-year]').value)); break;
      case 'export-csv': {
        const y = Number(document.querySelector('[data-export-year]').value);
        download(`Hose_${y}.csv`, Model.yearToCsv(budget, y), 'text/csv;charset=utf-8');
        break;
      }
      case 'export-all': exportAll(); break;
      case 'theme':
        try { if (el.dataset.v === 'auto') localStorage.removeItem('salvadanaio.theme'); else localStorage.setItem('salvadanaio.theme', el.dataset.v); } catch { /* nessuno storage */ }
        applyTheme();
        render();
        break;
      default: break;
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.change === 'jump-month' && /^\d{4}-\d{2}$/.test(el.value)) {
      const [y, m] = el.value.split('-').map(Number);
      location.hash = monthHref(y, m - 1);
    }
  });

  $import.addEventListener('change', () => { if ($import.files.length) importFiles([...$import.files]); });

  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'perc-default') {
      const p = readPerc(form);
      if (!p) { toast('Le tre percentuali devono sommare a 100.', { error: true }); return; }
      budget.settings.percentuali = p;
      markSettings();
      render();
      toast('Suddivisione predefinita aggiornata.');
    } else if (form.dataset.form === 'add-cat') {
      const k = form.dataset.div;
      const nome = form.nome.value.trim();
      if (!nome) return;
      if (budget.settings.categorie[k].some(c => c.toLowerCase() === nome.toLowerCase())) { toast('Questa categoria esiste già.', { error: true }); return; }
      budget.settings.categorie[k].push(nome);
      markSettings();
      render();
      const again = document.querySelector(`form[data-form="add-cat"][data-div="${k}"] input`);
      if (again) again.focus();
    }
  });

  document.addEventListener('input', e => {
    const form = e.target.closest('form[data-form="perc-default"]');
    if (!form) return;
    const out = form.querySelector('[data-perc-total]');
    const s = KEYS.reduce((a, k) => a + (Number(form[k].value) || 0), 0);
    out.textContent = `Totale ${pctTxt(r2(s))}`;
    out.classList.toggle('bad', Math.abs(s - 100) > 0.01);
  });

  // Scorciatoie: ← → per cambiare mese (fuori dai campi di testo)
  document.addEventListener('keydown', e => {
    if (!state.ready || $dialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) return;
    const r = route();
    if (r.view !== 'mese') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const p = shiftMonth(r.y, r.m, e.key === 'ArrowLeft' ? -1 : 1);
      location.hash = monthHref(p.y, p.m);
    }
  });

  /* ================================================================== avvio */

  function viewGate(kind) {
    document.body.classList.add('gated');
    if (kind === 'reconnect') {
      $app.innerHTML = `<section class="card setup">
        <h1>Bentornato!</h1>
        <p>Per sicurezza il browser chiede di confermare l'accesso alla cartella dei dati.</p>
        <div class="actions">
          <button class="btn primary lg" data-action="reconnect">${icon('folder')} Riconnetti «${esc(Store.folderName())}»</button>
          <button class="btn ghost" data-action="setup-folder">Scegli un'altra cartella</button>
        </div>
        <p class="note">Suggerimento: quando Chrome o Edge lo chiedono, scegli <strong>«Consenti a ogni visita»</strong> per non dover ripetere questo passaggio.</p>
      </section>`;
      return;
    }
    $app.innerHTML = `<section class="card setup">
      <h1>Benvenuto in Hose</h1>
      <p>Ogni mese le entrate vengono divise in <strong>50% necessità</strong>, <strong>30% svago</strong> e <strong>20% risparmi</strong>. Prima di iniziare, scegli dove salvare i dati.</p>
      <div class="setup-options">
        <button class="option" data-action="setup-folder" ${Store.supportsFolder ? '' : 'disabled'}>
          ${icon('folder')}<span class="tag">Consigliato</span><strong>In una cartella del computer</strong>
          <span>Un file Excel per anno (Hose_2026.xlsx, …) aggiornato in automatico. Crea per esempio una cartella <b>dati</b> accanto a index.html: se è dentro OneDrive avrai anche il backup.</span>
        </button>
        <button class="option" data-action="setup-browser">
          ${icon('globe')}<strong>Solo in questo browser</strong>
          <span>Nessun file da gestire: i dati restano nel browser. Potrai esportare i file Excel o un backup quando vuoi.</span>
        </button>
      </div>
      ${Store.supportsFolder ? '' : '<p class="note">Questo browser non permette alle pagine di salvare nelle cartelle. Per avere i file Excel aggiornati in automatico apri <b>index.html</b> con Google Chrome o Microsoft Edge.</p>'}
    </section>`;
  }

  // App installabile e offline: il service worker funziona solo da un indirizzo web
  // (es. GitHub Pages), non aprendo index.html dal disco.
  function registerPwa() {
    if (!/^https?:$/.test(location.protocol)) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker non registrato:', e));
    }
    // Chiede al browser di non cancellare i dati di Hose quando manca spazio.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(ok => ok || navigator.storage.persist()).catch(() => {});
    }
  }

  async function start() {
    applyTheme();
    registerPwa();
    tooltip = Charts.initTooltip(document.getElementById('tooltip'));
    let status = 'setup';
    try { status = await Store.init(); } catch (e) { console.error(e); }
    if (status === 'ready') await enterApp();
    else viewGate(status === 'permission' ? 'reconnect' : 'setup');
  }

  // Per i test dalla console del browser.
  window.Hose = { budget, state, flush, render, importFiles };

  start();
})();
