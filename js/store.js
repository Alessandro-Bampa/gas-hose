/*
 * store.js — dove vivono i dati.
 *  - "folder": una cartella sul disco scelta dall'utente (File System Access API,
 *    Chrome/Edge). Un file Hose_AAAA.xlsx per anno + impostazioni.json.
 *    (I nomi interni "salvadanaio" qui sotto restano: cambiarli farebbe perdere la
 *    cartella già collegata e i dati salvati nel browser.)
 *    Il riferimento alla cartella viene ricordato in IndexedDB.
 *  - "browser": tutto in localStorage (per i browser senza accesso alle cartelle).
 *
 * Registro dell'import dalla banca: i movimenti già importati o scartati, per non
 * riproporli. Un file per mese (della data contabile) nella sottocartella import/
 * (import/AAAA-MM.json), oppure in una chiave a parte del browser. Si legge solo il
 * mese che serve, quando serve.
 */
(function (global) {
  'use strict';

  const LS_MODE = 'salvadanaio.mode';
  const LS_DATA = 'salvadanaio.data';
  const LS_IMPORT = 'salvadanaio.import';
  const SETTINGS_FILE = 'impostazioni.json';
  const IMPORT_DIR = 'import';
  const IMPORT_RE = /^(\d{4}-\d{2})\.json$/;

  /** Un record per riga: il file resta leggibile anche aperto a mano. */
  function logToJson(log) {
    const lines = Object.keys(log).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(log[k])}`);
    return `{\n${lines.join(',\n')}\n}\n`;
  }

  function parseLog(text, name) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* sotto */ }
    throw new Error(`${IMPORT_DIR}/${name} non è leggibile: correggilo o eliminalo`);
  }

  async function writeTo(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(data);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch { /* già chiuso */ }
      throw e;
    }
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage non disponibile */ } }

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('salvadanaio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kvGet(key) {
    try {
      const db = await idb();
      return await new Promise((resolve, reject) => {
        const req = db.transaction('kv').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch { return undefined; }
  }

  async function kvSet(key, value) {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const Store = {
    SETTINGS_FILE,
    IMPORT_DIR,
    logToJson,
    supportsFolder: typeof global.showDirectoryPicker === 'function',
    mode: null,
    dir: null,

    /** → 'ready' | 'permission' (serve un clic per riconnettere) | 'setup' */
    async init() {
      const mode = lsGet(LS_MODE);
      if (mode === 'browser') { this.mode = 'browser'; return 'ready'; }
      if (mode === 'folder' && this.supportsFolder) {
        const handle = await kvGet('dir');
        if (handle) {
          this.dir = handle;
          this.mode = 'folder';
          const p = await handle.queryPermission({ mode: 'readwrite' });
          return p === 'granted' ? 'ready' : 'permission';
        }
      }
      return 'setup';
    },

    async pickFolder() {
      const handle = await global.showDirectoryPicker({ id: 'salvadanaio-dati', mode: 'readwrite' });
      this.dir = handle;
      this.mode = 'folder';
      lsSet(LS_MODE, 'folder');
      try { await kvSet('dir', handle); } catch { /* verrà richiesta di nuovo al prossimo avvio */ }
    },

    async reconnect() {
      return (await this.dir.requestPermission({ mode: 'readwrite' })) === 'granted';
    },

    useBrowser() {
      this.mode = 'browser';
      lsSet(LS_MODE, 'browser');
    },

    folderName() { return this.dir ? this.dir.name : ''; },

    /**
     * Legge impostazioni.json e i file annuali della cartella. Se per un anno ci sono sia
     * Hose_AAAA.xlsx sia il vecchio Salvadanaio_AAAA.xlsx, vale quello nuovo.
     */
    async readFolder() {
      const out = { settings: null, settingsError: null, years: [] };
      for await (const [name, handle] of this.dir.entries()) {
        if (handle.kind !== 'file') continue;
        if (name.toLowerCase() === SETTINGS_FILE) {
          try { out.settings = JSON.parse(await (await handle.getFile()).text()); } catch (e) { out.settingsError = e; }
          continue;
        }
        const m = Model.FILE_RE.exec(name);
        if (m) out.years.push({ year: Number(m[2]), name, legacy: m[1].toLowerCase() !== 'hose', handle });
      }
      const byYear = new Map();
      for (const f of out.years) {
        const cur = byYear.get(f.year);
        if (!cur || (cur.legacy && !f.legacy)) byYear.set(f.year, f);
      }
      out.years = [...byYear.values()].sort((a, b) => a.year - b.year);
      for (const f of out.years) {
        f.buffer = await (await f.handle.getFile()).arrayBuffer();
        delete f.handle;
      }
      return out;
    },

    async writeFile(name, data) {
      await writeTo(this.dir, name, data);
    },

    loadBrowser() {
      try { return JSON.parse(lsGet(LS_DATA) || 'null'); } catch { return null; }
    },

    saveBrowser(obj) {
      localStorage.setItem(LS_DATA, JSON.stringify(obj));
    },

    /* ------------------------------------------------- registro dell'import */

    browserLogs() {
      try { return JSON.parse(lsGet(LS_IMPORT) || '{}') || {}; } catch { return {}; }
    },

    /** Registro di un mese ('AAAA-MM') → { rif: record }, vuoto se il file non c'è. */
    async readImportLog(key) {
      if (this.mode !== 'folder') return this.browserLogs()[key] || {};
      let fh;
      try {
        const dir = await this.dir.getDirectoryHandle(IMPORT_DIR);
        fh = await dir.getFileHandle(`${key}.json`);
      } catch (e) {
        if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return {};
        throw e;
      }
      return parseLog(await (await fh.getFile()).text(), `${key}.json`);
    },

    /** Tutti i registri → { 'AAAA-MM': { rif: record } } (per backup e cambio di cartella). */
    async readAllImportLogs() {
      if (this.mode !== 'folder') return this.browserLogs();
      const out = {};
      let dir;
      try { dir = await this.dir.getDirectoryHandle(IMPORT_DIR); } catch (e) {
        if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return out;
        throw e;
      }
      for await (const [name, handle] of dir.entries()) {
        const m = IMPORT_RE.exec(name);
        if (m && handle.kind === 'file') out[m[1]] = parseLog(await (await handle.getFile()).text(), name);
      }
      return out;
    },

    /** Nel browser: sostituisce tutti i registri (passaggio dalla cartella al browser). */
    replaceBrowserLogs(all) {
      localStorage.setItem(LS_IMPORT, JSON.stringify(all));
    },

    /** Scrive il registro di un mese; se è vuoto il file viene eliminato. */
    async writeImportLog(key, log) {
      const empty = !Object.keys(log).length;
      if (this.mode !== 'folder') {
        const all = this.browserLogs();
        if (empty) delete all[key]; else all[key] = log;
        localStorage.setItem(LS_IMPORT, JSON.stringify(all));
        return;
      }
      if (empty) {
        try { await (await this.dir.getDirectoryHandle(IMPORT_DIR)).removeEntry(`${key}.json`); } catch (e) {
          if (!e || (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError')) throw e;
        }
        return;
      }
      await writeTo(await this.dir.getDirectoryHandle(IMPORT_DIR, { create: true }), `${key}.json`, logToJson(log));
    },
  };

  global.Store = Store;
})(window);
