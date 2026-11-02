/*
 * BINA DB Manager 4.2  |  BINA WebService
 * ------------------------------------------------------------------
 * کامپوننت دریافت و مدیریت اطلاعات با کامنت‌های فارسی
 * ترتیب قطعی: اول تکمیل همه tk_*، سپس ثبت Schema و دانلود coding/sanad.
 * نسخه IndexedDB داینامیک است و هیچ بانک قدیمی با تغییر حروف پاک نمی‌شود.
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
      console.log('1169696969696966' ,'dbs');
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
    console.log('1169696969696966' ,'dbs');
      let idIndex = -1;
      if (Number.isInteger(data.idIndex) && data.idIndex >= 0) {
        idIndex = data.idIndex;
      } else if (typeof data.idColumn === "string" && Array.isArray(data.columns)) {
        const wanted = data.idColumn.toLowerCase();
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


    /** فقط نام جدول‌ها را دریافت می‌کند؛ قبل از دریافت stats همه جدول‌ها، TK باید تکمیل شود. */
    async listTableNames({signal} = {}) {
      const rows = await fetchWithRetry(this._buildURL({mode: "tables"}), {
        signal, label: "tables"
      });
      if (!Array.isArray(rows)) throw new Error("mode=tables باید آرایه باشد.");
      // نام اصلی جدول در سرور حفظ می‌شود؛ ممکن است SQL Server به بزرگی حروف حساس باشد.
      return rows.filter(x => x && typeof x.table === "string" && x.table.trim())
        .map(x => ({table: x.table.trim(), count: x.count == null ? null : Number(x.count)}));
    }

    // ════════════════════════════════════════════════════════════
    // متد ۱: کشف جداول (pool موازی + retry)
    // ════════════════════════════════════════════════════════════
    async discoverTables({
      signal,
      concurrency = 6
    } = {}) {
      const limit = Math.max(1, Math.floor(Number(concurrency) || 6));

      const listData = await this.listTableNames({signal});

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
      afterId = 0,
      signal
    } = {}) {
      if (!table || typeof table !== "string") {
        throw new Error("نام جدول الزامی است.");
      }
      const size = Math.floor(Number(batchSize));
          console.log('1169696969696966' ,'dbs');
      if (!Number.isInteger(size) || size <= 0) {
        throw new Error("batchSize باید عدد صحیح مثبت باشد.");
      }

      if (!this._idIndexCache.has(table)) {
        await this._fetchStats(table, signal);
      }
      const idIndex = this._idIndexCache.get(table);

      let lastId = Number(afterId) || 0;

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
        // وب‌سرویس معمولاً آرایه برمی‌گرداند؛ برای پاسخ Object نیز ID معتبر تشخیص داده می‌شود.
        const rawId = Array.isArray(lastRow) ? lastRow[idIndex]
          : (lastRow && typeof lastRow === "object"
            ? Object.entries(lastRow).find(([k]) => k.toLowerCase() === "id")?.[1]
            : lastRow);
        const newLastId = Number(rawId);
        if (!(newLastId > lastId)) throw new Error(`data ${table}: ترتیب ID صعودی نیست (${newLastId}).`);
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
  root.BinaWebService = webservice;
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
 *   public (نسخه داینامیک) با ۵ استور اصلی و در صورت نیاز استورهای tk_*:
 *     - ServerTables : فهرست جداول سرور {key:table, count, info}
 *     - Catalog      : وضعیت/چک‌پوینت هر جدول (lastId, received, blocks, storageMode, ...)
 *     - Columns      : Schema خانواده‌ها (Coding / Sanad)
 *     - tk_dik       : ترجمه‌ها، کلید [CountryCode, FieldName]
 *     - tk_sherkat   : نام شرکت‌ها، کلید [CodeSherkat, EsmSherkat]
 *
 *   {companyCode} (نسخه داینامیک) با دقیقاً دو استور:
 *     - Coding : کلید [CompanyCode, blockNo]
 *     - Sanad  : کلید [FiscalYear, CompanyCode, blockNo]
 *     هر بلوک = Uint8Array = gzip(JSON{ids, rows})  (فقط حالت بلوکی)
 *
 *   Tajmi حذف شده است.
 *
 * قواعد کلیدی:
 *   - فقط حالت بلوکی gzip برای Coding/Sanad (حالت ردیفی/lz حذف شده).
 *   - همه tk_* پیش از هر سند/کدینگ دریافت و شمارش آنها کنترل می‌شود.
 *   - در bootstrapهای بعدی، TK موجود با تعداد سرور تطبیق داده می‌شود.
 *   - در صورت ناقص‌بودن TK، دانلود اسناد آغاز نخواهد شد.
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
  const PUBLIC_STORES = ["servertables", "catalog", "columns", "tk_dic", "tk_sherkat"];
  const DATA_STORES = ["coding", "sanad"];
  // VERSION فقط برای گزارش initialize است؛ open دیگر نسخهٔ پایین‌تر از موجود را درخواست نمی‌کند.
  // نسخه فیزیکی هر IndexedDB هنگام بازشدن از db.version خوانده می‌شود.
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

  // شناسه داخلی همیشه lowercase است؛ نام فیزیکی قدیمی دست‌نخورده می‌ماند.
  const norm = value => String(value ?? "").trim().toLowerCase();
  function physicalStore(db, wanted) {
    return Array.from(db.objectStoreNames).find(x => norm(x) === norm(wanted)) || wanted;
  }
  function existingDbName(names) {
    return indexedDB.databases ? indexedDB.databases().then(list => {
      const found = list.map(x => x.name);
      // اگر Public قدیمی وجود دارد آن را باز کن؛ ایجاد public جدید باعث پنهان شدن اطلاعات نشود.
      return names.find(n => found.includes(n)) || names[names.length-1];
    }) : Promise.resolve(names[0]);
  }
  function canonicalTable(value) { return norm(value); }

  /** ساخت استورهای ناقص در رویداد upgrade */
  function ensureStores(db, stores) {
    for (const [storeName, keyPath] of stores) {
      if (!Array.from(db.objectStoreNames).some(x => norm(x) === norm(storeName))) {
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
      console.log('11114444444111' ,'dbs');
      probe.onerror = () => bad(probe.error || new Error(`Cannot open ${name}`));
      probe.onblocked = () =>
        bad(new Error(`بانک ${name} در تب دیگری باز است؛ آن تب را ببندید.`));
      probe.onupgradeneeded = () => {
        // بانک تازه (نسخهٔ پیش‌فرض 1)
        ensureStores(probe.result, stores);
      };
      probe.onsuccess = () => {
        const db = probe.result;
        const missing = stores.filter(([s]) => !Array.from(db.objectStoreNames).some(x => norm(x) === norm(s)));
        if (!missing.length) {
          db.onversionchange = () => db.close();
          ok(db);
          return;
        }
        // استور کم است → upgrade به version فعلی + 1
        const nextVer = db.version + 1;
        db.close();
        const up = indexedDB.open(name, nextVer);
          console.log('1112222211111' ,up);
        up.onerror = () =>
          bad(up.error || new Error(`Cannot upgrade ${name} to v${nextVer}`));
        up.onblocked = () =>
          bad(new Error(`بانک ${name} در تب دیگری باز است؛ آن تب را ببندید.`));
        up.onupgradeneeded = () => ensureStores(up.result, stores);
        up.onsuccess = () => {
          const d = up.result;
          const still = stores.filter(([s]) => !Array.from(d.objectStoreNames).some(x => norm(x) === norm(s)));
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
    const prefix = info.family === "sanad" ? [info.year, info.company] : [info.company];
    return IDBKeyRange.bound([...prefix, Math.max(0, after + 1)], [...prefix, MAX_ID]);
  }

  function fullRange(info) {
    return keyRange(info, -1);
  }

  function blockKey(info, blockNo) {
    return info.family === "sanad" ? [info.year, info.company, blockNo] : [info.company, blockNo];
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
     * @param {number}     [options.batchSize=15000]    اندازه بچ دریافت از سرور
     * @param {number}     [options.minYear=1350]
     * @param {number}     [options.maxYear=1420]
     */
    constructor(options = {}) {
      if (!options.webservice || typeof options.webservice.fetchTable !== "function")
        throw new Error("webservice الزامی است (نمونه‌ای از کلاس webservice).");
      this.webservice = options.webservice;
      this.blockSize = Math.min(50000, Math.max(500, Math.floor(Number(options.blockSize) || 10000)));
      this.batchSize = Math.min(50000, Math.max(1, Math.floor(Number(options.batchSize) || 15000)));
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
      // فقط در همین نشست کش می‌شود؛ داده پایه هر بار پیش از دانلود بررسی می‌گردد.
      this._tkReady = false;
      this._tkSummary = {tables:[], tkdik:0, tkSherkat:0};
      this._persistenceInitialized = false;
      this._persistenceState = false;
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
    /**
     * درخواست ماندگاری حداکثری، فقط با API استاندارد مرورگر.
     * درخواست پذیرش ممکن است رد شود؛ در آن صورت دیتابیس همچنان کار می‌کند.
     * این متد هیچ دیتایی را پاک یا بازسازی نمی‌کند.
     */
    async requestPersistence() {
      const storage = navigator.storage;
      if (!storage?.persist || !storage?.persisted) {
        return {supported:false, persisted:false, reason:"مرورگر از Persistent Storage پشتیبانی نمی‌کند."};
      }
      try {
        let persisted = await storage.persisted();
        if (!persisted) {
          await storage.persist();
          persisted = await storage.persisted(); // همیشه نتیجه واقعی را دوباره می‌خوانیم.
        }
        const usage = storage.estimate ? await storage.estimate() : {};
        return {
          supported:true, persisted:!!persisted,
          usageMB: ((usage.usage || 0)/1048576).toFixed(2),
          quotaMB: ((usage.quota || 0)/1048576).toFixed(2)
        };
      } catch (error) {
        return {supported:true, persisted:false, error:String(error.message || error)};
      }
    }

    /** امضای قدیمی برای سازگاری تمام بخش‌های برنامه حفظ شده است. */
    async _requestPersistence() {
      // درخواست خودکار فقط یک بار در هر نشست: جلوگیری از درخواست‌های تکراری در فیلترها.
      if (this._persistenceInitialized) return this._persistenceState;
      const result = await this.requestPersistence();
      this._persistenceInitialized = true;
      this._persistenceState = !!result.persisted;
      return this._persistenceState;
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
      const physical = await existingDbName(["Public", "public"]);
      const db = await openDB(physical, PUBLIC_STORES.map(s => [s, "key"]));
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
        version: (await this._publicDB()).version,
        persisted
      };
    }

    /* ────────────────────────────────────────────────────────────
     * ابزار پایه Public
     * ──────────────────────────────────────────────────────────── */
    async _get(store, key) {
      const db = await this._publicDB();
      const real = physicalStore(db, store);
      let found = await reqResult(db.transaction(real, "readonly").objectStore(real).get(key));
      if (found !== undefined) return found;
      // سازگاری با رکوردهایی که در نسخه‌های قدیمی با حروف بزرگ ثبت شده‌اند.
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
        ? { ...item, key: norm(item.key), ...(item.table ? {table:canonicalTable(item.table)} : {}) }
        : item;
      tx.objectStore(real).put(value);
      await done;
    }

    /* ────────────────────────────────────────────────────────────
     * تشخیص نوع جدول
     * ──────────────────────────────────────────────────────────── */
    _tableInfo(table) {
      const original = String(table || "").trim();
      const name = canonicalTable(original);
      let m = /^coding_(\d+)$/i.exec(name);
      if (m) return {
        table: name,
        sourceTable: original,
        company: m[1],
        family: "coding",
        year: null
      };
      m = /^sanad_(\d{4})_(\d+)$/i.exec(name);
      if (m && Number(m[1]) >= this.minYear && Number(m[1]) <= this.maxYear)
        return {
          table: name,
          sourceTable: original,
          company: m[2],
          family: "sanad",
          year: Number(m[1])
        };
      if (/^tk_/i.test(name)) return {
        table: name,
        sourceTable: original,
        company: null,
        family: "tk",
        year: null
      };
      return null;
    }

    /* ────────────────────────────────────────────────────────────
     * ServerTables
     * ──────────────────────────────────────────────────────────── */
    async getServerTables() {
      const db = await this._publicDB();
      const real = physicalStore(db, "servertables");
      const records = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      const merged = new Map();
      for (const x of records) {
        const canonical = canonicalTable(x.table || x.key);
        const prev = merged.get(canonical);
        const row = { ...(x.info || {}), table: canonical,
          sourceTable: x.sourceTable || x.info?.sourceTable || x.table || x.key,
          count: x.count ?? null };
        if (!prev || String(x.key) === canonical) merged.set(canonical, row);
      }
      return [...merged.values()];
    }

    async _saveServerTables(rows) {
      if (!Array.isArray(rows)) throw new Error("mode=tables باید آرایه باشد.");
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        if (!row || typeof row.table !== "string" || !row.table.trim()) continue;
        const canonical = canonicalTable(row.table);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        entries.push({
          key: canonical,
          table: canonical,
          sourceTable: row.sourceTable || row.table,
          count: row.count == null ? null : Number(row.count),
          info: this._tableInfo(canonical),
          fetchedAt: new Date().toISOString()
        });
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

    /* ────────────────────────────────────────────────────────────
     * Columns (Schema)
     * ──────────────────────────────────────────────────────────── */
    async getColumns(family) {
      return this._get("columns", norm(family));
    }

    async _saveSchemaFromStats(stats) {
      const info = this._tableInfo(stats.table);
      if (!info || info.family === "tk") return null;
      const columns = stats.columns.map(c => ({
        // نام فیلدها در Schema داخلی کوچک؛ ترتیب و نوع عین سرور حفظ می‌شود.
        name: norm(c.name),
        type: String(c.type || "").toLowerCase()
      }));
      let idIndex = Number.isInteger(stats.idIndex) ? stats.idIndex :
        columns.findIndex(c => c.name.toLowerCase() === String(stats.idColumn || "id").toLowerCase());
      if (idIndex < 0) idIndex = columns.findIndex(c => c.name.toLowerCase() === "id");
      if (idIndex < 0) throw new Error(`ستون Id در Schema ${stats.table} پیدا نشد.`);
      const schema = {
        key: norm(info.family),
        columns,
        idIndex,
        idColumn: norm(stats.idColumn || columns[idIndex].name),
        sourceTable: stats.table,
        fetchedAt: new Date().toISOString()
      };
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

    /* ────────────────────────────────────────────────────────────
     * Catalog
     * ──────────────────────────────────────────────────────────── */
    async getCatalog({
      companyCode = null
    } = {}) {
      const db = await this._publicDB();
      const real = physicalStore(db, "catalog");
      const all = await reqResult(db.transaction(real, "readonly").objectStore(real).getAll());
      const merged = new Map();
      for (const row of all) {
        const key = canonicalTable(row.table || row.key);
        const prev = merged.get(key);
        const candidate = {...row, key, table:key, family:norm(row.family)};
        if (!prev || Number(candidate.received || 0) > Number(prev.received || 0) ||
          (candidate.finished && !prev.finished && candidate.received === prev.received)) merged.set(key,candidate);
      }
      const rows = [...merged.values()];
      return companyCode == null ? rows : rows.filter(x => x.company === codeOf(companyCode));
    }

    /* ────────────────────────────────────────────────────────────
     * بازیابی چک‌پوینت واقعی (blocks mode)
     * ──────────────────────────────────────────────────────────── */
    async _actualBlockNos(db, info) {
      const out = [];
      await new Promise((ok, bad) => {
        const rq = db.transaction(physicalStore(db, info.family), "readonly").objectStore(physicalStore(db, info.family))
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
      const cur = await reqResult(db.transaction(physicalStore(db, info.family), "readonly")
        .objectStore(physicalStore(db, info.family)).openKeyCursor(fullRange(info), "prev"));
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
          const packed = await reqResult(db.transaction(physicalStore(db, info.family), "readonly")
            .objectStore(physicalStore(db, info.family)).get(blockKey(info, n)));
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
      await this._put("Catalog", {
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
      const tx = db.transaction([physicalStore(db, info.family)], "readwrite");
      const done = txResult(tx);
      tx.objectStore(physicalStore(db, info.family)).delete(fullRange(info));
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
      // حتی فراخوانی مستقیم این متد نباید بتواند TK را دور بزند.
      await this._ensureBaseData();
      this._checkStop();
      const db = await this._companyDB(info.company);
      const schema = await this._schema(info);

      let state = await this._get("Catalog", info.table);
      if (state && state.storageMode !== "blocks") {
        throw new Error(`${info.table}: فرمت قبلی ${state.storageMode} با GZIP بلوکی سازگار نیست؛ اطلاعات قبلی بدون اجازه پاک نمی‌شوند.`);
      }
      if (state && state.refreshMode === "replace") {
        this._emit("table-reset", {
          table: info.table,
          reason: "replace"
        });
        await this._clearTable(db, info);
        state = {
          ...blankState(info, state.serverCount || 0),
          key: info.table
        };
        await this._put("Catalog", state);
      }
      if (!state) {
        state = {
          ...blankState(info, info.serverCount || 0),
          key: info.table
        };
        await this._put("Catalog", state);
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
          const packed = await reqResult(db.transaction(physicalStore(db, info.family), "readonly")
            .objectStore(physicalStore(db, info.family)).get(blockKey(info, Number(last0.n))));
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
        table: info.sourceTable || info.table,
        batchSize: this.batchSize,
        afterId: state.lastId,
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
        const tx = db.transaction([physicalStore(db, info.family)], "readwrite");
        const done = txResult(tx);
        const ds = tx.objectStore(physicalStore(db, info.family));
        for (let j = 0; j < jobs.length; j++) ds.put(packedList[j], blockKey(info, jobs[j].n));
        await done;

        // به‌روزرسانی متادیتای Catalog.blocks
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
        await this._put("Catalog", {
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
      await this._put("Catalog", {
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
     * اطلاعات پایه: همه جدول‌های tk_* باید قبل از Coding/Sanad دریافت شوند.
     * در Public فقط دو Schema عمومی coding/sanad وجود دارد؛ TK Schema اضافی نمی‌سازد.
     * دو جدول شناخته‌شده، نام Store کوتاه دارند؛ سایر tk_*ها Store مستقل lowercase می‌گیرند.
     * اطلاعات قدیمی Public و Storeهای CamelCase بدون تغییر نام فیزیکی خوانده می‌شوند.
     * ──────────────────────────────────────────────────────────── */
    _tkStoreName(table) {
      const id = canonicalTable(table);
      if (id === "tk_dic_fieldname" || id === "tk_dic") return "tk_dic";
      if (id === "tk_esmsherkatholding" || id === "tk_sherkat") return "tk_sherkat";
      return id;
    }

    /** در صورت ضرورت فقط Store خالی اضافه می‌شود؛ نسخه به طور داینامیک ارتقا می‌یابد. */
    async _ensureTKStores(tables) {
      const db = await this._publicDB();
      const wanted = [...new Set(tables.map(t => this._tkStoreName(t.table)))];
      const missing = wanted.filter(name => !Array.from(db.objectStoreNames).some(s => norm(s) === name));
      if (!missing.length) return db;
      const name = db.name;
      db.close();
      this._public = null;
      // openDB ابتدا نسخه موجود را کشف کرده و فقط در نبود Store ارتقا می‌دهد.
      const newDb = await openDB(name,[...PUBLIC_STORES.map(s=>[s,"key"]),...wanted.map(s=>[s,"key"])]);
      newDb.onversionchange = () => { newDb.close(); if (this._public === newDb) this._public = null; };
      this._public = newDb;
      return newDb;
    }

    /**
     * دریافت یک جدول پایه، در بچ‌های کوچک و تراکنش‌های کوتاه.
     * اگر ردیف‌ها ناقص باشند یا شمارش با سرور متفاوت باشد خطا می‌دهد.
     * هر ردیف با کلید ID به‌روز می‌شود؛ هیچ clear() خودکاری وجود ندارد.
     */
    async _fetchTK(storeName, tableName, expectedCount = null) {
      this._checkStop();
      const stats = await this.webservice._fetchStats(tableName, this._controller?.signal);
      const declared = Number.isFinite(Number(expectedCount)) && expectedCount != null
        ? Number(expectedCount) : Number(stats.count);
      const db = await this._publicDB();
      const real = physicalStore(db,storeName);
      const existingCount = await reqResult(db.transaction(real,"readonly").objectStore(real).count());
      const tableKey = canonicalTable(tableName);
      if (existingCount === declared && Number.isFinite(declared)) {
        // رکوردهای قدیمی کامل هستند؛ فقط متادیتا را بدون دستکاری داده به‌روز می‌کنیم.
        await this._put("catalog",{
          key:tableKey,table:tableKey,family:"tk",storageMode:"rows",
          received:existingCount,serverCount:declared,finished:true,
          sourceTable:tableName,updatedAt:new Date().toISOString()
        });
        this._emit("tk-skip",{store:storeName,table:tableKey,count:existingCount});
        return existingCount;
      }
      if (existingCount > declared && Number.isFinite(declared)) {
        throw new Error(`جدول پایه ${tableKey}: تعداد لوکال ${existingCount} از سرور ${declared} بیشتر است؛ حذف خودکار مجاز نیست.`);
      }
      const columns = stats.columns.map(c=>String(c.name));
      const index = stats.idIndex;
      if (!(index>=0 && index<columns.length)) throw new Error(`${tableKey}: ستون id معتبر نیست.`);
      let received = 0;
      const iterator = this.webservice.fetchTable({table:tableName,batchSize:2000,afterId:0,signal:this._controller?.signal});
      for await (const pack of iterator) {
        this._checkStop();
        const batch = pack.rows;
        const tx = db.transaction(real,"readwrite"), done = txResult(tx), store=tx.objectStore(real);
        // در بانک جدید keyPath='key' است. بانک قدیمی ممکن است keyPath مرکب یا out-of-line داشته باشد؛
        // تغییر ساختار/حذف استور ممنوع است، پس نوشتن با keyPath موجود سازگار می‌شود.
        const keyPath = store.keyPath;
        for (const row of batch) {
          const keyMap = Array.isArray(row) ? null : new Map(Object.keys(row).map(k=>[norm(k),k]));
          const valueAt = i => Array.isArray(row) ? row[i] : row[keyMap.get(norm(columns[i]))];
          const id = numericID(valueAt(index),tableKey);
          const value = {key:id};
          for (let i=0;i<columns.length;i++) value[norm(columns[i])] = valueAt(i);
          const oldKeyFields = Array.isArray(keyPath) ? keyPath : (keyPath && keyPath!=="key" ? [keyPath]:[]);
          // فقط برای سازگاری فیزیکی با Store قدیمی، نام دقیق ستون کلید قدیمی حفظ می‌شود.
          for(const required of oldKeyFields){
            const matching=Object.keys(value).find(k=>norm(k)===norm(required));
            if(matching===undefined){
              if(norm(required)==="key")value[required]=id;
              else throw new Error(`کلید قدیمی ${required} در جدول ${tableKey} وجود ندارد؛ داده حذف نمی‌شود.`);
            }else value[required]=value[matching];
          }
          if(keyPath===null)store.put(value,id);else store.put(value);
        }
        await done;
        received += batch.length;
        this._emit("tk-chunk",{table:tableKey,store:storeName,received});
        await yieldUI();
      }
      const actual = await reqResult(db.transaction(real,"readonly").objectStore(real).count());
      if (Number.isFinite(declared) && actual !== declared) {
        throw new Error(`جدول پایه ${tableKey} ناقص است: سرور=${declared}، لوکال=${actual}. سند/کدینگ متوقف شد.`);
      }
      // متادیتای کم‌حجم TK (نه Schema جدید) برای SQL Runner و گزارش‌گیری.
      await this._put("catalog",{
        key:tableKey, table:tableKey, family:"tk", storageMode:"rows",
        received:actual, serverCount:declared, finished:true,
        sourceTable:tableName, updatedAt:new Date().toISOString()
      });
      this._emit("tk-loaded",{store:storeName,table:tableKey,count:actual});
      return actual;
    }

    /**
     * درگاه اجباری: همه مسیرهای دانلود از این متد عبور می‌کنند.
     * ابتدا نام‌های mode=tables کشف می‌شوند؛ سپس تمام tk_*ها تکمیل می‌شوند.
     * فقط بعد از موفقیت می‌توان stats جدول‌های سند/کدینگ را دریافت کرد.
     */
    async _ensureBaseData({sourceList=null} = {}) {
      if (this._tkReady) return this._tkSummary;
      let list = sourceList;
      if (!list) {
        const cached = await this.getServerTables();
        const tk = cached.filter(x => /^tk_/i.test(x.table));
        // در صورت داشتن فهرست قدیمی فاقد TK، فهرست از خود سرور گرفته می‌شود.
        list = tk.length ? tk.map(x=>({table:x.sourceTable || x.table,count:x.count}))
          : await this.webservice.listTableNames({signal:this._controller?.signal});
      }
      const tkTables = new Map();
      for (const row of list) {
        const name = String(row.table||"").trim();
        if (/^tk_/i.test(name)) tkTables.set(canonicalTable(name),{table:name,count:row.count});
      }
      // بعضی نسخه‌های سرویس TK را در mode=tables فهرست نمی‌کنند،
      // اما با آدرس مستقیم stats/data در دسترس هستند. پس دو جدول ضروری را
      // با نام واقعی سازگار با سرویس قدیمی به مجموعه اضافه می‌کنیم.
      const knownTK = ["TK_Dic_FieldName", "tk_EsmSherkatHolding"];
      for (const name of knownTK) {
        if (!tkTables.has(canonicalTable(name))) {
          tkTables.set(canonicalTable(name),{table:name,count:null});
        }
      }
      // اگر آدرس مستقیم جدول ضروری هم خطا بدهد، _fetchTK خطا را به بیرون منتقل می‌کند
      // و اجازه آغاز هیچ بارگذاری Coding/Sanad داده نمی‌شود.
      const ordered = [...tkTables.values()].sort((a,b)=>a.table.localeCompare(b.table,"en"));
      await this._ensureTKStores(ordered);
      this._emit("tk-start",{total:ordered.length});
      const summary={tables:[],tkdik:0,tkSherkat:0};
      for (const row of ordered) {
        const storeName=this._tkStoreName(row.table);
        const count=await this._fetchTK(storeName,row.table,row.count);
        const name=canonicalTable(row.table);
        summary.tables.push({table:name,store:storeName,count});
        if (storeName==="tk_dic")summary.tkdik=count;
        if (storeName==="tk_sherkat")summary.tkSherkat=count;
      }
      this._tkReady=true;
      this._tkSummary=summary;
      this._emit("tk-done",{total:ordered.length});
      return summary;
    }

    /* ────────────────────────────────────────────────────────────
     * راه‌اندازی اولیه: ابتدا TK، سپس فقط فهرست و دو Schema مشترک.
     * دانلود سند و کدینگ در bootstrap ممنوع است.
     * ──────────────────────────────────────────────────────────── */
    async bootstrap() {
      return this._run(async () => {
        await this.initialize();
        const localTables=await this.getServerTables();
        const isFirstRun=localTables.length===0;
        // نخستین دریافت داده واقعی همیشه TK است (پس از دریافت فهرست نام‌ها).
        const names = isFirstRun ? await this.webservice.listTableNames({signal:this._controller?.signal}) : null;
        const base=await this._ensureBaseData({sourceList:names});
        let discovered=0;
        if (isFirstRun) {
          this._emit("bootstrap-online",{});
          const result=await this.webservice.discoverTables({signal:this._controller?.signal});
          await this._saveServerTables(result.map(d=>({table:d.key,count:d.value.count})));
          discovered=result.length;
          // بر اساس تصریح کاربر فقط دو تعریف برای همه coding و همه sanad نگهداری می‌شود.
          await this._updateSharedSchemas(result);
        } else {
          await this._ensureSchemasFromCachedTables();
        }
        this._emit("bootstrap-done",{firstRun:isFirstRun,discovered,tkdik:base.tkdik,tkSherkat:base.tkSherkat});
        return {firstRun:isFirstRun,discovered,tkdik:base.tkdik,tkSherkat:base.tkSherkat,tkTables:base.tables};
      });
    }

    /** Schema موجود را بی‌دلیل بازنویسی نکن؛ فقط دو خانواده، با ساختار ثابت. */
    async _updateSharedSchemas(discovered=[]) {
      for (const family of ["coding","sanad"]) {
        if (await this.getColumns(family)) continue;
        const row=discovered.find(x=>this._tableInfo(x.key)?.family===family);
        if(!row)throw new Error(`هیچ جدول ${family} برای تشخیص Schema وجود ندارد.`);
        const stats=await this.webservice._fetchStats(row.key,this._controller?.signal);
        await this._saveSchemaFromStats({...stats,table:row.key});
      }
    }

    /** برای بانک قبلی که ServerTables دارد اما Schema ناقص است. */
    async _ensureSchemasFromCachedTables() {
      const tables=await this.getServerTables();
      for(const family of ["coding","sanad"]){
        if (await this.getColumns(family)) continue;
        const entry=tables.find(x=>this._tableInfo(x.table)?.family===family);
        if(!entry)throw new Error(`Schema خانواده ${family} موجود نیست و نمونه سرور پیدا نشد.`);
        const src=entry.sourceTable||entry.table;
        const stats=await this.webservice._fetchStats(src,this._controller?.signal);
        await this._saveSchemaFromStats({...stats,table:entry.table});
      }
    }

    /** بروزرسانی: اول TK، سپس فهرست و Schema مشترک؛ داده‌های اسناد دست‌نخورده. */
    async refreshServerTables() {
      return this._run(async()=>{
        await this.initialize();
        this._emit("refresh-start",{});
        const names=await this.webservice.listTableNames({signal:this._controller?.signal});
        this._tkReady=false; // احتمال اضافه‌شدن جدول پایه جدید در سرور
        const base=await this._ensureBaseData({sourceList:names});
        const result=await this.webservice.discoverTables({signal:this._controller?.signal});
        await this._saveServerTables(result.map(d=>({table:d.key,count:d.value.count})));
        await this._updateSharedSchemas(result);
        this._emit("refresh-done",{total:result.length,tkTables:base.tables.length});
        return {total:result.length,tkTables:base.tables.length};
      });
    }

    /* ────────────────────────────────────────────────────────────
     * getTableList: لیست جداول Coding/Sanad با وضعیت لوکال
     * ──────────────────────────────────────────────────────────── */
    async getTableList({ companyCode = null, family = null, status = null } = {}) {
      await this.initialize();
      const tables = await this.getServerTables();
      const catalog = await this.getCatalog();
      const states = new Map(catalog.map(s => [s.table.toLowerCase(), s]));
      const codeFilter = companyCode ? codeOf(companyCode) : null;

      const rows = [];
      for (const entry of tables) {
        const info = this._tableInfo(entry.table);
        if (!info || info.family === "tk") continue;
        if (codeFilter && info.company !== codeFilter) continue;
        if (family && info.family !== norm(family)) continue;

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
        (a.family === "coding" ? -1 : 0) - (b.family === "coding" ? -1 : 0) ||
        (a.year || 0) - (b.year || 0)
      );
      return rows;
    }

    /* ────────────────────────────────────────────────────────────
     * syncTables: فقط جداول انتخاب‌شده را دانلود/تکمیل کن
     * ──────────────────────────────────────────────────────────── */
    async syncTables(tableNames) {
      const names = [...new Set((tableNames || []).map(canonicalTable).filter(Boolean))];
      if (!names.length) throw new Error("هیچ جدولی انتخاب نشده است.");
      return this._run(async () => {
        await this.initialize();
        await this._ensureBaseData();
        const tables = await this.getServerTables();
        const map = new Map(tables.map(t => [t.table.toLowerCase(), t]));
        let done = 0;
        for (const name of names) {
          this._checkStop();
          const src = map.get(name.toLowerCase());
          if (!src) { this._emit("table-missing", { table: name }); continue; }
          const info = this._tableInfo(src.table);
          if (!info || info.family === "tk") continue;
          info.sourceTable = src.sourceTable || src.table;
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
        await this._ensureBaseData();
        const tables = await this.getServerTables();
        const jobs = tables
          .map(e => ({
            ...this._tableInfo(e.table),
            sourceTable: e.sourceTable || e.table,
            serverCount: Number(e.count) || 0
          }))
          .filter(e => e.table && e.family !== "tk" &&
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
        await this._ensureBaseData();
        const info = this._tableInfo(tableName);
        if (!info || info.family === "tk") throw new Error("جدول Coding/Sanad معتبر نیست.");
        const tables = await this.getServerTables();
        const src = tables.find(x => x.table.toLowerCase() === info.table.toLowerCase());
        if (!src) throw new Error("جدول در ServerTables نیست.");
        info.sourceTable = src.sourceTable || src.table;
        if (replace) {
          const st = await this._get("Catalog", info.table);
          if (st) await this._put("Catalog", {
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
      family = "sanad",
      year = null,
      afterId = -1,
      limit = 50
    } = {}) {
      const code = codeOf(companyCode);
      family = norm(family);
      if(!DATA_STORES.includes(family)) throw new Error("family باید coding یا sanad باشد.");
      if (!DATA_STORES.includes(norm(family))) throw new Error("family باید Coding یا Sanad باشد.");
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit باید 1..1000 باشد.");
      if (!Number.isSafeInteger(afterId) || afterId < -1) throw new Error("afterId نامعتبر است.");
      if (family === "sanad" && (!Number.isInteger(Number(year)) ||
          Number(year) < this.minYear || Number(year) > this.maxYear))
        throw new Error(`سال مالی برای Sanad الزامی است (${this.minYear} تا ${this.maxYear}).`);

      const info = {
        company: code,
        family,
        year: family === "coding" ? null : Number(year),
        table: family === "sanad" ? `sanad_${Number(year)}_${code}` : `coding_${code}`
      };
      const schema = await this.getColumns(family);
      if (!schema) throw new Error(`Schema ${family} موجود نیست.`);
      const db = await this._companyDB(code);
      const state = await this._get("Catalog", info.table);
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

      const tx = db.transaction(physicalStore(db, info.family), "readonly");
      const store = tx.objectStore(physicalStore(db, info.family));
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
        if (info.family === "sanad") obj.__FiscalYear = Number(info.year);
        obj.__CompanyCode = info.company;
        return obj;
      });
    }

    /* ────────────────────────────────────────────────────────────
     * خواندن tk_dik و tk_sherkat
     * ──────────────────────────────────────────────────────────── */
    async getTKdik({ countryCode=null, fieldName=null }={}) {
      const db=await this._publicDB(),real=physicalStore(db,"tk_dic");
      const all=await reqResult(db.transaction(real,"readonly").objectStore(real).getAll());
      return all.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[norm(k),v])))
        .filter(r=>(countryCode==null||Number(r.countrycode)===Number(countryCode)) &&
          (fieldName==null||String(r.fieldname)===String(fieldName)));
    }

    async getTKEsmSherkat({codeSherkat=null}={}) {
      const db=await this._publicDB(),real=physicalStore(db,"tk_sherkat");
      const all=await reqResult(db.transaction(real,"readonly").objectStore(real).getAll());
      return all.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[norm(k),v])))
        .filter(r=>codeSherkat==null||Number(r.codesherkat)===Number(codeSherkat));
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
      const catalog = await this.getCatalog({
        companyCode: code
      });
      const states = new Map(catalog.map(x => [canonicalTable(x.table), x]));
      return tables
        .map(e => ({
          ...this._tableInfo(e.table),
          serverCount: Number(e.count) || 0
        }))
        .filter(e => e.table && e.family !== "tk" && e.company === code)
        .sort((a, b) => (a.family === "coding" ? -1 : 0) - (b.family === "coding" ? -1 : 0) ||
          (a.year || 0) - (b.year || 0))
        .map(e => ({
          ...e,
          state: states.get(canonicalTable(e.table)) || null
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
        // compareServer نیز نباید پیش از تکمیل اطلاعات پایه به سراغ جدول‌های مالی برود.
        await this._ensureBaseData();
        const previous = await this.getServerTables();
        const oldMap = new Map(previous.map(e => [e.table.toLowerCase(), e]));
        const current = await this.webservice.discoverTables({
          signal: this._controller?.signal
        });
        const newMap = new Map(current.map(d => [d.key.toLowerCase(), d]));
        const catalog = await this.getCatalog();
        const statuses = new Map(catalog.map(s => [s.table.toLowerCase(), s]));
        const changes = [];

        for (const d of current) {
          const name = d.key;
          const info = this._tableInfo(src.table);
          if (!info || info.family === "tk") continue;
          info.sourceTable = src.sourceTable || src.table;
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
            if (info && info.family !== "tk") {
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
            info.sourceTable = current.find(x => norm(x.key)===norm(item.table))?.key || item.table;
            const local = statuses.get(item.table.toLowerCase());
            if (local && Number.isFinite(item.newCount) && local.received > item.newCount) {
              // کاهش تعداد سرور به معنی احتمال حذف/ویرایش رکورد است.
              // بازنویسی خودکار و تخریبی ممنوع؛ فقط علامت نیاز به بازسازی.
              local.needsRefresh = true;
              local.error = "کاهش تعداد سرور؛ بازنویسی فقط با دستور صریح syncTable({replace:true})";
              await this._put("Catalog", {...local,key: item.table});
              continue;
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
      console.log('1111111111111' ,dbs);
      
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

    /**
     * بررسی و پاکسازی اختیاری کلیدهای metadata حروف‌بزرگ.
     * dryRun=true: هیچ تغییری ایجاد نمی‌شود.
     * در برخورد دو رکورد متناقض عملیات آن کلید متوقف می‌شود؛ هرگز داده اصلی شرکت‌ها پاک نمی‌شود.
     */
    async normalizeMetadata({dryRun = true} = {}) {
      const db = await this._publicDB();
      const report = {dryRun, scanned:0, renamed:0, duplicates:0, conflicts:[], stores:[]};
      for (const logical of ["servertables","catalog","columns"]) {
        const real = physicalStore(db,logical);
        const entries = await reqResult(db.transaction(real,"readonly").objectStore(real).getAll());
        const groups=new Map();
        for(const row of entries){
          const k=norm(row.key); if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);
        }
        const changes=[];
        for(const [key,rows] of groups){
          report.scanned+=rows.length;
          const comparable=rows.map(r=>{
            const x={...r,key}; if(x.table)x.table=norm(x.table);
            delete x.updatedAt;delete x.fetchedAt;return JSON.stringify(x);
          });
          if(new Set(comparable).size>1){
            report.conflicts.push({store:logical,key,keys:rows.map(x=>x.key)});continue;
          }
          if(rows.length>1)report.duplicates+=rows.length-1;
          if(rows.length>1 || rows[0].key!==key)changes.push({key,rows,chosen:{...rows[0],key,...(rows[0].table?{table:norm(rows[0].table)}:{})}});
        }
        report.stores.push({store:logical,changes:changes.length});
        report.renamed+=changes.length;
        if(dryRun||!changes.length)continue;
        const tx=db.transaction(real,"readwrite"),done=txResult(tx),store=tx.objectStore(real);
        for(const ch of changes){for(const row of ch.rows)store.delete(row.key);store.put(ch.chosen);}
        await done;
      }
      return report;
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
          console.log('11110976661=-=-=' ,'dbs');
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
  root.BinaDBManager = Index_db;
})(window);