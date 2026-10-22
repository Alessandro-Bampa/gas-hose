/*
 * store.js — dove vivono i dati.
 *  - "folder": una cartella sul disco scelta dall'utente (File System Access API,
 *    Chrome/Edge). Un file Hose_AAAA.xlsx per anno + impostazioni.json.
 *    (I nomi interni "salvadanaio" qui sotto restano: cambiarli farebbe perdere la
 *    cartella già collegata e i dati salvati nel browser.)
 *    Il riferimento alla cartella viene ricordato in IndexedDB.
 *  - "browser": tutto in localStorage (per i browser senza accesso alle cartelle).
 */
(function (global) {
  'use strict';

  const LS_MODE = 'salvadanaio.mode';
  const LS_DATA = 'salvadanaio.data';
  const SETTINGS_FILE = 'impostazioni.json';

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
      const fh = await this.dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(data);
        await w.close();
      } catch (e) {
        try { await w.abort(); } catch { /* già chiuso */ }
        throw e;
      }
    },

    loadBrowser() {
      try { return JSON.parse(lsGet(LS_DATA) || 'null'); } catch { return null; }
    },

    saveBrowser(obj) {
      localStorage.setItem(LS_DATA, JSON.stringify(obj));
    },
  };

  global.Store = Store;
})(window);
