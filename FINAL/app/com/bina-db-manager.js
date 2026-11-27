/*
 * BINA DB Manager 4.2  |  BINA WebService
 * ------------------------------------------------------------------
 * کامپوننت دریافت و مدیریت اطلاعات با کامنت‌های فارسی
 * ترتیب قطعی: اول تکمیل همه tk_*، سپس ثبت Schema و دانلود coding/sanad.
 * نسخه IndexedDB داینامیک است و هیچ بانک قدیمی با تغییر حروف پاک نمی‌شود.
 *
 * دو متد اصلی:
 *   1) discoverTables({ signal, concurrency })
 *   2) fetchTable({ table, batchSize, signal })
 * ------------------------------------------------------------------
 */
(function (root) {
  "use strict";

  const RETRY_MAX = 2;
  const RETRY_DELAYS = [300, 800];
  const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        const onAbort = () => { clearTimeout(t); reject(new DOMException("عملیات متوقف شد.", "AbortError")); };
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  async function readJSON(response, label) {
    if (!response.ok) {
      const err = new Error(`${label}: HTTP ${response.status}`);
      err.retryable = RETRYABLE_STATUS.has(response.status);
      throw err;
    }
    const data = await response.json();
    if (data && data.ok === false) {
      const err = new Error(`${label}: ${data.error || data.message || "خطای وب‌سرویس"}`);
      err.retryable = false;
      throw err;
    }
    return data;
  }

  async function fetchWithRetry(url, { signal, label, headers } = {}) {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetch(url, {
          cache: "no-store", signal,
          headers: headers || { Accept: "application/json" },
        });
        return await readJSON(response, label);
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        if (err && err.retryable === false) throw err;
        if (attempt >= RETRY_MAX) throw err;
        const delay = RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
        attempt++;
        await sleep(delay, signal);
      }
    }
  }

  class webservice {
    constructor(options = {}) {
      if (!options.endpoint || typeof options.endpoint !== "string") {
        throw new Error("endpoint الزامی است (آدرس پایه وب‌سرویس).");
      }
      this.endpoint = options.endpoint;
      this.onProgress = typeof options.onProgress === "function" ? options.onProgress : () => { };
      this._idIndexCache = new Map();
    }

    _buildURL(params) {
      const url = new URL(this.endpoint, document.baseURI);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      return url.href;
    }

    async _fetchStats(table, signal) {
      const url = this._buildURL({ mode: "stats", table });
      const data = await fetchWithRetry(url, { signal, label: `stats ${table}` });

      let idIndex = -1;
      if (Number.isInteger(data.idIndex) && data.idIndex >= 0) {
        idIndex = data.idIndex;
      } else if (typeof data.idColumn === "string" && Array.isArray(data.columns)) {
        const wanted = data.idColumn.toLowerCase();
        idIndex = data.columns.findIndex((c) => String(c.name).toLowerCase() === wanted);
      }
      if (idIndex < 0 && Array.isArray(data.columns)) {
        idIndex = data.columns.findIndex((c) => String(c.name).toLowerCase() === "id");
      }
      if (idIndex < 0) throw new Error(`stats ${table}: ستون Id پیدا نشد.`);

      this._idIndexCache.set(table, idIndex);
      return {
        count: Number(data.count) || 0,
        columns: Array.isArray(data.columns) ? data.columns.map((c) => ({
          name: String(c.name), type: String(c.type || ""),
        })) : [],
        idIndex,
      };
    }

    /* نام عمومی برای استفاده از بیرون کلاس (صفحهٔ tab-95-1) */
    async fetchStats(table, signal) {
      return this._fetchStats(table, signal);
    }

    async listTableNames({ signal } = {}) {
      const rows = await fetchWithRetry(this._buildURL({ mode: "tables" }), { signal, label: "tables" });
      if (!Array.isArray(rows)) throw new Error("mode=tables باید آرایه باشد.");
      return rows.filter(x => x && typeof x.table === "string" && x.table.trim())
        .map(x => ({ table: x.table.trim(), count: x.count == null ? null : Number(x.count) }));
    }

    async discoverTables({ signal, concurrency = 6 } = {}) {
      const limit = Math.max(1, Math.floor(Number(concurrency) || 6));
      const listData = await this.listTableNames({ signal });
      const entries = listData.filter((e) => e && typeof e.table === "string" && e.table.trim());

      this.onProgress({ event: "discover-start", total: entries.length });
      const results = new Array(entries.length);
      let next = 0, completed = 0;

      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= entries.length) return;
          const table = entries[i].table.trim();
          try {
            const stats = await this._fetchStats(table, signal);
            results[i] = { key: table, value: { count: stats.count, columns: stats.columns } };
            completed++;
            this.onProgress({ event: "stats-done", table, count: stats.count, columns: stats.columns.length, completed, total: entries.length });
          } catch (err) {
            if (err && err.name === "AbortError") throw err;
            results[i] = { key: table, error: err.message };
            completed++;
            this.onProgress({ event: "stats-failed", table, error: err.message, completed, total: entries.length });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, () => worker()));
      const ok = results.filter((r) => r && !r.error);
      this.onProgress({ event: "discover-done", total: ok.length });
      return ok;
    }

    async *fetchTable({ table, batchSize, afterId = 0, signal } = {}) {
      if (!table || typeof table !== "string") throw new Error("نام جدول الزامی است.");
      const size = Math.floor(Number(batchSize));
      if (!Number.isInteger(size) || size <= 0) throw new Error("batchSize باید عدد صحیح مثبت باشد.");

      if (!this._idIndexCache.has(table)) await this._fetchStats(table, signal);
      const idIndex = this._idIndexCache.get(table);
      let lastId = Number(afterId) || 0;

      while (true) {
        const url = this._buildURL({ mode: "data", table, lastId, batchSize: size });
        const data = await fetchWithRetry(url, { signal, label: `data ${table}` });
        if (!Array.isArray(data)) throw new Error(`data ${table}: پاسخ باید آرایه باشد.`);
        if (data.length === 0) { this.onProgress({ event: "table-end", table, lastId }); return; }

        const lastRow = data[data.length - 1];
        const rawId = Array.isArray(lastRow) ? lastRow[idIndex]
          : (lastRow && typeof lastRow === "object"
            ? Object.entries(lastRow).find(([k]) => k.toLowerCase() === "id")?.[1] : lastRow);
        const newLastId = Number(rawId);
        if (!Number.isFinite(newLastId) || newLastId <= 0) throw new Error(`data ${table}: مقدار Id معتبر نیست (index=${idIndex}).`);
        if (newLastId <= lastId) throw new Error(`data ${table}: ترتیب ID صعودی نیست (${newLastId} <= ${lastId}).`);

        this.onProgress({ event: "batch", table, count: data.length, lastId: newLastId });
        yield { lastId: newLastId, rows: data };
        lastId = newLastId;
      }
    }
  }
  root.webservice = webservice;
})(window);


/* ============================================================================
 *  Index_db — لایه ذخیره‌سازی محلی (IndexedDB) برای داده‌های BINA
 * ============================================================================ */
(function (root) {
  "use strict";

  const PUBLIC = "public";
  const PUBLIC_STORES = ["servertables", "catalog", "columns", "tk_dic", "tk_sherkat"];
const DATA_STORES = ["coding", "sanad"];
 
      // const DATA_STORES = [["coding", null], ["sanad", null], ["coding_index", "key"]];
  const MAX_ID = Number.MAX_SAFE_INTEGER;
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();

  function reqResult(req) {
    return new Promise((ok, bad) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error || new Error("IndexedDB request failed"));
    });
  }
  function txResult(tx) {
    return new Promise((ok, bad) => {
      tx.oncomplete = () => ok();
      tx.onabort = () => bad(tx.error || new Error("IndexedDB transaction aborted"));
      tx.onerror = () => { };
    });
  }

  const norm = value => String(value ?? "").trim().toLowerCase();
  function physicalStore(db, wanted) {
    return Array.from(db.objectStoreNames).find(x => norm(x) === norm(wanted)) || wanted;
  }
  function existingDbName(names) {
    return indexedDB.databases ? indexedDB.databases().then(list => {
      const found = list.map(x => x.name);
      return names.find(n => found.includes(n)) || names[names.length - 1];
    }) : Promise.resolve(names[0]);
  }
  /* آیا بانک با این نام وجود دارد؟ (برای جلوگیری از ساخت بانک فقط با خواندن) */
  function dbExists(name) {
    if (typeof indexedDB.databases !== "function") return Promise.resolve(true);
    return indexedDB.databases().then(list => list.some(d => d.name === name));
  }
  function canonicalTable(value) { return norm(value); }

  function ensureStores(db, stores) {
    for (const [storeName, keyPath] of stores) {
      if (!Array.from(db.objectStoreNames).some(x => norm(x) === norm(storeName))) {
        keyPath ? db.createObjectStore(storeName, { keyPath }) : db.createObjectStore(storeName);
      }
    }
  }

  function openDB(name, stores) {
    return new Promise((ok, bad) => {
      const probe = indexedDB.open(name);
      probe.onerror = () => bad(probe.error || new Error(`Cannot open ${name}`));
      probe.onblocked = () => bad(new Error(`بانک ${name} در تب دیگری باز است؛ آن تب را ببندید.`));
      probe.onupgradeneeded = () => { ensureStores(probe.result, stores); };
      probe.onsuccess = () => {
        const db = probe.result;
        const missing = stores.filter(([s]) => !Array.from(db.objectStoreNames).some(x => norm(x) === norm(s)));
        if (!missing.length) { db.onversionchange = () => db.close(); ok(db); return; }
        const nextVer = db.version + 1;
        db.close();
        const up = indexedDB.open(name, nextVer);
        up.onerror = () => bad(up.error || new Error(`Cannot upgrade ${name} to v${nextVer}`));
        up.onblocked = () => bad(new Error(`بانک ${name} در تب دیگری باز است؛ آن تب را ببندید.`));
        up.onupgradeneeded = () => ensureStores(up.result, stores);
        up.onsuccess = () => {
          const d = up.result;
          const still = stores.filter(([s]) => !Array.from(d.objectStoreNames).some(x => norm(x) === norm(s)));
          if (still.length) { d.close(); bad(new Error(`${name}: استورهای ${still.map(x => x[0]).join(", ")} ساخته نشدند.`)); return; }
          d.onversionchange = () => d.close();
          ok(d);
        };
      };
    });
  }

  function codeOf(code) {
    const s = String(code ?? "").trim();
    if (!/^\d+$/.test(s)) throw new Error("کد شرکت باید فقط عدد باشد.");
    return s;
  }
  function numericID(value, table) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_ID || String(value).trim() === "")
      throw new Error(`${table}: ID نامعتبر: ${String(value)}`);
    return n;
  }
  function keyRange(info, after = -1) {
    const prefix = info.family === "sanad" ? [info.year, info.company] : [info.company];
    return IDBKeyRange.bound([...prefix, Math.max(0, after + 1)], [...prefix, MAX_ID]);
  }
  function fullRange(info) { return keyRange(info, -1); }
  function blockKey(info, blockNo) {
    return info.family === "sanad" ? [info.year, info.company, blockNo] : [info.company, blockNo];
  }
  function lastPart(key) { return key[key.length - 1]; }
  function blocksOf(state) { return Array.isArray(state?.blocks) ? state.blocks : []; }

  async function gzipJSON(obj) {
    const stream = new Blob([ENC.encode(JSON.stringify(obj))]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzipJSON(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(DEC.decode(await new Response(stream).arrayBuffer()));
  }
  const yieldUI = () => new Promise(ok => setTimeout(ok, 0));

  function blankState(info, serverCount = 0) {
    return { ...info, lastId: 0, received: 0, finished: false, needsRefresh: false, refreshMode: "append", serverCount, storageMode: "blocks", blocks: [], updatedAt: null, error: null };
  }

  class Index_db {
    constructor(options = {}) {
      if (!options.webservice || typeof options.webservice.fetchTable !== "function")
        throw new Error("webservice الزامی است (نمونه‌ای از کلاس webservice).");
      this.webservice = options.webservice;
      this.blockSize = Math.min(50000, Math.max(500, Math.floor(Number(options.blockSize) || 10000)));
      this.batchSize = Math.min(50000, Math.max(1, Math.floor(Number(options.batchSize) || 15000)));
      this.minYear = Math.floor(Number(options.minYear) || 1350);
      this.maxYear = Math.floor(Number(options.maxYear) || 1420);
      if (this.minYear > this.maxYear) throw new Error("minYear نمی‌تواند از maxYear بزرگ‌تر باشد.");
      this.onProgress = typeof options.onProgress === "function" ? options.onProgress : () => { };
      this._public = null;
      this._company = null;
      this._schemaCache = new Map();
      this._controller = null;
      this._busy = false;
      this._stopRequested = false;
      this._tkReady = false;
      this._tkSummary = { tables: [], tkdic: 0, tkSherkat: 0 };
      this._persistenceInitialized = false;
      this._persistenceState = false;
    }

    get busy() { return this._busy; }
    _emit(event, fields = {}) { this.onProgress({ event, ...fields }); }
    _checkStop() {
      if (this._stopRequested || this._controller?.signal.aborted)
        throw new DOMException("عملیات متوقف شد.", "AbortError");
    }
    stop() { this._stopRequested = true; this._controller?.abort(); }

    async _run(fn) {
      if (this._busy) throw new Error("عملیات دیگری در حال اجرا است.");
      this._busy = true;
      this._stopRequested = false;
      this._controller = new AbortController();
      try { return await fn(); }
      finally { this._controller = null; this._busy = false; this._closeCompany(); }
    }

    /* ─── ماندگاری Storage ─── */
    async requestPersistence() {
      const storage = navigator.storage;
      if (!storage?.persist || !storage?.persisted)
        return { supported: false, persisted: false, reason: "مرورگر از Persistent Storage پشتیبانی نمی‌کند." };
      try {
        let persisted = await storage.persisted();
        if (!persisted) { await storage.persist(); persisted = await storage.persisted(); }
        const usage = storage.estimate ? await storage.estimate() : {};
        return { supported: true, persisted: !!persisted, usageMB: ((usage.usage || 0) / 1048576).toFixed(2), quotaMB: ((usage.quota || 0) / 1048576).toFixed(2) };
      } catch (error) { return { supported: true, persisted: false, error: String(error.message || error) }; }
    }
    async _requestPersistence() {
      if (this._persistenceInitialized) return this._persistenceState;
      const result = await this.requestPersistence();
      this._persistenceInitialized = true;
      this._persistenceState = !!result.persisted;
      return this._persistenceState;
    }
    async getStorageStatus() {
      const status = { supported: !!(navigator.storage && navigator.storage.persist), persisted: false, usage: 0, quota: 0, usageMB: "0", quotaMB: "0", percent: 0 };
      try {
        if (navigator.storage?.persisted) status.persisted = await navigator.storage.persisted();
        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          status.usage = est.usage || 0;
          status.quota = est.quota || 0;
          status.usageMB = (status.usage / 1048576).toFixed(2);
          status.quotaMB = (status.quota / 1048576).toFixed(2);
          status.percent = status.quota ? ((status.usage / status.quota) * 100).toFixed(2) : 0;
        }
      } catch (err) { /* ignore */ }
      return status;
    }

    /* ─── مدیریت اتصال دیتابیس‌ها ─── */
    async _publicDB() {
      if (this._public) return this._public;
      const physical = await existingDbName(["Public", "public"]);
      const db = await openDB(physical, PUBLIC_STORES.map(s => [s, "key"]));
      db.onversionchange = () => { db.close(); if (this._public === db) this._public = null; };
      db.onclose = () => { if (this._public === db) this._public = null; };
      this._public = db;
      return db;
    }
async _companyDB(company) {
      const code = codeOf(company);
      if (this._company?.code === code) {
        try {
          // اگر اتصال به‌خاطر versionchange در تب دیگر بسته شده باشد، دوباره باز شود
          this._company.db.transaction("coding_index", "readonly").abort();
          return this._company.db;
        } catch (_) {
          this._closeCompany();
        }
      }
      this._closeCompany();

      // اضافه کردن coding_index همراه با کلید key به دیتابیس شرکت
      const stores = [...DATA_STORES.map(s => [s, null]), ["coding_index", "key"]];
      const db = await openDB(code, stores);
      db.onversionchange = () => { try { db.close(); } catch (_) {} if (this._company && this._company.db === db) this._company = null; };
      db.onclose = () => { if (this._company && this._company.db === db) this._company = null; };

      this._company = { code, db };
      return db;
    }
    _closeCompany() { this._company?.db.close(); this._company = null; }
    // async close() {
    //   this.stop();
    //   this._closeCompany();
    //   this._public?.close();
    //   this._public = null;
    //   this._schemaCache.clear();
    // }
    async close() {
      // ابتدا عملیات جاری را متوقف کن
      this._stopRequested = true;
      this._controller?.abort();
      // اتصال‌ها را ببند
      this._closeCompany();
      this._public?.close();
      this._public = null;
      this._schemaCache.clear();
      // ✅ حالت را ریست کن تا نمونه برای استفاده مجدد آماده شود
      await new Promise(r => setTimeout(r, 50)); // کمی صبر برای بسته شدن کامل اتصال‌ها
      this._stopRequested = false;
      this._controller = null;
      this._busy = false;
      this._tkReady = false;
    }
    /* ─── initialize ─── */
    async initialize() {
      const persisted = await this._requestPersistence();
      this._emit("storage-persist", { persisted });
      await this._publicDB();
      return { public: PUBLIC, publicStores: [...PUBLIC_STORES], companyStores: [...DATA_STORES, "coding_index"], version: (await this._publicDB()).version, persisted };
    }

    /* ─── ابزار پایه Public ─── */
    async _get(store, key) {
      const db = await this._publicDB();
      const real = physicalStore(db, store);
      let found = await reqResult(db.transaction(real, "readonly").objectStore(real).get(key));
      if (found !== undefined) return found;
      if (["catalog", "servertables", "columns"].includes(norm(store))) {
        const all = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
        return all.find(row => norm(row.key) === norm(key));
      }
      return found;
    }
    async _put(store, item) {
      const db = await this._publicDB();
      const real = physicalStore(db, store);
      const tx = db.transaction(real, "readwrite");
      const done = txResult(tx);
      const value = ["catalog", "servertables", "columns"].includes(norm(store))
        ? { ...item, key: norm(item.key), ...(item.table ? { table: canonicalTable(item.table) } : {}) }
        : item;
      tx.objectStore(real).put(value);
      await done;
    }

    /* ─── تشخیص نوع جدول ───
     * coding_<code>        → بلوک‌های gzip در بانک همان شرکت
     * sanad_<year>_<code>  → بلوک‌های gzip در بانک همان شرکت
     * coding_index         → یک جدول مشترک در سرور؛ در کلاینت بین استور coding_index شرکت‌ها تفکیک می‌شود
     * tk_*                 → جدول پایه، ردیفی در بانک public
     * بقیه (مثل coding_index1) → جدول پایه عمومی، ردیفی در بانک public
     */
    _tableInfo(table) {
      const original = String(table || "").trim();
      const name = canonicalTable(original);
      if (name === "coding_index") return { table: name, sourceTable: original, company: null, family: "coding_index", year: null };
      let m = /^coding_(\d+)$/i.exec(name);
      if (m) return { table: name, sourceTable: original, company: m[1], family: "coding", year: null };
      m = /^sanad_(\d{4})_(\d+)$/i.exec(name);
      if (m && Number(m[1]) >= this.minYear && Number(m[1]) <= this.maxYear)
        return { table: name, sourceTable: original, company: m[2], family: "sanad", year: Number(m[1]) };
      if (/^tk_/i.test(name)) return { table: name, sourceTable: original, company: null, family: "tk", year: null };
      return { table: name, sourceTable: original, company: null, family: "base", year: null };
    }

    /* ─── ServerTables ─── */
    async getServerTables() {
      const db = await this._publicDB();
      const real = physicalStore(db, "servertables");
      const records = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      const merged = new Map();
      for (const x of records) {
        const canonical = canonicalTable(x.table || x.key);
        const prev = merged.get(canonical);
        const row = { ...(x.info || {}), table: canonical, sourceTable: x.sourceTable || x.info?.sourceTable || x.table || x.key, count: x.count ?? null };
        if (!prev || String(x.key) === canonical) merged.set(canonical, row);
      }
      return [...merged.values()];
    }
    async _saveServerTables(rows) {
      if (!Array.isArray(rows)) throw new Error("mode=tables باید آرایه باشد.");
      const entries = [], seen = new Set();
      for (const row of rows) {
        if (!row || typeof row.table !== "string" || !row.table.trim()) continue;
        const canonical = canonicalTable(row.table);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        entries.push({ key: canonical, table: canonical, sourceTable: row.sourceTable || row.table, count: row.count == null ? null : Number(row.count), info: this._tableInfo(canonical), fetchedAt: new Date().toISOString() });
      }
      const db = await this._publicDB();
      const real = physicalStore(db, "servertables");
      const tx = db.transaction(real, "readwrite");
      const done = txResult(tx);
      const store = tx.objectStore(real);
      store.clear();
      for (const e of entries) store.put(e);
      await done;
      return entries;
    }

    /* ─── Columns (Schema) ─── */
    async getColumns(family) { return this._get("columns", norm(family)); }
    async _saveSchemaFromStats(stats) {
      const info = this._tableInfo(stats.table);
      if (!info || (info.family !== "coding" && info.family !== "sanad")) return null;
      const columns = stats.columns.map(c => ({ name: norm(c.name), type: String(c.type || "").toLowerCase() }));
      let idIndex = Number.isInteger(stats.idIndex) ? stats.idIndex : columns.findIndex(c => c.name.toLowerCase() === String(stats.idColumn || "id").toLowerCase());
      if (idIndex < 0) idIndex = columns.findIndex(c => c.name.toLowerCase() === "id");
      if (idIndex < 0) throw new Error(`ستون Id در Schema ${stats.table} پیدا نشد.`);
      const schema = { key: norm(info.family), columns, idIndex, idColumn: norm(stats.idColumn || columns[idIndex].name), sourceTable: stats.table, fetchedAt: new Date().toISOString() };
      await this._put("Columns", schema);
      this._schemaCache.set(norm(info.family), schema);
      return schema;
    }
    async _schema(info) {
      if (this._schemaCache.has(norm(info.family))) return this._schemaCache.get(norm(info.family));
      let schema = await this.getColumns(info.family);
      if (!schema) throw new Error(`Schema خانواده ${info.family} موجود نیست. ابتدا bootstrap را اجرا کنید.`);
      this._schemaCache.set(norm(info.family), schema);
      return schema;
    }

    /* ─── Catalog ─── */
    async getCatalog({ companyCode = null } = {}) {
      const db = await this._publicDB();
      const real = physicalStore(db, "catalog");
      const all = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      const merged = new Map();
      for (const row of all) {
        const key = canonicalTable(row.table || row.key);
        const prev = merged.get(key);
        const candidate = { ...row, key, table: key, family: norm(row.family) };
        if (!prev || Number(candidate.received || 0) > Number(prev.received || 0) ||
          (candidate.finished && !prev.finished && candidate.received === prev.received)) merged.set(key, candidate);
      }
      const rows = [...merged.values()];
      return companyCode == null ? rows : rows.filter(x => x.company === codeOf(companyCode));
    }

    /* ─── بازیابی چک‌پوینت (blocks mode) ─── */
    async _actualBlockNos(db, info) {
      const storeName = physicalStore(db, info.family);
      const out = [];
      await new Promise((ok, bad) => {
        const rq = db.transaction(storeName, "readonly").objectStore(storeName).openKeyCursor(fullRange(info));
        rq.onerror = () => bad(rq.error);
        rq.onsuccess = () => { const c = rq.result; if (!c) { ok(); return; } out.push(Number(lastPart(c.key))); c.continue(); };
      });
      return out;
    }
    async _realTipBlocks(info, state, db) {
      const storeName = physicalStore(db, info.family);
      const metas = blocksOf(state).map(m => ({ n: Number(m.n), firstId: Number(m.firstId || 0), lastId: Number(m.lastId || 0), count: Number(m.count || 0), bytes: Number(m.bytes || 0) }));
      const cur = await reqResult(db.transaction(storeName, "readonly").objectStore(storeName).openKeyCursor(fullRange(info), "prev"));
      const lastNo = cur ? Number(lastPart(cur.key)) : null;
      if (lastNo !== null && metas.length && metas[metas.length - 1].n === lastNo && Number(state?.lastId ?? 0) === metas[metas.length - 1].lastId) return state;
      if (lastNo === null && !metas.length && Number(state?.lastId ?? 0) === 0) return state;
      const known = new Map(metas.map(m => [m.n, m]));
      const actual = await this._actualBlockNos(db, info);
      const merged = [];
      for (const n of actual) {
        let m = known.get(Number(n));
        if (!m) {
          const packed = await reqResult(db.transaction(storeName, "readonly").objectStore(storeName).get(blockKey(info, n)));
          if (!packed) continue;
          const un = await gunzipJSON(packed);
          m = { n: Number(n), firstId: Number(un.ids[0]), lastId: Number(un.ids[un.ids.length - 1]), count: un.ids.length, bytes: packed.byteLength || 0 };
        }
        merged.push(m);
      }
      merged.sort((a, b) => a.n - b.n);
      const received = merged.reduce((s, m) => s + m.count, 0);
      const lastId = merged.length ? merged[merged.length - 1].lastId : 0;
      const next = { ...(state || blankState(info)), ...info, blocks: merged, lastId, received, finished: false, needsRefresh: state?.needsRefresh || false, storageMode: "blocks", updatedAt: new Date().toISOString() };
      await this._put("Catalog", { ...next, key: info.table });
      this._emit("checkpoint-recovered", { table: info.table, received, lastId });
      return next;
    }
    async _clearTable(db, info) {
      const storeName = physicalStore(db, info.family);
      const tx = db.transaction([storeName], "readwrite");
      const done = txResult(tx);
      tx.objectStore(storeName).delete(fullRange(info));
      await done;
    }

    /* ─── ذخیره بلوکی (gzip) ─── */
    async _extractBatch(info, schema, rows, startId) {
      const firstRow = rows[0];
      const isArray = Array.isArray(firstRow);
      const keys = isArray ? null : (() => {
        const names = new Map(Object.keys(firstRow).map(k => [k.toLowerCase(), k]));
        const ks = schema.columns.map(f => names.get(f.name.toLowerCase()));
        if (ks.some(k => k === undefined)) throw new Error(`ستون‌ها با Schema ${info.family} تطابق ندارند.`);
        return ks;
      })();
      const val = (row, i) => isArray ? row[i] : row[keys[i]];
      const ids = [], vals = [];
      let lastId = startId;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const id = numericID(val(row, schema.idIndex), info.table);
        if (id <= lastId) throw new Error(`${info.table}: ID نامرتب (${id} <= ${lastId}).`);
        const values = new Array(schema.columns.length - 1);
        for (let c = 0, k = 0; c < schema.columns.length; c++) if (c !== schema.idIndex) values[k++] = val(row, c);
        ids.push(id); vals.push(values); lastId = id;
      }
      return { ids, vals };
    }

    /* ─── دریافت و ذخیره یک جدول ─── */
    async _syncOne(info) {
      if (!info || (info.family !== "coding" && info.family !== "sanad"))
        throw new Error(`جدول ${info?.table || "?"} از مسیر بلوکی همگام نمی‌شود.`);
      await this._ensureBaseData();
      this._checkStop();
      const db = await this._companyDB(info.company);
      const schema = await this._schema(info);
      let state = await this._get("Catalog", info.table);
      if (state && state.storageMode !== "blocks")
        throw new Error(`${info.table}: فرمت قبلی ${state.storageMode} با GZIP بلوکی سازگار نیست.`);
      if (state && state.refreshMode === "replace") {
        this._emit("table-reset", { table: info.table, reason: "replace" });
        await this._clearTable(db, info);
        state = { ...blankState(info, state.serverCount || 0), key: info.table };
        await this._put("Catalog", state);
      }
      if (!state) {
        state = { ...blankState(info, info.serverCount || 0), key: info.table };
        await this._put("Catalog", state);
      } else {
        state = await this._realTipBlocks(info, state, db);
      }
      if (state.finished && !state.needsRefresh) {
        this._emit("table-skip", { table: info.table, received: state.received });
        return state;
      }
      this._emit("table-start", { table: info.table, company: info.company, year: info.year, received: state.received });
      return this._pullBlocks(db, info, schema, state);
    }

    async _pullBlocks(db, info, schema, state) {
      const bs = this.blockSize;
      const storeName = physicalStore(db, info.family);
      let tail = { n: 0, ids: [], vals: [] };
      const last0 = blocksOf(state)[blocksOf(state).length - 1] || null;
      if (last0) {
        if (Number(last0.count) < bs) {
          const packed = await reqResult(db.transaction(storeName, "readonly").objectStore(storeName).get(blockKey(info, Number(last0.n))));
          if (!packed) throw new Error(`${info.table}: بلوک ناقص بدون داده (${last0.n}).`);
          const un = await gunzipJSON(packed);
          tail = { n: Number(last0.n), ids: un.ids, vals: un.rows };
        } else {
          tail = { n: Number(last0.n) + 1, ids: [], vals: [] };
        }
      }
      const iterator = this.webservice.fetchTable({ table: info.sourceTable || info.table, batchSize: this.batchSize, afterId: state.lastId, signal: this._controller?.signal });
      for await (const { rows } of iterator) {
        this._checkStop();
        const extracted = await this._extractBatch(info, schema, rows, state.lastId);
        for (let i = 0; i < extracted.ids.length; i++) { tail.ids.push(extracted.ids[i]); tail.vals.push(extracted.vals[i]); }
        const sealed = [];
        while (tail.ids.length >= bs) { sealed.push({ n: tail.n, ids: tail.ids.splice(0, bs), vals: tail.vals.splice(0, bs) }); tail.n++; }
        const jobs = sealed.map(b => ({ n: b.n, ids: b.ids, vals: b.vals, payload: gzipJSON({ ids: b.ids, rows: b.vals }) }));
        if (tail.ids.length) jobs.push({ n: tail.n, ids: tail.ids, vals: tail.vals, payload: gzipJSON({ ids: tail.ids, rows: tail.vals }) });
        const packedList = await Promise.all(jobs.map(j => j.payload));
        const tx = db.transaction([storeName], "readwrite");
        const done = txResult(tx);
        const ds = tx.objectStore(storeName);
        for (let j = 0; j < jobs.length; j++) ds.put(packedList[j], blockKey(info, jobs[j].n));
        await done;
        const byN = new Map(blocksOf(state).map(b => [Number(b.n), b]));
        for (let j = 0; j < jobs.length; j++) byN.set(Number(jobs[j].n), { n: Number(jobs[j].n), firstId: jobs[j].ids[0], lastId: jobs[j].ids[jobs[j].ids.length - 1], count: jobs[j].ids.length, bytes: packedList[j].byteLength || 0 });
        state = { ...state, blocks: [...byN.values()].sort((a, b) => a.n - b.n), lastId: extracted.ids[extracted.ids.length - 1], received: state.received + extracted.ids.length, finished: false, storageMode: "blocks", updatedAt: new Date().toISOString() };
        this._emit("chunk", { table: info.table, company: info.company, lastId: state.lastId, received: state.received });
        await this._put("Catalog", { ...state, key: info.table });
        await yieldUI();
      }
      state = { ...state, finished: true, needsRefresh: false, countMismatch: Number.isFinite(state.serverCount) && state.received !== state.serverCount, updatedAt: new Date().toISOString() };
      await this._put("Catalog", { ...state, key: info.table });
      this._emit("table-done", { table: info.table, company: info.company, received: state.received });
      return state;
    }

    /* ─── جداول پایه TK ─── */
    _tkStoreName(table) {
      const id = canonicalTable(table);
      if (id === "tk_dic_fieldname" || id === "tk_dic") return "tk_dic";
      if (id === "tk_esmsherkatholding" || id === "tk_sherkat") return "tk_sherkat";
      return id;
    }
    async _ensureTKStores(tables) {
      const db = await this._publicDB();
      const wanted = [...new Set(tables.map(t => this._tkStoreName(t.table)))];
      const missing = wanted.filter(name => !Array.from(db.objectStoreNames).some(s => norm(s) === name));
      if (!missing.length) return db;
      const name = db.name;
      db.close();
      this._public = null;
      const newDb = await openDB(name, [...PUBLIC_STORES.map(s => [s, "key"]), ...wanted.map(s => [s, "key"])]);
      newDb.onversionchange = () => { newDb.close(); if (this._public === newDb) this._public = null; };
      this._public = newDb;
      return newDb;
    }
    async _fetchTK(storeName, tableName, expectedCount = null) {
      this._checkStop();
      const stats = await this.webservice.fetchStats(tableName, this._controller?.signal);
      const declared = Number.isFinite(Number(expectedCount)) && expectedCount != null ? Number(expectedCount) : Number(stats.count);
      const db = await this._publicDB();
      const real = physicalStore(db, storeName);
      const tableKey = canonicalTable(tableName);
      let existingCount = await reqResult(db.transaction(real, "readonly").objectStore(real).count());
      if (Number.isFinite(declared) && existingCount === declared) {
        await this._put("catalog", { key: tableKey, table: tableKey, family: this._tableInfo(tableName)?.family || "tk", storageMode: "rows", received: existingCount, serverCount: declared, finished: true, sourceTable: tableName, updatedAt: new Date().toISOString() });
        this._emit("tk-skip", { store: storeName, table: tableKey, count: existingCount });
        return existingCount;
      }
      // لوکال از سرور بیشتر است (ردیف‌هایی در سرور حذف شده‌اند) → بازسازی کامل جدول پایه
      if (Number.isFinite(declared) && existingCount > declared) {
        const resetTx = db.transaction(real, "readwrite");
        const resetDone = txResult(resetTx);
        resetTx.objectStore(real).clear();
        await resetDone;
        existingCount = 0;
        this._emit("tk-reset", { store: storeName, table: tableKey, serverCount: declared });
      }
      const columns = stats.columns.map(c => String(c.name));
      const index = stats.idIndex;
      if (!(index >= 0 && index < columns.length)) throw new Error(`${tableKey}: ستون id معتبر نیست.`);
      let received = 0;
      const iterator = this.webservice.fetchTable({ table: tableName, batchSize: 2000, afterId: 0, signal: this._controller?.signal });
      for await (const pack of iterator) {
        this._checkStop();
        const batch = pack.rows;
        const tx = db.transaction(real, "readwrite"), done = txResult(tx), store = tx.objectStore(real);
        const keyPath = store.keyPath;
        for (const row of batch) {
          const keyMap = Array.isArray(row) ? null : new Map(Object.keys(row).map(k => [norm(k), k]));
          const valueAt = i => Array.isArray(row) ? row[i] : row[keyMap.get(norm(columns[i]))];
          const id = numericID(valueAt(index), tableKey);
          const value = { key: id };
          for (let i = 0; i < columns.length; i++) value[norm(columns[i])] = valueAt(i);
          const oldKeyFields = Array.isArray(keyPath) ? keyPath : (keyPath && keyPath !== "key" ? [keyPath] : []);
          for (const required of oldKeyFields) {
            const matching = Object.keys(value).find(k => norm(k) === norm(required));
            if (matching === undefined) {
              if (norm(required) === "key") value[required] = id;
              else throw new Error(`کلید قدیمی ${required} در جدول ${tableKey} وجود ندارد.`);
            } else value[required] = value[matching];
          }
          if (keyPath === null) store.put(value, id); else store.put(value);
        }
        await done;
        received += batch.length;
        this._emit("tk-chunk", { table: tableKey, store: storeName, received });
        await yieldUI();
      }
      const actual = await reqResult(db.transaction(real, "readonly").objectStore(real).count());
      if (Number.isFinite(declared) && actual !== declared)
        throw new Error(`جدول پایه ${tableKey} ناقص است: سرور=${declared}، لوکال=${actual}.`);
      await this._put("catalog", { key: tableKey, table: tableKey, family: this._tableInfo(tableName)?.family || "tk", storageMode: "rows", received: actual, serverCount: declared, finished: true, sourceTable: tableName, updatedAt: new Date().toISOString() });
      this._emit("tk-loaded", { store: storeName, table: tableKey, count: actual });
      return actual;
    }
    async _ensureBaseData({ sourceList = null, force = false } = {}) {
      if (this._tkReady && !force) return this._tkSummary;
      let list = sourceList;
      if (!list) {
        const cached = await this.getServerTables();
        const baseRows = cached.filter(x => {
          const f = this._tableInfo(x.table)?.family;
          return f === "tk" || f === "base";
        });
        list = baseRows.length ? baseRows.map(x => ({ table: x.sourceTable || x.table, count: x.count })) : await this.webservice.listTableNames({ signal: this._controller?.signal });
      }
      // همهٔ جداول پایه = هر جدولی که coding_/sanad_/coding_index نیست
      const baseTables = new Map();
      for (const row of list) {
        const name = String(row.table || "").trim();
        const info = this._tableInfo(name);
        if (!info || (info.family !== "tk" && info.family !== "base")) continue;
        baseTables.set(canonicalTable(name), { table: name, count: row.count });
      }
      for (const name of ["TK_Dic_FieldName", "tk_EsmSherkatHolding"]) {
        if (!baseTables.has(canonicalTable(name))) baseTables.set(canonicalTable(name), { table: name, count: null });
      }
      const ordered = [...baseTables.values()].sort((a, b) => a.table.localeCompare(b.table, "en"));
      await this._ensureTKStores(ordered);
      this._emit("tk-start", { total: ordered.length });
      const summary = { tables: [], tkdic: 0, tkSherkat: 0, base: 0 };
      for (const row of ordered) {
        const storeName = this._tkStoreName(row.table);
        const count = await this._fetchTK(storeName, row.table, row.count);
        const name = canonicalTable(row.table);
        summary.tables.push({ table: name, store: storeName, count });
        if (storeName === "tk_dic") summary.tkdic = count;
        if (storeName === "tk_sherkat") summary.tkSherkat = count;
        if (this._tableInfo(row.table)?.family === "base") summary.base++;
      }
      this._tkReady = true;
      this._tkSummary = summary;
      this._emit("tk-done", { total: ordered.length });
      return summary;
    }

    /* ─── Schema مشترک (ادغام شده) ─── */
    async _ensureSchemas(discovered = []) {
      const tables = discovered.length ? discovered : await this.getServerTables();
      for (const family of ["coding", "sanad"]) {
        if (await this.getColumns(family)) continue;
        const row = discovered.length
          ? discovered.find(x => this._tableInfo(x.key)?.family === family)
          : tables.find(x => this._tableInfo(x.table)?.family === family);
        if (!row) throw new Error(`هیچ جدول ${family} برای تشخیص Schema وجود ندارد.`);
        const src = discovered.length ? row.key : (row.sourceTable || row.table);
        const stats = await this.webservice._fetchStats(src, this._controller?.signal);
        await this._saveSchemaFromStats({ ...stats, table: discovered.length ? row.key : row.table });
      }
    }

    /* ─── کشف جداول سرور و ثبت در ServerTables ─── */
    async _discoverAndSave() {
      const result = await this.webservice.discoverTables({ signal: this._controller?.signal });
      await this._saveServerTables(result.map(d => ({ table: d.key, count: d.value.count })));
      await this._ensureSchemas(result);
      return result;
    }
    /* اگر فهرست ServerTables خالی است، یک‌بار از سرور ساخته می‌شود */
    async _ensureServerTables() {
      const tables = await this.getServerTables();
      if (tables.length) return tables;
      await this._discoverAndSave();
      return this.getServerTables();
    }

    /* ─── bootstrap ─── */
    async bootstrap() {
      return this._run(async () => {
        await this.initialize();
        const localTables = await this.getServerTables();
        const isFirstRun = localTables.length === 0;
        const names = isFirstRun ? await this.webservice.listTableNames({ signal: this._controller?.signal }) : null;
        const base = await this._ensureBaseData({ sourceList: names });
        let discovered = 0;
        if (isFirstRun) {
          this._emit("bootstrap-online", {});
          const result = await this._discoverAndSave();
          discovered = result.length;
        } else {
          await this._ensureSchemas();
        }
        this._emit("bootstrap-done", { firstRun: isFirstRun, discovered, tkdic: base.tkdic, tkSherkat: base.tkSherkat });
        return { firstRun: isFirstRun, discovered, tkdic: base.tkdic, tkSherkat: base.tkSherkat, tkTables: base.tables };
      });
    }

    /* ─── refreshServerTables ─── */
    async refreshServerTables() {
      return this._run(async () => {
        await this.initialize();
        this._emit("refresh-start", {});
        const names = await this.webservice.listTableNames({ signal: this._controller?.signal });
        this._tkReady = false;
        const base = await this._ensureBaseData({ sourceList: names, force: true });
        const result = await this._discoverAndSave();
        this._emit("refresh-done", { total: result.length, tkTables: base.tables.length });
        return { total: result.length, tkTables: base.tables.length };
      });
    }

    /* ─── getTableList ─── */
/* ─── getTableList (با تشخیص حذف دستی دیتابیس یا استور شرکت) ─── */
    /* ─── getTableList ─── */
    async getTableList({ companyCode = null, family = null, status = null } = {}) {
      await this.initialize();
      const tables = await this.getServerTables();
      const catalog = await this.getCatalog();
      const states = new Map(catalog.map(s => [s.table.toLowerCase(), s]));
      const codeFilter = companyCode ? codeOf(companyCode) : null;

      // ✅ لیست دیتابیس‌های موجود را بگیر
      const existingDbs = new Set();
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const d of dbs) existingDbs.add(d.name);
      }

      const rows = [];
      for (const entry of tables) {
        const info = this._tableInfo(entry.table);
        if (!info || info.family === "tk") continue;
        if (codeFilter && info.company !== codeFilter) continue;
        if (family && info.family !== norm(family)) continue;
        const local = states.get(entry.table.toLowerCase());
        const localCount = local?.received || 0;
        const serverCount = Number(entry.count) || 0;

        // ✅ چک کن: آیا دیتابیس شرکت واقعاً وجود دارد؟
        const dbExists = existingDbs.has(info.company);

        let st;
        if (!local) st = "missing";
        else if (!dbExists) st = "missing";        // ✅ دیتابیس پاک شده
        else if (!local.finished) st = "incomplete";
        else if (localCount !== serverCount) st = "diff";
        else st = "ok";
        if (status && st !== status) continue;
        rows.push({ table: entry.table, company: info.company, family: info.family, year: info.year, serverCount, localCount, finished: !!local?.finished, status: st });
      }
      rows.sort((a, b) => Number(a.company) - Number(b.company) || (a.family === "coding" ? -1 : 0) - (b.family === "coding" ? -1 : 0) || (a.year || 0) - (b.year || 0));
      return rows;
    }

    /* ─── syncTables ─── */
    async syncTables(tableNames) {
      const names = [...new Set((tableNames || []).map(canonicalTable).filter(Boolean))];
      if (!names.length) throw new Error("هیچ جدولی انتخاب نشده است.");
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        const tables = await this._ensureServerTables();
        const map = new Map(tables.map(t => [t.table.toLowerCase(), t]));
        let done = 0;
        for (const name of names) {
          this._checkStop();
          const src = map.get(name.toLowerCase());
          if (!src) { this._emit("table-missing", { table: name }); continue; }
          const info = this._tableInfo(src.table);
          if (!info || info.family === "tk" || info.family === "base") continue;
          info.sourceTable = src.sourceTable || src.table;
          try {
            if (info.family === "coding_index") await this._syncCodingIndex();
            else await this._syncOne({ ...info, serverCount: Number(src.count) || 0 });
            done++;
            this._emit("job-done", { done, total: names.length, table: name });
          } catch (err) {
            if (err.name === "AbortError") throw err;
            this._emit("table-error", { table: name, error: err.message, errorName: err.name, errorStack: (err.stack || "").split("\n")[1] || "" });
          }
        }
        return { requested: names.length, completed: done };
      });
    }

    /* ─── start (همگانسازی همه یا یک شرکت) ─── */
    async start({ companyCode = null } = {}) {
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        const tables = await this._ensureServerTables();
        const code = companyCode == null ? null : codeOf(companyCode);
        const jobs = tables
          .map(e => ({ ...this._tableInfo(e.table), sourceTable: e.sourceTable || e.table, serverCount: Number(e.count) || 0 }))
          .filter(e => e.table && (e.family === "coding" || e.family === "sanad") && (code == null || e.company === code));
        const hasCodingIndex = tables.some(e => this._tableInfo(e.table)?.family === "coding_index");
        const total = jobs.length + (hasCodingIndex ? 1 : 0);
        let done = 0;
        // ۱) جدول مشترک coding_index → تفکیک در استور coding_index هر شرکت
        if (hasCodingIndex) {
          this._checkStop();
          await this._syncCodingIndex({ companyCode: code });
          done++;
          this._emit("job-done", { done, total, table: "coding_index" });
        }
        // ۲) جداول بلوکی coding_* و sanad_*
        for (const info of jobs) {
          this._checkStop();
          await this._syncOne(info);
          done++;
          this._emit("job-done", { done, total, table: info.table, company: info.company });
        }
        return { completedTables: done, totalTables: total, companyCode };
      });
    }

    /* ─── syncTable ─── */
    async syncTable(tableName, { replace = false } = {}) {
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        const info = this._tableInfo(tableName);
        if (!info) throw new Error("جدول Coding/Sanad معتبر نیست.");
        if (info.family === "coding_index") return this._syncCodingIndex({ force: !!replace });
        if (info.family !== "coding" && info.family !== "sanad") throw new Error("جدول Coding/Sanad معتبر نیست.");
        const tables = await this._ensureServerTables();
        const src = tables.find(x => x.table.toLowerCase() === info.table.toLowerCase());
        if (!src) throw new Error("جدول در ServerTables نیست.");
        info.sourceTable = src.sourceTable || src.table;
        if (replace) {
          const st = await this._get("Catalog", info.table);
          if (st) await this._put("Catalog", { ...st, key: info.table, refreshMode: "replace" });
        }
        return this._syncOne({ ...info, serverCount: Number(src.count) || 0 });
      });
    }

    /* ─── getRows ─── */
    async getRows({ companyCode, family = "sanad", year = null, afterId = -1, limit = 50 } = {}) {
      const code = codeOf(companyCode);
      family = norm(family);
      if (!DATA_STORES.includes(family)) throw new Error("family باید coding یا sanad باشد.");
   
if (!Number.isInteger(limit) || limit < 1 || limit > 50000) 
    throw new Error("limit باید 1..50000 باشد.");

      if (!Number.isSafeInteger(afterId) || afterId < -1) throw new Error("afterId نامعتبر است.");
      if (family === "sanad" && (!Number.isInteger(Number(year)) || Number(year) < this.minYear || Number(year) > this.maxYear))
        throw new Error(`سال مالی برای Sanad الزامی است (${this.minYear} تا ${this.maxYear}).`);
      const info = { company: code, family, year: family === "coding" ? null : Number(year), table: family === "sanad" ? `sanad_${Number(year)}_${code}` : `coding_${code}` };
      const schema = await this.getColumns(family);
      if (!schema) throw new Error(`Schema ${family} موجود نیست.`);
      const db = await this._companyDB(code);
      const state = await this._get("Catalog", info.table);
      const metas = blocksOf(state);
      if (!metas.length) {
        if (state?.storageMode === "blocks") {
          const recovered = await this._realTipBlocks(info, state, db);
          return this._getRowsBlocks(db, info, schema, afterId, limit, blocksOf(recovered));
        }
        return [];
      }
      return this._getRowsBlocks(db, info, schema, afterId, limit, metas);
    }
    async _getRowsBlocks(db, info, schema, afterId, limit, metas) {
      const storeName = physicalStore(db, info.family);
      const usable = metas.filter(m => Number(m.lastId) > afterId);
      const chosen = [];
      let needed = limit;
      for (let i = 0; i < usable.length; i++) {
        chosen.push(Number(usable[i].n));
        if (i > 0) { needed -= Number(usable[i].count) || 0; if (needed <= 0) break; }
      }
      if (!chosen.length) return [];
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const pending = chosen.map(n => reqResult(store.get(blockKey(info, n))));
      const packedList = await Promise.all(pending);
      const out = [];
      for (let b = 0; b < chosen.length && out.length < limit; b++) {
        if (!packedList[b]) continue;
        const un = await gunzipJSON(packedList[b]);
        for (let i = 0; i < un.ids.length && out.length < limit; i++) {
          if (un.ids[i] > afterId) out.push({ id: un.ids[i], values: un.rows[i] });
        }
      }
      return out.map(({ id, values }) => {
        const obj = {};
        let k = 0;
        schema.columns.forEach((c, i) => { obj[c.name] = i === schema.idIndex ? id : values[k++]; });
        if (info.family === "sanad") obj.__FiscalYear = Number(info.year);
        obj.__CompanyCode = info.company;
        return obj;
      });
    }

    /* ─── خواندن tk_dik و tk_sherkat ─── */
    async getTKdik({ countryCode = null, fieldName = null } = {}) {
      const db = await this._publicDB(), real = physicalStore(db, "tk_dic");
      const all = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      return all.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v])))
        .filter(r => (countryCode == null || Number(r.countrycode) === Number(countryCode)) && (fieldName == null || String(r.fieldname) === String(fieldName)));
    }
    async getTKEsmSherkat({ codeSherkat = null } = {}) {
      const db = await this._publicDB(), real = physicalStore(db, "tk_sherkat");
      const all = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      return all.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v])))
        .filter(r => codeSherkat == null || Number(r.codesherkat) === Number(codeSherkat));
    }

    /* ─── کدهای شرکت و خلاصه ─── */
    async getCompanyCodes() {
      const entries = await this.getServerTables();
      const codes = new Set(entries.map(e => this._tableInfo(e.table)?.company).filter(Boolean));
      // کدهای شرکت‌هایی که فقط در جدول مشترک coding_index وجود دارند
      const ci = await this._get("Catalog", "coding_index");
      for (const c of Object.keys(ci?.companies || {})) codes.add(String(c));
      return [...codes].filter(c => /^\d+$/.test(c)).sort((a, b) => Number(a) - Number(b));
    }
    async getCompanySummary(companyCode) {
      const code = codeOf(companyCode);
      const tables = await this.getServerTables();
      const catalog = await this.getCatalog({ companyCode: code });
      const states = new Map(catalog.map(x => [canonicalTable(x.table), x]));
      const rows = tables
        .map(e => ({ ...this._tableInfo(e.table), serverCount: Number(e.count) || 0 }))
        .filter(e => e.table && e.family !== "tk" && e.family !== "base" && e.company === code)
        .sort((a, b) => (a.family === "coding" ? -1 : 0) - (b.family === "coding" ? -1 : 0) || (a.year || 0) - (b.year || 0))
        .map(e => ({ ...e, state: states.get(canonicalTable(e.table)) || null }));
      const ci = (await this._get("Catalog", "coding_index")) || null;
      rows.unshift({
        table: "coding_index", sourceTable: "coding_index", family: "coding_index", company: code, year: null,
        serverCount: Number(ci?.companies?.[code] ?? 0), state: ci,
      });
      return rows;
    }

    /* ─── compareServer (باگ src اصلاح شد) ─── */
    async compareServer({ apply = true, companyCode = null } = {}) {
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        const previous = await this.getServerTables();
        const oldMap = new Map(previous.map(e => [e.table.toLowerCase(), e]));
        const current = await this.webservice.discoverTables({ signal: this._controller?.signal });
        const newMap = new Map(current.map(d => [d.key.toLowerCase(), d]));
        const catalog = await this.getCatalog();
        const statuses = new Map(catalog.map(s => [s.table.toLowerCase(), s]));
        const changes = [];
        for (const d of current) {
          const name = d.key;
          const info = this._tableInfo(d.key);
          if (!info || info.family === "tk" || info.family === "base") continue;
          info.sourceTable = d.key;
          const old = oldMap.get(name.toLowerCase());
          const local = statuses.get(name.toLowerCase());
          const count = Number(d.value.count) || 0;
          const localCount = local?.received ?? 0;
          let type = null;
          if (!old) type = "new";
          else if (old.count !== count) type = "count-changed";
          else if (!local) type = "not-downloaded";
          else if (localCount !== count) type = "local-difference";
          else if (!local.finished) type = "incomplete";
          if (type && (companyCode == null || info.company === codeOf(companyCode))) {
            changes.push({ table: name, type, oldCount: old?.count ?? null, newCount: count, storedCount: localCount, importable: true });
          }
        }
        for (const old of previous) {
          if (!newMap.has(old.table.toLowerCase())) {
            const info = this._tableInfo(old.table);
            if (info && info.family !== "tk" && info.family !== "base" && info.family !== "coding_index") {
              changes.push({ table: old.table, type: "removed-server", oldCount: old.count, newCount: null, storedCount: statuses.get(old.table.toLowerCase())?.received ?? 0, importable: false });
            }
          }
        }
        await this._saveServerTables(current.map(d => ({ table: d.key, count: d.value.count })));
        let imported = 0;
        if (apply) {
          for (const item of changes) {
            if (!item.importable) continue;
            this._checkStop();
            const info = this._tableInfo(item.table);
            info.sourceTable = current.find(x => norm(x.key) === norm(item.table))?.key || item.table;
            const local = statuses.get(item.table.toLowerCase());
            if (local && Number.isFinite(item.newCount) && local.received > item.newCount) {
              local.needsRefresh = true;
              local.error = "کاهش تعداد سرور؛ بازنویسی فقط با syncTable({replace:true})";
              await this._put("Catalog", { ...local, key: item.table });
              continue;
            }
            if (info.family === "coding_index") await this._syncCodingIndex({ force: true });
            else await this._syncOne({ ...info, serverCount: item.newCount });
            imported++;
            this._emit("compare-progress", { done: imported, total: changes.filter(c => c.importable).length, table: item.table });
          }
        }
        return { changes, imported, serverTables: current.length };
      });
    }

    /* ─── موجودی لوکال ─── */
    async listLocalInventory() {
      if (typeof indexedDB.databases !== "function") throw new Error("مرورگر از indexedDB.databases() پشتیبانی نمی‌کند.");
      const dbs = await indexedDB.databases();
      const out = [];
      for (const info of dbs) {
        const name = info.name;
        if (!name) continue;
        let db;
        try {
          db = await new Promise((ok, bad) => {
            const req = indexedDB.open(name);
            req.onsuccess = () => ok(req.result);
            req.onerror = () => bad(req.error || new Error("open failed"));
          });
        } catch (e) { out.push({ database: name, version: info.version ?? null, error: String(e.message || e), stores: [] }); continue; }
        const stores = [];
        for (const storeName of Array.from(db.objectStoreNames)) {
          let count = null;
          try { count = await reqResult(db.transaction(storeName, "readonly").objectStore(storeName).count()); } catch (_) { count = null; }
          stores.push({ store: storeName, count });
        }
        const version = db.version;
        db.close();
        out.push({ database: name, version, stores });
      }
      out.sort((a, b) => String(a.database).localeCompare(String(b.database), "en"));
      return out;
    }

    /* ─── normalizeMetadata ─── */
    async normalizeMetadata({ dryRun = true } = {}) {
      const db = await this._publicDB();
      const report = { dryRun, scanned: 0, renamed: 0, duplicates: 0, conflicts: [], stores: [] };
      for (const logical of ["servertables", "catalog", "columns"]) {
        const real = physicalStore(db, logical);
        const entries = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
        const groups = new Map();
        for (const row of entries) { const k = norm(row.key); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
        const changes = [];
        for (const [key, rows] of groups) {
          report.scanned += rows.length;
          const comparable = rows.map(r => { const x = { ...r, key }; if (x.table) x.table = norm(x.table); delete x.updatedAt; delete x.fetchedAt; return JSON.stringify(x); });
          if (new Set(comparable).size > 1) { report.conflicts.push({ store: logical, key, keys: rows.map(x => x.key) }); continue; }
          if (rows.length > 1) report.duplicates += rows.length - 1;
          if (rows.length > 1 || rows[0].key !== key) changes.push({ key, rows, chosen: { ...rows[0], key, ...(rows[0].table ? { table: norm(rows[0].table) } : {}) } });
        }
        report.stores.push({ store: logical, changes: changes.length });
        report.renamed += changes.length;
        if (dryRun || !changes.length) continue;
        const tx = db.transaction(real, "readwrite"), done = txResult(tx), store = tx.objectStore(real);
        for (const ch of changes) { for (const row of ch.rows) store.delete(row.key); store.put(ch.chosen); }
        await done;
      }
      return report;
    }

    /* ─── حذف بانک‌ها ─── */
    /* ─── حذف بانک‌ها ─── */
    async deleteLocalDatabases(names) {
      const list = [...new Set((names || []).map(String).filter(Boolean))];

      // بستن مستقیم اتصالات (بدون stop که حالت را خراب می‌کند)
      this._closeCompany();
      if (this._public) {
        try { this._public.close(); } catch (e) {}
        this._public = null;
      }

      // صبر برای بسته شدن کامل اتصالات
      await new Promise(r => setTimeout(r, 300));

      const results = [];
      for (const name of list) {
        try {
          const result = await new Promise((resolve, reject) => {
            let settled = false;

            // تایم‌اوت ۱۰ ثانیه
            const timeoutId = setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve({ ok: false, blocked: true, error: "timeout: تب دیگری باز است" });
              }
            }, 10000);

            const req = indexedDB.deleteDatabase(name);

            req.onsuccess = () => {
              if (!settled) {
                settled = true;
                clearTimeout(timeoutId);
                resolve({ ok: true, blocked: false });
              }
            };

            req.onerror = () => {
              if (!settled) {
                settled = true;
                clearTimeout(timeoutId);
                reject(req.error || new Error("delete failed"));
              }
            };

            // ✅ روی blocked منتظر می‌مانیم — resolve نمی‌کنیم
            req.onblocked = () => {
              console.warn(`حذف ${name} مسدود شده — در انتظار...`);
            };
          });

          results.push({
            database: name,
            ok: result.ok,
            blocked: result.blocked || false,
            error: result.error || null
          });
        } catch (err) {
          results.push({ database: name, ok: false, error: err.message });
        }
      }

      // ریست حالت
      this._stopRequested = false;
      this._controller = null;
      this._busy = false;
      this._tkReady = false;
      this._schemaCache.clear();

      return results;
    }


    async wipeAllLocal() {
      const inv = await this.listLocalInventory();
      return this.deleteLocalDatabases(inv.map(x => x.database));
    }

    /* ────────────────────────────────────────────────────────────
     * همگام‌سازی مستقل جدول اشتراکی coding_index با سرور و تفکیک برای شرکتc
     * ──────────────────────────────────────────────────────────── */
 
     /* ────────────────────────────────────────────────────────────
     * همگان‌سازی coding_index — نسخه اصلاح‌شده
     * - استفاده از stats برای اندیس ستون‌ها (نه valObj)
     * - مقایسه صحیح: دانلود → فیلتر → شمارش → مقایسه
     * - داخل _run برای مدیریت signal و stop
     * ──────────────────────────────────────────────────────────── */
    async _codingIndexRows(company) {
      const code = codeOf(company);
      if (!(await dbExists(code))) return [];
      const db = await this._companyDB(code);
      const real = physicalStore(db, "coding_index");
      if (!Array.from(db.objectStoreNames).some(s => norm(s) === norm(real))) return [];
      const rows = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      return Array.isArray(rows) ? rows : [];
    }
    async getCodingIndex(companyCode) {
      const rows = await this._codingIndexRows(codeOf(companyCode));
      return rows.slice().sort((a, b) => String(a.key).localeCompare(String(b.key), "en"));
    }

    /* ────────────────────────────────────────────────────────────
     * coding_index
     *   در سرور یک جدول مشترک است؛ در کلاینت هر شرکت ردیف‌های خودش را در
     *   استور coding_index بانک همان شرکت دارد (کلید = key).
     *   ردیف‌های pending محلی هرگز با همگام‌سازی پاک نمی‌شوند.
     * ──────────────────────────────────────────────────────────── */
    async _syncCodingIndex({ companyCode = null, force = false } = {}) {
      const tableName = "coding_index";
      const only = companyCode == null ? null : codeOf(companyCode);
      const stats = await this.webservice.fetchStats(tableName, this._controller?.signal);
      const columns = Array.isArray(stats.columns) ? stats.columns : [];
      const declared = Number(stats.count) || 0;
      const findIdx = (...names) => {
        const lower = names.map(norm);
        return columns.findIndex(c => lower.includes(norm(c.name)));
      };
      const companyIdx = findIdx("companycode", "codesherkat");
      const kolIdx = findIdx("kol_code");
      const moienIdx = findIdx("moien_code");
      const tafsilIdx = findIdx("tafsil_code");
      const groupIdx = findIdx("groupid", "group_id");
      const karbordIdx = findIdx("karbord");
      // ستون کلید در سرور جدید [CodeHesab] است؛ «key» فقط برای سازگاری با جدول قدیمی
      const keyIdx = findIdx("codehesab", "key");
      // ستون‌های چهارگانه نگاشت در ساختار جدید coding_index
      const csStIdx = findIdx("code_soratmali_st");
      const csShIdx = findIdx("code_soratmali_sh");
      const gzShIdx = findIdx("code_gozareshat_sh");
      const gzStIdx = findIdx("code_gozareshat_st");
      if (companyIdx < 0) throw new Error("ستون CompanyCode در جدول coding_index پیدا نشد.");
      // ردیف ممکن است آرایه (حالت پیش‌فرض FastDataHandler) یا آبجکت باشد
      const valueAt = (row, i) => {
        if (i < 0 || row == null) return undefined;
        if (Array.isArray(row)) return row[i];
        if (typeof row !== "object") return undefined;
        const wanted = norm(columns[i]?.name || "");
        const k = Object.keys(row).find(kk => norm(kk) === wanted);
        return k === undefined ? undefined : row[k];
      };

      const prev = await this._get("Catalog", tableName);
      const prevCompanies = prev && prev.companies && typeof prev.companies === "object" ? prev.companies : {};

      // بررسی بدون دانلود: تعداد سرور و تعداد synced هر شرکت
      if (!force && prev && prev.finished && Number(prev.received) === declared) {
        const codes = new Set(Object.keys(prevCompanies));
        if (only) codes.add(only);
        let same = true;
        for (const c of codes) {
          const synced = (await this._codingIndexRows(c)).filter(r => !r.status || r.status === "synced").length;
          if (synced !== Number(prevCompanies[c] ?? 0)) { same = false; break; }
        }
        if (same) {
          this._emit("coding-index-skip", { total: declared, company: only, companies: codes.size });
          return { status: "skipped", count: Number(prev.received) || 0, companies: codes.size };
        }
      }

      this._emit("coding-index-start", { total: declared, company: only });
      // دانلود کامل یک‌بار و گروه‌بندی بر اساس CompanyCode
      const grouped = new Map();
      let received = 0;
      const iterator = this.webservice.fetchTable({ table: tableName, batchSize: this.batchSize, afterId: 0, signal: this._controller?.signal });
      for await (const pack of iterator) {
        this._checkStop();
        for (const row of pack.rows) {
          const company = String(valueAt(row, companyIdx) ?? "").trim();
          if (!/^\d+$/.test(company)) continue;
          const kol = String(valueAt(row, kolIdx) ?? "").trim();
          const moien = String(valueAt(row, moienIdx) ?? "").trim();
          const tafsil = String(valueAt(row, tafsilIdx) ?? "").trim();
          const codeHesab = String(valueAt(row, keyIdx) ?? "").trim();
          const key = codeHesab || `${company}_${kol}_${moien}_${tafsil}`;
          const csSt = String(valueAt(row, csStIdx) ?? "").trim();
          const csSh = String(valueAt(row, csShIdx) ?? "").trim();
          const gzSh = String(valueAt(row, gzShIdx) ?? "").trim();
          const gzSt = String(valueAt(row, gzStIdx) ?? "").trim();
          const legacyGroup = String(valueAt(row, groupIdx) ?? "").trim();
          if (!grouped.has(company)) grouped.set(company, new Map());
          grouped.get(company).set(key, {
            key, codehesab: key, companyCode: company, kol_code: kol, moien_code: moien, tafsil_code: tafsil,
            code_soratmali_st: csSt, code_soratmali_sh: csSh,
            code_gozareshat_sh: gzSh, code_gozareshat_st: gzSt,
            groupId: legacyGroup || csSh || "0",
            karbord: String(valueAt(row, karbordIdx) ?? "").trim() || "صورت مالی",
            status: "synced", lastModified: Date.now(),
          });
          received++;
        }
        this._emit("coding-index-chunk", { total: declared, received, company: only });
      }

      // توزیع روی استور coding_index هر شرکت (ردیف‌های pending محلی حفظ می‌شوند)
      const codes = new Set([...grouped.keys(), ...Object.keys(prevCompanies)]);
      if (only) codes.add(only);
      const counts = {};
      let pending = 0;
      for (const company of codes) {
        this._checkStop();
        const incoming = grouped.get(company) || new Map();
        // اگر شرکت در سرور ردیفی ندارد و بانکش هم ساخته نشده، بانک خالی ایجاد نشود
        if (!incoming.size && !(await dbExists(company))) { counts[company] = 0; continue; }
        const db = await this._companyDB(company);
        const real = physicalStore(db, "coding_index");
        const existing = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
        const kept = (existing || []).filter(r => r && r.status && r.status !== "synced");
        const tx = db.transaction(real, "readwrite");
        const done = txResult(tx);
        const store = tx.objectStore(real);
        store.clear();
        for (const rec of incoming.values()) store.put(rec);
        for (const rec of kept) store.put(rec);
        await done;
        counts[company] = incoming.size;
        pending += kept.length;
        this._emit("coding-index-company", { company, count: incoming.size, pending: kept.length });
      }

      const finished = received === declared;
      await this._put("Catalog", {
        key: tableName, table: tableName, family: "coding_index", sourceTable: tableName,
        storageMode: "rows", received, serverCount: declared, companies: counts,
        companyCount: Object.keys(counts).length, pending, finished,
        needsRefresh: !finished, countMismatch: !finished,
        updatedAt: new Date().toISOString(), error: null,
      });
      this._emit("coding-index-done", { company: only, total: received, companies: Object.keys(counts).length, pending });
      return { status: "synced", count: received, companies: Object.keys(counts).length, pending, finished };
    }

    /* همگام‌سازی coding_index برای یک شرکت (سازگار با کد قبلی) */
    async syncCodingIndex(companyCode) {
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        return this._syncCodingIndex({ companyCode });
      });
    }
    /* همگام‌سازی coding_index برای همهٔ شرکت‌ها */
    async syncCodingIndexAll() {
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        return this._syncCodingIndex({});
      });
    }

  }

  root.Index_db = Index_db;
})(window);