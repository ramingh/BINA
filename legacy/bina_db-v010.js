/*
 * bina_db-v01.js  (نسخه ۳)
 * ------------------------------------------------------------------
 * کامپوننت دریافت مدیریت‌شده اطلاعات از سرور (BINA WebService)
 *
 * هدف: فقط و فقط «دریافت» داده از وب‌سرویس.
 *
 * تغییرات نسخه ۳:
 *   - retry کوچیک برای درخواست‌های stats و data (خطای شبکه/HTTP/timeout).
 *   - AbortError و خطای منطقی سرور (ok:false) هرگز retry نمی‌شوند.
 *
 * دو متد اصلی:
 *   1) discoverTables({ signal, concurrency })
 *   2) fetchTable({ table, batchSize, signal })
 * ------------------------------------------------------------------
 */
(function (root) {
  "use strict";
  // ────────────────────────────────────────────────────────────────
  // تنظیمات retry
  // ────────────────────────────────────────────────────────────────
  const RETRY_MAX = 2; // حداکثر تلاش مجدد
  const RETRY_DELAYS = [300, 800]; // تأخیر بین تلاش‌ها (ms)
  const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        const onAbort = () => {
          clearTimeout(t);
          reject(new DOMException("عملیات متوقف شد.", "AbortError"));
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, {
          once: true
        });
      }
    });
  }
  // ────────────────────────────────────────────────────────────────
  // خواندن پاسخ JSON + بررسی خطا
  // خطاهای قابل‌retry با flag retryable مشخص می‌شوند
  // ────────────────────────────────────────────────────────────────
  async function readJSON(response, label) {
    if (!response.ok) {
      const err = new Error(`${label}: HTTP ${response.status}`);
      err.retryable = RETRYABLE_STATUS.has(response.status);
      throw err;
    }
    const data = await response.json();
    if (data && data.ok === false) {
      // خطای منطقی سرور — retry بی‌فایده است
      const err = new Error(`${label}: ${data.error || data.message || "خطای وب‌سرویس"}`);
      err.retryable = false;
      throw err;
    }
    return data;
  }
  // ────────────────────────────────────────────────────────────────
  // fetch با retry
  // ────────────────────────────────────────────────────────────────
  async function fetchWithRetry(url, {
    signal,
    label,
    headers
  } = {}) {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal,
          headers: headers || {
            Accept: "application/json"
          },
        });
        return await readJSON(response, label);
      } catch (err) {
        // Abort هرگز retry نمی‌شود
        if (err && err.name === "AbortError") throw err;
        // خطای منطقی سرور (ok:false) retry نمی‌شود
        if (err && err.retryable === false) throw err;
        // شبکه/HTTP قابل‌retry
        if (attempt >= RETRY_MAX) throw err;
        const delay = RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
        attempt++;
        await sleep(delay, signal);
      }
    }
  }
  // ────────────────────────────────────────────────────────────────
  // کلاس اصلی
  // ────────────────────────────────────────────────────────────────
  class webservice {
    constructor(options = {}) {
      if (!options.endpoint || typeof options.endpoint !== "string") {
        throw new Error("endpoint الزامی است (آدرس پایه وب‌سرویس).");
      }
      this.endpoint = options.endpoint;
      this.onProgress =
        typeof options.onProgress === "function" ? options.onProgress : () => {};
      this._idIndexCache = new Map();
    }
    _buildURL(params) {
      const url = new URL(this.endpoint, document.baseURI);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
      return url.href;
    }
    // ────────────────────────────────────────────────────────────
    // گرفتن stats یک جدول (با retry داخلی)
    // ────────────────────────────────────────────────────────────
    async _fetchStats(table, signal) {
      const url = this._buildURL({
        mode: "stats",
        table
      });
      const data = await fetchWithRetry(url, {
        signal,
        label: `stats ${table}`,
      });
      let idIndex = -1;
      if (Number.isInteger(data.idIndex) && data.idIndex >= 0) {
        idIndex = data.idIndex;
      } else if (typeof data.idcolumn === "string" && Array.isArray(data.columns)) {
        const wanted = data.idcolumn.toLowerCase();
        idIndex = data.columns.findIndex(
          (c) => String(c.name).toLowerCase() === wanted
        );
      }
      if (idIndex < 0 && Array.isArray(data.columns)) {
        idIndex = data.columns.findIndex(
          (c) => String(c.name).toLowerCase() === "id"
        );
      }
      if (idIndex < 0) {
        throw new Error(`stats ${table}: ستون Id پیدا نشد.`);
      }
      this._idIndexCache.set(table, idIndex);
      return {
        count: Number(data.count) || 0,
        columns: Array.isArray(data.columns) ?
          data.columns.map((c) => ({
            name: String(c.name),
            type: String(c.type || ""),
          })) : [],
        idIndex,
      };
    }
    // ════════════════════════════════════════════════════════════
    // متد ۱: کشف جداول (pool موازی + retry)
    // ════════════════════════════════════════════════════════════
    async discoverTables({
      signal,
      concurrency = 6
    } = {}) {
      const limit = Math.max(1, Math.floor(Number(concurrency) || 6));
      const listURL = this._buildURL({
        mode: "tables"
      });
      const listData = await fetchWithRetry(listURL, {
        signal,
        label: "tables",
      });
      if (!Array.isArray(listData)) {
        throw new Error("پاسخ mode=tables باید آرایه باشد.");
      }
      const entries = listData.filter(
        (e) => e && typeof e.table === "string" && e.table.trim()
      );
      this.onProgress({
        event: "discover-start",
        total: entries.length
      });
      const results = new Array(entries.length);
      let next = 0;
      let completed = 0;
      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= entries.length) return;
          const table = entries[i].table.trim();
          try {
            const stats = await this._fetchStats(table, signal);
            results[i] = {
              key: table,
              value: {
                count: stats.count,
                columns: stats.columns
              },
            };
            completed++;
            this.onProgress({
              event: "stats-done",
              table,
              count: stats.count,
              columns: stats.columns.length,
              completed,
              total: entries.length,
            });
          } catch (err) {
            if (err && err.name === "AbortError") throw err;
            results[i] = {
              key: table,
              error: err.message
            };
            completed++;
            this.onProgress({
              event: "stats-failed",
              table,
              error: err.message,
              completed,
              total: entries.length,
            });
          }
        }
      };
      const workerCount = Math.min(limit, entries.length);
      await Promise.all(Array.from({
        length: workerCount
      }, () => worker()));
      const ok = results.filter((r) => r && !r.error);
      this.onProgress({
        event: "discover-done",
        total: ok.length
      });
      return ok;
    }
    // ════════════════════════════════════════════════════════════
    // متد ۲: دریافت داده یک جدول (async generator، هر بچ با retry)
    // ════════════════════════════════════════════════════════════
    async *fetchTable({
      table,
      batchSize,
      signal
    } = {}) {
      if (!table || typeof table !== "string") {
        throw new Error("نام جدول الزامی است.");
      }
      const size = Math.floor(Number(batchSize));
      if (!Number.isInteger(size) || size <= 0) {
        throw new Error("batchSize باید عدد صحیح مثبت باشد.");
      }
      if (!this._idIndexCache.has(table)) {
        await this._fetchStats(table, signal);
      }
      const idIndex = this._idIndexCache.get(table);
      let lastId = 0;
      while (true) {
        const url = this._buildURL({
          mode: "data",
          table,
          lastId,
          batchSize: size,
        });
        // هر بچ با retry داخلی؛ یک بچ شکست‌خورده کل جدول را خراب نمی‌کند
        const data = await fetchWithRetry(url, {
          signal,
          label: `data ${table}`,
        });
        if (!Array.isArray(data)) {
          throw new Error(`data ${table}: پاسخ باید آرایه باشد.`);
        }
        if (data.length === 0) {
          this.onProgress({
            event: "table-end",
            table,
            lastId
          });
          return;
        }
        const lastRow = data[data.length - 1];
        const newLastId = Number(
          Array.isArray(lastRow) ? lastRow[idIndex] : lastRow
        );
        if (!Number.isFinite(newLastId)) {
          throw new Error(
            `data ${table}: مقدار Id در آخرین ردیف معتبر نیست (index=${idIndex}).`
          );
        }
        this.onProgress({
          event: "batch",
          table,
          count: data.length,
          lastId: newLastId,
        });
        yield {
          lastId: newLastId,
          rows: data
        };
        lastId = newLastId;
      }
    }
  }
  root.webservice = webservice;
})(window);
/*
 * ═══════════════════════════════════════════════════════════════════════
 *  Index_db — لایه ذخیره‌سازی محلی (IndexedDB) برای داده‌های BINA
 * ═══════════════════════════════════════════════════════════════════════
 *
 * وابستگی: به یک نمونه از کلاس webservice (دریافت از سرور) تزریق می‌شود.
 *          Index_db فقط ذخیره، چک‌پوینت، بازیابی و خواندن را انجام می‌دهد.
 *
 * ساختار دیتابیس‌ها:
 *   public (نسخه 3) با ۵ استور:
 *     - ServerTables : فهرست جداول سرور {key:table, count, info}
 *     - catalog      : وضعیت/چک‌پوینت هر جدول (lastId, received, blocks, storageMode, ...)
 *     - columns      : Schema خانواده‌ها (Coding / Sanad)
 *     - tk_dic       : ترجمه‌ها، کلید [CountryCode, FieldName]
 *     - tk_sherkat   : نام شرکت‌ها، کلید [CodeSherkat, EsmSherkat]
 *
 *   {companyCode} (نسخه 3) با دقیقاً دو استور:
 *     - Coding : کلید [CompanyCode, blockNo]
 *     - Sanad  : کلید [FiscalYear, CompanyCode, blockNo]
 *     هر بلوک = Uint8Array = gzip(JSON{ids, rows})  (فقط حالت بلوکی)
 *
 *   Tajmi حذف شده است.
 *
 * قواعد کلیدی:
 *   - فقط حالت بلوکی gzip برای Coding/Sanad (حالت ردیفی/lz حذف شده).
 *   - tk_* ردیفی و سبک، در public، فقط یک‌بار در bootstrap اولیه گرفته می‌شوند.
 *   - هیچ تماس شبکه‌ای در bootstrap‌های بعدی برای مقایسه انجام نمی‌شود؛
 *     فقط از ServerTables و catalog لوکال استفاده می‌شود.
 *   - ادامه از lastId؛ replace فقط وقتی received > serverCount.
 *   - ماندگاری storage در initialize درخواست می‌شود.
 * ═══════════════════════════════════════════════════════════════════════
 */
(function (root) {
  "use strict";
  /* ────────────────────────────────────────────────────────────────
   * ثابت‌ها
   * ──────────────────────────────────────────────────────────────── */
  const PUBLIC = "public";
  const PUBLIC_STORES = ["ServerTables", "catalog", "columns", "tk_dic", "tk_sherkat"];
  const DATA_STORES = ["Coding", "Sanad"];
  // VERSION فقط برای گزارش initialize است؛ open دیگر نسخهٔ پایین‌تر از موجود را درخواست نمی‌کند.
  const VERSION = 3;
  const MAX_ID = Number.MAX_SAFE_INTEGER;
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();
  /* ────────────────────────────────────────────────────────────────
   * ابزارهای IndexedDB
   * ──────────────────────────────────────────────────────────────── */
  function reqResult(req) {
    return new Promise((ok, bad) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error || new Error("IndexedDB request failed"));
    });
  }
function txResult(tx) {
  return new Promise((ok, bad) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => bad(tx.error || new Error("IndexedDB transaction aborted (unknown reason)"));
    tx.onerror = () => {};
  });
}
  /** ساخت استورهای ناقص در رویداد upgrade */
  function ensureStores(db, stores) {
    for (const [storeName, keyPath] of stores) {
      if (!db.objectStoreNames.contains(storeName)) {
        keyPath
          ? db.createObjectStore(storeName, { keyPath })
          : db.createObjectStore(storeName);
      }
    }
  }
  /**
   * باز کردن DB بدون اجبار به VERSION ثابت.
   * - اگر بانک از قبل نسخهٔ بالاتر (مثلاً 5) دارد → همان نسخه باز می‌شود.
   * - اگر استور کم باشد → فقط version فعلی + 1 برای upgrade.
   * - هرگز open(name, version کمتر از فعلی) صدا زده نمی‌شود
   *   (رفع خطای: requested version is less than existing version).
   */
  function openDB(name, stores) {
    return new Promise((ok, bad) => {
      // مرحلهٔ ۱: بدون version — نسخهٔ فعلی یا ساخت بانک جدید
      const probe = indexedDB.open(name);
      probe.onerror = () => bad(probe.error || new Error(`Cannot open ${name}`));
      probe.onblocked = () =>
        bad(new Error(`بانک ${name} در تب دیگری باز است؛ آن تب را ببندید.`));
      probe.onupgradeneeded = () => {
        // بانک تازه (نسخهٔ پیش‌فرض 1)
        ensureStores(probe.result, stores);
      };
      probe.onsuccess = () => {
        const db = probe.result;
        const missing = stores.filter(([s]) => !db.objectStoreNames.contains(s));
        if (!missing.length) {
          db.onversionchange = () => db.close();
          ok(db);
          return;
        }
        // استور کم است → upgrade به version فعلی + 1
        const nextVer = db.version + 1;
        db.close();
        const up = indexedDB.open(name, nextVer);
        up.onerror = () =>
          bad(up.error || new Error(`Cannot upgrade ${name} to v${nextVer}`));
        up.onblocked = () =>
          bad(new Error(`بانک ${name} در تب دیگری باز است؛ آن تب را ببندید.`));
        up.onupgradeneeded = () => ensureStores(up.result, stores);
        up.onsuccess = () => {
          const d = up.result;
          const still = stores.filter(([s]) => !d.objectStoreNames.contains(s));
          if (still.length) {
            d.close();
            bad(
              new Error(
                `${name}: استورهای ${still.map((x) => x[0]).join(", ")} ساخته نشدند.`
              )
            );
            return;
          }
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
    const prefix = info.family === "Sanad" ? [info.year, info.company] : [info.company];
    return IDBKeyRange.bound([...prefix, Math.max(0, after + 1)], [...prefix, MAX_ID]);
  }
  function fullRange(info) {
    return keyRange(info, -1);
  }
  function blockKey(info, blockNo) {
    return info.family === "Sanad" ? [info.year, info.company, blockNo] : [info.company, blockNo];
  }
  function lastPart(key) {
    return key[key.length - 1];
  }
  function blocksOf(state) {
    return Array.isArray(state?.blocks) ? state.blocks : [];
  }
  async function gzipJSON(obj) {
    const stream = new Blob([ENC.encode(JSON.stringify(obj))]).stream()
      .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzipJSON(bytes) {
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(DEC.decode(await new Response(stream).arrayBuffer()));
  }
  const yieldUI = () => new Promise(ok => setTimeout(ok, 0));
  function blankState(info, serverCount = 0) {
    return {
      ...info,
      lastId: 0,
      received: 0,
      finished: false,
      needsRefresh: false,
      refreshMode: "append",
      serverCount,
      storageMode: "blocks",
      blocks: [],
      updatedAt: null,
      error: null
    };
  }
  /* ────────────────────────────────────────────────────────────────
   * کلاس Index_db
   * ──────────────────────────────────────────────────────────────── */
  class Index_db {
    /**
     * @param {Object}     options
     * @param {webservice} options.webservice  نمونه دریافت‌کننده از سرور (الزامی)
     * @param {Function}   [options.onProgress]
     * @param {number}     [options.blockSize=10000]   تعداد ردیف در هر بلوک
     * @param {number}     [options.batchSize=10000]    اندازه بچ دریافت از سرور
     * @param {number}     [options.minYear=1350]
     * @param {number}     [options.maxYear=1420]
     */
    constructor(options = {}) {
      if (!options.webservice || typeof options.webservice.fetchTable !== "function")
        throw new Error("webservice الزامی است (نمونه‌ای از کلاس webservice).");
      this.webservice = options.webservice;
      this.blockSize = Math.min(50000, Math.max(500, Math.floor(Number(options.blockSize) || 10000)));
      this.batchSize = Math.min(50000, Math.max(1, Math.floor(Number(options.batchSize) || 10000)));
      this.minYear = Math.floor(Number(options.minYear) || 1350);
      this.maxYear = Math.floor(Number(options.maxYear) || 1420);
      if (this.minYear > this.maxYear) throw new Error("minYear نمی‌تواند از maxYear بزرگ‌تر باشد.");
      this.onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
      this._public = null;
      this._company = null;
      this._schemaCache = new Map();
      this._controller = null;
      this._busy = false;
      this._stopRequested = false;
    }
    get busy() {
      return this._busy;
    }
    _emit(event, fields = {}) {
      this.onProgress({
        event,
        ...fields
      });
    }
    _checkStop() {
      if (this._stopRequested || this._controller?.signal.aborted)
        throw new DOMException("عملیات متوقف شد.", "AbortError");
    }
    stop() {
      this._stopRequested = true;
      this._controller?.abort();
    }
    async _run(fn) {
      if (this._busy) throw new Error("عملیات دیگری در حال اجرا است.");
      this._busy = true;
      this._stopRequested = false;
      this._controller = new AbortController();
      try {
        return await fn();
      } finally {
        this._controller = null;
        this._busy = false;
        this._closeCompany();
      }
    }
    /* ────────────────────────────────────────────────────────────
     * ماندگاری Storage
     * ──────────────────────────────────────────────────────────── */
    async _requestPersistence() {
      try {
        await navigator.storage.persist();
console.log('persisted=', await navigator.storage.persisted());
        if (!navigator.storage || !navigator.storage.persist) return false;
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    }
    /**
     * وضعیت ماندگاری و مصرف فضای ذخیره‌سازی
     */
    async getStorageStatus() {
      const status = {
        supported: !!(navigator.storage && navigator.storage.persist),
        persisted: false,
        usage: 0,
        quota: 0,
        usageMB: "0",
        quotaMB: "0",
        percent: 0
      };
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
      } catch (err) {
        console.warn("storage estimate:", err.message);
      }
      return status;
    }
    /* ────────────────────────────────────────────────────────────
     * مدیریت اتصال دیتابیس‌ها
     * ──────────────────────────────────────────────────────────── */
    async _publicDB() {
      if (this._public) return this._public;
      const db = await openDB(PUBLIC, PUBLIC_STORES.map(s => [s, "key"]));
      db.onversionchange = () => {
        db.close();
        if (this._public === db) this._public = null;
      };
      db.onclose = () => {
        if (this._public === db) this._public = null;
      };
      this._public = db;
      return db;
    }
    async _companyDB(company) {
      const code = codeOf(company);
      if (this._company?.code === code) return this._company.db;
      this._closeCompany();
      const db = await openDB(code, DATA_STORES.map(s => [s, null]));
      this._company = {
        code,
        db
      };
      return db;
    }
    _closeCompany() {
      this._company?.db.close();
      this._company = null;
    }
    async close() {
      this.stop();
      this._closeCompany();
      this._public?.close();
      this._public = null;
      this._schemaCache.clear();
    }
    /* ────────────────────────────────────────────────────────────
     * initialize: ساخت استورها + ماندگاری
     * ──────────────────────────────────────────────────────────── */
    async initialize() {
      const persisted = await this._requestPersistence();
      this._emit("storage-persist", {
        persisted
      });
      await this._publicDB();
      return {
        public: PUBLIC,
        publicStores: [...PUBLIC_STORES],
        companyStores: [...DATA_STORES],
        version: VERSION,
        persisted
      };
    }
    /* ────────────────────────────────────────────────────────────
     * ابزار پایه public
     * ──────────────────────────────────────────────────────────── */
    async _get(store, key) {
      const db = await this._publicDB();
      return reqResult(db.transaction(store, "readonly").objectStore(store).get(key));
    }
    async _put(store, item) {
      const db = await this._publicDB();
      const tx = db.transaction(store, "readwrite");
      const done = txResult(tx);
      tx.objectStore(store).put(item);
      await done;
    }
    /* ────────────────────────────────────────────────────────────
     * تشخیص نوع جدول
     * ──────────────────────────────────────────────────────────── */
    _tableInfo(table) {
      const name = String(table || "").trim();
      let m = /^coding_(\d+)$/i.exec(name);
      if (m) return {
        table: name,
        company: m[1],
        family: "Coding",
        year: null
      };
      m = /^sanad_(\d{4})_(\d+)$/i.exec(name);
      if (m && Number(m[1]) >= this.minYear && Number(m[1]) <= this.maxYear)
        return {
          table: name,
          company: m[2],
          family: "Sanad",
          year: Number(m[1])
        };
      if (/^tk_/i.test(name)) return {
        table: name,
        company: null,
        family: "TK",
        year: null
      };
      return null;
    }
    /* ────────────────────────────────────────────────────────────
     * ServerTables
     * ──────────────────────────────────────────────────────────── */
    async getServerTables() {
      const db = await this._publicDB();
      return (await reqResult(db.transaction("ServerTables", "readonly").objectStore("ServerTables").getAll()))
        .map(x => ({
          table: x.table,
          count: x.count,
          ...x.info
        }));
    }
    async _saveServerTables(rows) {
      if (!Array.isArray(rows)) throw new Error("mode=tables باید آرایه باشد.");
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        if (!row || typeof row.table !== "string" || !row.table.trim()) continue;
        if (seen.has(row.table.toLowerCase())) continue;
        seen.add(row.table.toLowerCase());
        entries.push({
          key: row.table,
          table: row.table,
          count: Number(row.count) || 0,
          info: this._tableInfo(row.table),
          fetchedAt: new Date().toISOString()
        });
      }
      const db = await this._publicDB();
      const tx = db.transaction("ServerTables", "readwrite");
      const done = txResult(tx);
      const store = tx.objectStore("ServerTables");
      store.clear();
      for (const e of entries) store.put(e);
      await done;
      return entries;
    }
    /* ────────────────────────────────────────────────────────────
     * columns (Schema)
     * ──────────────────────────────────────────────────────────── */
    async getcolumns(family) {
      return this._get("columns", String(family));
    }
    async _saveSchemaFromStats(stats) {
      const info = this._tableInfo(stats.table);
      if (!info || info.family === "TK") return null;
      const columns = stats.columns.map(c => ({
        name: String(c.name),
        type: String(c.type || "")
      }));
      let idIndex = Number.isInteger(stats.idIndex) ? stats.idIndex :
        columns.findIndex(c => c.name.toLowerCase() === String(stats.idcolumn || "id").toLowerCase());
      if (idIndex < 0) idIndex = columns.findIndex(c => c.name.toLowerCase() === "id");
      if (idIndex < 0) throw new Error(`ستون Id در Schema ${stats.table} پیدا نشد.`);
      const schema = {
        key: info.family,
        columns,
        idIndex,
        idcolumn: String(stats.idcolumn || columns[idIndex].name),
        sourceTable: stats.table,
        fetchedAt: new Date().toISOString()
      };
      await this._put("columns", schema);
      this._schemaCache.set(info.family, schema);
      return schema;
    }
    async _schema(info) {
      if (this._schemaCache.has(info.family)) return this._schemaCache.get(info.family);
      let schema = await this.getcolumns(info.family);
      if (!schema) throw new Error(`Schema خانواده ${info.family} موجود نیست. ابتدا bootstrap را اجرا کنید.`);
      this._schemaCache.set(info.family, schema);
      return schema;
    }
    /* ────────────────────────────────────────────────────────────
     * catalog
     * ──────────────────────────────────────────────────────────── */
    async getcatalog({
      companyCode = null
    } = {}) {
      const db = await this._publicDB();
      const all = await reqResult(db.transaction("catalog", "readonly").objectStore("catalog").getAll());
      return companyCode == null ? all : all.filter(x => x.company === codeOf(companyCode));
    }
    /* ────────────────────────────────────────────────────────────
     * بازیابی چک‌پوینت واقعی (blocks mode)
     * ──────────────────────────────────────────────────────────── */
    async _actualBlockNos(db, info) {
      const out = [];
      await new Promise((ok, bad) => {
        const rq = db.transaction(info.family, "readonly").objectStore(info.family)
          .openKeyCursor(fullRange(info));
        rq.onerror = () => bad(rq.error);
        rq.onsuccess = () => {
          const c = rq.result;
          if (!c) {
            ok();
            return;
          }
          out.push(Number(lastPart(c.key)));
          c.continue();
        };
      });
      return out;
    }
    async _realTipBlocks(info, state, db) {
      const metas = blocksOf(state).map(m => ({
        n: Number(m.n),
        firstId: Number(m.firstId || 0),
        lastId: Number(m.lastId || 0),
        count: Number(m.count || 0),
        bytes: Number(m.bytes || 0)
      }));
      const cur = await reqResult(db.transaction(info.family, "readonly")
        .objectStore(info.family).openKeyCursor(fullRange(info), "prev"));
      const lastNo = cur ? Number(lastPart(cur.key)) : null;
      if (lastNo !== null && metas.length && metas[metas.length - 1].n === lastNo &&
        Number(state?.lastId ?? 0) === metas[metas.length - 1].lastId) return state;
      if (lastNo === null && !metas.length && Number(state?.lastId ?? 0) === 0) return state;
      const known = new Map(metas.map(m => [m.n, m]));
      const actual = await this._actualBlockNos(db, info);
      const merged = [];
      for (const n of actual) {
        let m = known.get(Number(n));
        if (!m) {
          const packed = await reqResult(db.transaction(info.family, "readonly")
            .objectStore(info.family).get(blockKey(info, n)));
          if (!packed) continue;
          const un = await gunzipJSON(packed);
          m = {
            n: Number(n),
            firstId: Number(un.ids[0]),
            lastId: Number(un.ids[un.ids.length - 1]),
            count: un.ids.length,
            bytes: packed.byteLength || 0
          };
        }
        merged.push(m);
      }
      merged.sort((a, b) => a.n - b.n);
      const received = merged.reduce((s, m) => s + m.count, 0);
      const lastId = merged.length ? merged[merged.length - 1].lastId : 0;
      const next = {
        ...(state || blankState(info)),
        ...info,
        blocks: merged,
        lastId,
        received,
        finished: false,
        needsRefresh: state?.needsRefresh || false,
        storageMode: "blocks",
        updatedAt: new Date().toISOString()
      };
      await this._put("catalog", {
        ...next,
        key: info.table
      });
      this._emit("checkpoint-recovered", {
        table: info.table,
        received,
        lastId
      });
      return next;
    }
    async _clearTable(db, info) {
      const tx = db.transaction([info.family], "readwrite");
      const done = txResult(tx);
      tx.objectStore(info.family).delete(fullRange(info));
      await done;
    }
    /* ────────────────────────────────────────────────────────────
     * ذخیره بلوکی (gzip)
     * ──────────────────────────────────────────────────────────── */
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
      const ids = [],
        vals = [];
      let lastId = startId;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const id = numericID(val(row, schema.idIndex), info.table);
        if (id <= lastId) throw new Error(`${info.table}: ID نامرتب (${id} <= ${lastId}).`);
        const values = new Array(schema.columns.length - 1);
        for (let c = 0, k = 0; c < schema.columns.length; c++)
          if (c !== schema.idIndex) values[k++] = val(row, c);
        ids.push(id);
        vals.push(values);
        lastId = id;
      }
      return {
        ids,
        vals
      };
    }
    /* ────────────────────────────────────────────────────────────
     * دریافت و ذخیره یک جدول (بلوکی gzip)
     * ──────────────────────────────────────────────────────────── */
    async _syncOne(info) {
      this._checkStop();
      const db = await this._companyDB(info.company);
      const schema = await this._schema(info);
      let state = await this._get("catalog", info.table);
      if (state && (state.storageMode !== "blocks" || state.refreshMode === "replace")) {
        this._emit("table-reset", {
          table: info.table,
          reason: "replace"
        });
        await this._clearTable(db, info);
        state = {
          ...blankState(info, state.serverCount || 0),
          key: info.table
        };
        await this._put("catalog", state);
      }
      if (!state) {
        state = {
          ...blankState(info, info.serverCount || 0),
          key: info.table
        };
        await this._put("catalog", state);
      } else {
        state = await this._realTipBlocks(info, state, db);
      }
      if (state.finished && !state.needsRefresh) {
        this._emit("table-skip", {
          table: info.table,
          received: state.received
        });
        return state;
      }
      this._emit("table-start", {
        table: info.table,
        company: info.company,
        year: info.year,
        received: state.received
      });
      return this._pullBlocks(db, info, schema, state);
    }
    async _pullBlocks(db, info, schema, state) {
      const bs = this.blockSize;
      // آماده‌سازی دنباله (tail) برای ادامه/ادغام
      let tail = {
        n: 0,
        ids: [],
        vals: []
      };
      const last0 = blocksOf(state)[blocksOf(state).length - 1] || null;
      if (last0) {
        if (Number(last0.count) < bs) {
          const packed = await reqResult(db.transaction(info.family, "readonly")
            .objectStore(info.family).get(blockKey(info, Number(last0.n))));
          if (!packed) throw new Error(`${info.table}: بلوک ناقص بدون داده (${last0.n}).`);
          const un = await gunzipJSON(packed);
          tail = {
            n: Number(last0.n),
            ids: un.ids,
            vals: un.rows
          };
        } else {
          tail = {
            n: Number(last0.n) + 1,
            ids: [],
            vals: []
          };
        }
      }
      // حلقه دریافت از webservice با async generator
      const iterator = this.webservice.fetchTable({
        table: info.table,
        batchSize: this.batchSize,
        signal: this._controller?.signal
      });
      for await (const {
        rows
      } of iterator) {
        this._checkStop();
        const extracted = await this._extractBatch(info, schema, rows, state.lastId);
        for (let i = 0; i < extracted.ids.length; i++) {
          tail.ids.push(extracted.ids[i]);
          tail.vals.push(extracted.vals[i]);
        }
        // مهر و موم بلوک‌های کامل
        const sealed = [];
        while (tail.ids.length >= bs) {
          sealed.push({
            n: tail.n,
            ids: tail.ids.splice(0, bs),
            vals: tail.vals.splice(0, bs)
          });
          tail.n++;
        }
        // فشرده‌سازی خارج از تراکنش
        const jobs = sealed.map(b => ({
          n: b.n,
          ids: b.ids,
          vals: b.vals,
          payload: gzipJSON({
            ids: b.ids,
            rows: b.vals
          })
        }));
        if (tail.ids.length) {
          jobs.push({
            n: tail.n,
            ids: tail.ids,
            vals: tail.vals,
            payload: gzipJSON({
              ids: tail.ids,
              rows: tail.vals
            })
          });
        }
        const packedList = await Promise.all(jobs.map(j => j.payload));
        // نوشتن بلوک‌ها در یک تراکنش
        const tx = db.transaction([info.family], "readwrite");
        const done = txResult(tx);
        const ds = tx.objectStore(info.family);
        for (let j = 0; j < jobs.length; j++) ds.put(packedList[j], blockKey(info, jobs[j].n));
        await done;
        // به‌روزرسانی متادیتای catalog.blocks
        const byN = new Map(blocksOf(state).map(b => [Number(b.n), b]));
        for (let j = 0; j < jobs.length; j++) {
          byN.set(Number(jobs[j].n), {
            n: Number(jobs[j].n),
            firstId: jobs[j].ids[0],
            lastId: jobs[j].ids[jobs[j].ids.length - 1],
            count: jobs[j].ids.length,
            bytes: packedList[j].byteLength || 0
          });
        }
        state = {
          ...state,
          blocks: [...byN.values()].sort((a, b) => a.n - b.n),
          lastId: extracted.ids[extracted.ids.length - 1],
          received: state.received + extracted.ids.length,
          finished: false,
          storageMode: "blocks",
          updatedAt: new Date().toISOString()
        };
        this._emit("chunk", {
          table: info.table,
          company: info.company,
          lastId: state.lastId,
          received: state.received
        });
        await this._put("catalog", {
          ...state,
          key: info.table
        });
        await yieldUI();
      }
      // پایان
      state = {
        ...state,
        finished: true,
        needsRefresh: false,
        countMismatch: Number.isFinite(state.serverCount) && state.received !== state.serverCount,
        updatedAt: new Date().toISOString()
      };
      await this._put("catalog", {
        ...state,
        key: info.table
      });
      this._emit("table-done", {
        table: info.table,
        company: info.company,
        received: state.received
      });
      return state;
    }
    /* ────────────────────────────────────────────────────────────
     * دریافت tk_* (یک‌بار، کامل، ردیفی)
     * ──────────────────────────────────────────────────────────── */
    /* ────────────────────────────────────────────────────────────
     * دریافت tk_* (یک‌بار، کامل، ردیفی)
     * - کلید از ستون Id ساخته می‌شود (در هر دو جدول موجود است)
     * - خواندن ستون‌ها case-insensitive است تا Codesherkat/CodeSherkat
     *   یا CountryCode/countrycode مشکلی ایجاد نکند
     * ──────────────────────────────────────────────────────────── */
        /* ────────────────────────────────────────────────────────────
     * دریافت tk_* (یک‌بار، کامل، ردیفی)
     * - از stats برای گرفتن اسم و ترتیب ستون‌ها استفاده می‌شود
     * - کلید = ستون Id (در هر دو جدول موجود است)
     * - اسم ستون‌ها case-insensitive نگاشت می‌شوند
     * ──────────────────────────────────────────────────────────── */
    async _fetchTK(storeName, tableName) {
      // اگر قبلاً پر شده، رد کن
      const existing = await reqResult(
        (await this._publicDB()).transaction(storeName, "readonly").objectStore(storeName).count()
      );
      if (existing > 0) {
        this._emit("tk-skip", { store: storeName, count: existing });
        return existing;
      }
      // گرفتن Schema جدول از stats
      const stats = await this.webservice._fetchStats(tableName, this._controller?.signal);
      const columns = stats.columns.map(c => String(c.name));
      const idIndex = stats.idIndex >= 0 ? stats.idIndex :
        columns.findIndex(c => c.toLowerCase() === "id");
      if (idIndex < 0) throw new Error(`${tableName}: ستون Id پیدا نشد.`);
      // دریافت همه ردیف‌ها
      const rows = [];
      const iterator = this.webservice.fetchTable({
        table: tableName,
        batchSize: 3000,
        signal: this._controller?.signal
      });
      for await (const { rows: batch } of iterator) rows.push(...batch);
      // نوشتن در یک تراکنش، کلید = Id
      const db = await this._publicDB();
      const tx = db.transaction(storeName, "readwrite");
      const done = txResult(tx);
      const store = tx.objectStore(storeName);
      store.clear();
      let written = 0;
      for (const row of rows) {
        const id = Number(Array.isArray(row) ? row[idIndex] : row[columns[idIndex]]);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        // ساخت آبجکت از روی آرایه + columns
        const obj = { key: id };
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = Array.isArray(row) ? row[i] : row[columns[i]];
        }
        store.put(obj);
        written++;
      }
      await done;
      this._emit("tk-loaded", { store: storeName, count: written });
      return written;
    }
    /* ────────────────────────────────────────────────────────────
     * bootstrap: راه‌اندازی اولیه (online) یا ادامه لوکال (offline)
     * ──────────────────────────────────────────────────────────── */
    /* ────────────────────────────────────────────────────────────
     * bootstrap: فقط راه‌اندازی اولیه
     * - initialize + ماندگاری
     * - discoverTables (فقط اگه ServerTables خالی باشه)
     * - tk_dic و tk_sherkat (فقط اگه خالی باشن)
     * ⚠ هیچ جدول Coding/Sanad اینجا دانلود نمی‌شود.
     * ──────────────────────────────────────────────────────────── */
    async bootstrap() {
      return this._run(async () => {
        await this.initialize();
        const localTables = await this.getServerTables();
        const isFirstRun = localTables.length === 0;
        let discovered = 0;
        if (isFirstRun) {
          this._emit("bootstrap-online", {});
          const result = await this.webservice.discoverTables({
            signal: this._controller?.signal
          });
          await this._saveServerTables(result.map(d => ({
            table: d.key, count: d.value.count
          })));
          discovered = result.length;
          // ذخیره Schema برای خانواده‌ها (Coding / Sanad)
          for (const d of result) {
            const info = this._tableInfo(d.key);
            if (!info || info.family === "TK") continue;
            if (this._schemaCache.has(info.family)) continue;
            try {
              const stats = await this.webservice._fetchStats(d.key, this._controller?.signal);
              await this._saveSchemaFromStats({
                ...stats, table: d.key,
                columns: d.value.columns, idIndex: stats.idIndex
              });
            } catch (err) {
              this._emit("schema-failed", { table: d.key, error: err.message });
            }
          }
        }
        // tk_ همیشه چک شود (فقط اگه خالی باشد پر می‌کند)
        let tkdic = 0, tksherkat = 0;
        try {
          tkdic = await this._fetchTK("tk_dic", "tk_dic_FieldName");
          tksherkat = await this._fetchTK("tk_sherkat", "tk_EsmSherkatHolding");
        } catch (err) {
          this._emit("tk-error", { error: err.message });
        }
        this._emit("bootstrap-done", { firstRun: isFirstRun, discovered, tkdic, tksherkat });
        return { firstRun: isFirstRun, discovered, tkdic, tksherkat };
      });
    }
    /* ────────────────────────────────────────────────────────────
     * refreshServerTables: فقط فهرست جداول و Schema را از سرور تازه کن
     * (داده‌های Coding/Sanad دست نمی‌خورد)
     * ──────────────────────────────────────────────────────────── */
    async refreshServerTables() {
      return this._run(async () => {
        await this.initialize();
        this._emit("refresh-start", {});
        const result = await this.webservice.discoverTables({
          signal: this._controller?.signal
        });
        await this._saveServerTables(result.map(d => ({
          table: d.key, count: d.value.count
        })));
        // آپدیت Schema خانواده‌ها
        this._schemaCache.clear();
        for (const d of result) {
          const info = this._tableInfo(d.key);
          if (!info || info.family === "TK") continue;
          if (this._schemaCache.has(info.family)) continue;
          try {
            const stats = await this.webservice._fetchStats(d.key, this._controller?.signal);
            await this._saveSchemaFromStats({
              ...stats, table: d.key,
              columns: d.value.columns, idIndex: stats.idIndex
            });
          } catch (err) {
            this._emit("schema-failed", { table: d.key, error: err.message });
          }
        }
        this._emit("refresh-done", { total: result.length });
        return { total: result.length };
      });
    }
    /* ────────────────────────────────────────────────────────────
     * getTableList: لیست جداول Coding/Sanad با وضعیت لوکال
     * ──────────────────────────────────────────────────────────── */
    async getTableList({ companyCode = null, family = null, status = null } = {}) {
      await this.initialize();
      const tables = await this.getServerTables();
      const catalog = await this.getcatalog();
      const states = new Map(catalog.map(s => [s.table.toLowerCase(), s]));
      const codeFilter = companyCode ? codeOf(companyCode) : null;
      const rows = [];
      for (const entry of tables) {
        const info = this._tableInfo(entry.table);
        if (!info || info.family === "TK") continue;
        if (codeFilter && info.company !== codeFilter) continue;
        if (family && info.family !== family) continue;
        const local = states.get(entry.table.toLowerCase());
        const localCount = local?.received || 0;
        const serverCount = Number(entry.count) || 0;
        let st;
        if (!local) st = "missing";
        else if (!local.finished) st = "incomplete";
        else if (localCount !== serverCount) st = "diff";
        else st = "ok";
        if (status && st !== status) continue;
        rows.push({
          table: entry.table,
          company: info.company,
          family: info.family,
          year: info.year,
          serverCount,
          localCount,
          finished: !!local?.finished,
          status: st
        });
      }
      rows.sort((a, b) =>
        Number(a.company) - Number(b.company) ||
        (a.family === "Coding" ? -1 : 0) - (b.family === "Coding" ? -1 : 0) ||
        (a.year || 0) - (b.year || 0)
      );
      return rows;
    }
    /* ────────────────────────────────────────────────────────────
     * syncTables: فقط جداول انتخاب‌شده را دانلود/تکمیل کن
     * ──────────────────────────────────────────────────────────── */
    async syncTables(tableNames) {
      const names = [...new Set((tableNames || []).map(String).filter(Boolean))];
      if (!names.length) throw new Error("هیچ جدولی انتخاب نشده است.");
      return this._run(async () => {
        await this.initialize();
        const tables = await this.getServerTables();
        const map = new Map(tables.map(t => [t.table.toLowerCase(), t]));
        let done = 0;
        for (const name of names) {
          this._checkStop();
          const src = map.get(name.toLowerCase());
          if (!src) { this._emit("table-missing", { table: name }); continue; }
          const info = this._tableInfo(name);
          if (!info || info.family === "TK") continue;
          try {
            await this._syncOne({ ...info, serverCount: Number(src.count) || 0 });
            done++;
            this._emit("job-done", { done, total: names.length, table: name });
          } catch (err) {
            if (err.name === "AbortError") throw err;
   this._emit("table-error", {
  table: name,
  error: err.message,
  errorName: err.name,
  errorStack: (err.stack || "").split("\n")[1] || ""
});
            // this._emit("table-error", { table: name, error: err.message });
          }
        }
        return { requested: names.length, completed: done };
      });
    }
    /* ────────────────────────────────────────────────────────────
     * همگام‌سازی دستی
     * ──────────────────────────────────────────────────────────── */
    async start({
      companyCode = null
    } = {}) {
      return this._run(async () => {
        await this.initialize();
        const tables = await this.getServerTables();
        const jobs = tables
          .map(e => ({
            ...this._tableInfo(e.table),
            serverCount: Number(e.count) || 0
          }))
          .filter(e => e.table && e.family !== "TK" &&
            (companyCode == null || e.company === codeOf(companyCode)));
        let done = 0;
        for (const info of jobs) {
          this._checkStop();
          await this._syncOne(info);
          done++;
          this._emit("job-done", {
            done,
            total: jobs.length,
            table: info.table,
            company: info.company
          });
        }
        return {
          completedTables: done,
          totalTables: jobs.length,
          companyCode
        };
      });
    }
    async syncCompany(code) {
      return this.start({
        companyCode: code
      });
    }
    async syncAll() {
      return this.start();
    }
    async syncTable(tableName, {
      replace = false
    } = {}) {
      return this._run(async () => {
        await this.initialize();
        const info = this._tableInfo(tableName);
        if (!info || info.family === "TK") throw new Error("جدول Coding/Sanad معتبر نیست.");
        const tables = await this.getServerTables();
        const src = tables.find(x => x.table.toLowerCase() === info.table.toLowerCase());
        if (!src) throw new Error("جدول در ServerTables نیست.");
        if (replace) {
          const st = await this._get("catalog", info.table);
          if (st) await this._put("catalog", {
            ...st,
            key: info.table,
            refreshMode: "replace"
          });
        }
        return this._syncOne({
          ...info,
          serverCount: Number(src.count) || 0
        });
      });
    }
    /* ────────────────────────────────────────────────────────────
     * خواندن داده‌ها (Coding / Sanad) — حالت بلوکی
     * ──────────────────────────────────────────────────────────── */
    async getRows({
      companyCode,
      family = "Sanad",
      year = null,
      afterId = -1,
      limit = 50
    } = {}) {
      const code = codeOf(companyCode);
      if (!DATA_STORES.includes(family)) throw new Error("family باید Coding یا Sanad باشد.");
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit باید 1..1000 باشد.");
      if (!Number.isSafeInteger(afterId) || afterId < -1) throw new Error("afterId نامعتبر است.");
      if (family === "Sanad" && (!Number.isInteger(Number(year)) ||
          Number(year) < this.minYear || Number(year) > this.maxYear))
        throw new Error(`سال مالی برای Sanad الزامی است (${this.minYear} تا ${this.maxYear}).`);
      const info = { 
        company: code,
        family,
        year: family === "Coding" ? null : Number(year),
        table: family === "Sanad" ? `Sanad_${Number(year)}_${code}` : `Coding_${code}`
      };
      const schema = await this.getcolumns(family);
      if (!schema) throw new Error(`Schema ${family} موجود نیست.`);
      const db = await this._companyDB(code);
      const state = await this._get("catalog", info.table);
      const metas = blocksOf(state);
      if (!metas.length) {
        // متادیتا نیست: اگر بلوکی هست، یک‌بار بازسازی کن
        if (state?.storageMode === "blocks") {
          const recovered = await this._realTipBlocks(info, state, db);
          return this._getRowsBlocks(db, info, schema, afterId, limit, blocksOf(recovered));
        }
        return [];
      }
      return this._getRowsBlocks(db, info, schema, afterId, limit, metas);
    }
    async _getRowsBlocks(db, info, schema, afterId, limit, metas) {
      // انتخاب بلوک‌های لازم بر اساس lastId
      const usable = metas.filter(m => Number(m.lastId) > afterId);
      const chosen = [];
      let needed = limit;
      for (let i = 0; i < usable.length; i++) {
        chosen.push(Number(usable[i].n));
        if (i > 0) {
          needed -= Number(usable[i].count) || 0;
          if (needed <= 0) break;
        }
      }
      if (!chosen.length) return [];
      const tx = db.transaction(info.family, "readonly");
      const store = tx.objectStore(info.family);
      const pending = chosen.map(n => reqResult(store.get(blockKey(info, n))));
      const packedList = await Promise.all(pending);
      const out = [];
      for (let b = 0; b < chosen.length && out.length < limit; b++) {
        if (!packedList[b]) continue;
        const un = await gunzipJSON(packedList[b]);
        for (let i = 0; i < un.ids.length && out.length < limit; i++) {
          if (un.ids[i] > afterId) out.push({
            id: un.ids[i],
            values: un.rows[i]
          });
        }
      }
      return out.map(({
        id,
        values
      }) => {
        const obj = {};
        let k = 0;
        schema.columns.forEach((c, i) => {
          obj[c.name] = i === schema.idIndex ? id : values[k++];
        });
        if (info.family === "Sanad") obj.__FiscalYear = Number(info.year);
        obj.__CompanyCode = info.company;
        return obj;
      });
    }
    /* ────────────────────────────────────────────────────────────
     * خواندن tk_dic و tk_sherkat
     * ──────────────────────────────────────────────────────────── */
    async getTKdic({
      countryCode = null,
      fieldName = null
    } = {}) {
      const db = await this._publicDB();
      const all = await reqResult(db.transaction("tk_dic", "readonly").objectStore("tk_dic").getAll());
      return all.filter(r => {
        if (countryCode != null && Number(r.CountryCode) !== Number(countryCode)) return false;
        if (fieldName != null && String(r.FieldName) !== String(fieldName)) return false;
        return true;
      });
    }
    async getTKEsmSherkat({
      codeSherkat = null
    } = {}) {
      const db = await this._publicDB();
      const all = await reqResult(db.transaction("tk_sherkat", "readonly").objectStore("tk_sherkat").getAll());
      return codeSherkat == null ? all :
        all.filter(r => Number(r.CodeSherkat) === Number(codeSherkat));
    }
    /* ────────────────────────────────────────────────────────────
     * کدهای شرکت
     * ──────────────────────────────────────────────────────────── */
    async getCompanyCodes() {
      const entries = await this.getServerTables();
      return [...new Set(entries.map(e => this._tableInfo(e.table)?.company).filter(Boolean))]
        .sort((a, b) => Number(a) - Number(b));
    }
    /* ────────────────────────────────────────────────────────────
     * خلاصه شرکت
     * ──────────────────────────────────────────────────────────── */
    async getCompanySummary(companyCode) {
      const code = codeOf(companyCode);
      const tables = await this.getServerTables();
      const catalog = await this.getcatalog({
        companyCode: code
      });
      const states = new Map(catalog.map(x => [x.table, x]));
      return tables
        .map(e => ({
          ...this._tableInfo(e.table),
          serverCount: Number(e.count) || 0
        }))
        .filter(e => e.table && e.family !== "TK" && e.company === code)
        .sort((a, b) => (a.family === "Coding" ? -1 : 0) - (b.family === "Coding" ? -1 : 0) ||
          (a.year || 0) - (b.year || 0))
        .map(e => ({
          ...e,
          state: states.get(e.table) || null
        }));
    }
    /* ────────────────────────────────────────────────────────────
     * مقایسه با سرور (اختیاری، فقط آنلاین)
     * ──────────────────────────────────────────────────────────── */
    async compareServer({
      apply = true,
      companyCode = null
    } = {}) {
      return this._run(async () => {
        await this.initialize();
        const previous = await this.getServerTables();
        const oldMap = new Map(previous.map(e => [e.table.toLowerCase(), e]));
        const current = await this.webservice.discoverTables({
          signal: this._controller?.signal
        });
        const newMap = new Map(current.map(d => [d.key.toLowerCase(), d]));
        const catalog = await this.getcatalog();
        const statuses = new Map(catalog.map(s => [s.table.toLowerCase(), s]));
        const changes = [];
        for (const d of current) {
          const name = d.key;
          const info = this._tableInfo(name);
          if (!info || info.family === "TK") continue;
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
            changes.push({
              table: name,
              type,
              oldCount: old?.count ?? null,
              newCount: count,
              storedCount: localCount,
              importable: true
            });
          }
        }
        for (const old of previous) {
          if (!newMap.has(old.table.toLowerCase())) {
            const info = this._tableInfo(old.table);
            if (info && info.family !== "TK") {
              changes.push({
                table: old.table,
                type: "removed-server",
                oldCount: old.count,
                newCount: null,
                storedCount: statuses.get(old.table.toLowerCase())?.received ?? 0,
                importable: false
              });
            }
          }
        }
        await this._saveServerTables(current.map(d => ({
          table: d.key,
          count: d.value.count
        })));
        let imported = 0;
        if (apply) {
          for (const item of changes) {
            if (!item.importable) continue;
            this._checkStop();
            const info = this._tableInfo(item.table);
            const local = statuses.get(item.table.toLowerCase());
            if (local && Number.isFinite(item.newCount) && local.received > item.newCount) {
              local.refreshMode = "replace";
              await this._put("catalog", {
                ...local,
                key: item.table
              });
            }
            await this._syncOne({
              ...info,
              serverCount: item.newCount
            });
            imported++;
            this._emit("compare-progress", {
              done: imported,
              total: changes.filter(c => c.importable).length,
              table: item.table
            });
          }
        }
        return {
          changes,
          imported,
          serverTables: current.length
        };
      });
    }
    /* ────────────────────────────────────────────────────────────
     * فهرست موجودی لوکال
     * ──────────────────────────────────────────────────────────── */
    async listLocalInventory() {
      if (typeof indexedDB.databases !== "function")
        throw new Error("مرورگر از indexedDB.databases() پشتیبانی نمی‌کند.");
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
        } catch (e) {
          out.push({
            database: name,
            version: info.version ?? null,
            error: String(e.message || e),
            stores: []
          });
          continue;
        }
        const stores = [];
        for (const storeName of Array.from(db.objectStoreNames)) {
          let count = null;
          try {
            count = await reqResult(db.transaction(storeName, "readonly").objectStore(storeName).count());
          } catch (_) {
            count = null;
          }
          stores.push({
            store: storeName,
            count
          });
        }
        const version = db.version;
        db.close();
        out.push({
          database: name,
          version,
          stores
        });
      }
      out.sort((a, b) => String(a.database).localeCompare(String(b.database), "en"));
      return out;
    }
    /* ────────────────────────────────────────────────────────────
     * حذف بانک‌ها
     * ──────────────────────────────────────────────────────────── */
    async deleteLocalDatabases(names) {
      const list = [...new Set((names || []).map(String).filter(Boolean))];
      await this.close();
      const results = [];
      for (const name of list) {
        try {
          const blocked = await new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve(false);
            req.onerror = () => reject(req.error || new Error("delete failed"));
            req.onblocked = () => resolve(true);
          });
          results.push({
            database: name,
            ok: true,
            blocked
          });
        } catch (err) {
          results.push({
            database: name,
            ok: false,
            error: err.message
          });
        }
      }
      return results;
    }
    async wipeAllLocal() {
      const inv = await this.listLocalInventory();
      return this.deleteLocalDatabases(inv.map(x => x.database));
    }
  }
  root.Index_db = Index_db;
})(window);