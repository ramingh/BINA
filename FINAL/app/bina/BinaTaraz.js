/* =========================================
 Taraz.js — همهٔ کد صفحهٔ تراز در یک فایل
 بخش‌ها: BinaDBManager → DataDecompressor → BinaReportEngine → UI (Drill-down)
 =========================================
'use strict';

/* ============================ BinaDBManager ============================ */
/**
 * BINA Database Manager
 * نسخه: 1.0.0
 * 
 * مسئولیت:
 * - مدیریت اتصال به دیتابیس‌های IndexedDB (public + شرکت‌ها)
 * - خواندن Schema از public/columns
 * - استخراج هدفمند بلوک‌های فشرده بر اساس CompanyCode و FiscalYear
 */

class BinaDBManager {
  constructor(options = {}) {
    this.publicDbName = options.publicDbName || 'public';
    this.databases = new Map(); // کش دیتابیس‌های باز شده
    this.logger = options.logger || console;
  }

  /**
   * باز کردن دیتابیس public
   * @returns {Promise<IDBDatabase>}
   */
  async openPublicDb() {
    if (this.databases.has(this.publicDbName)) {
      return this.databases.get(this.publicDbName);
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.publicDbName);

      request.onsuccess = (event) => {
        const db = event.target.result;
        this.databases.set(this.publicDbName, db);
        resolve(db);
      };

      request.onerror = (event) => {
        reject(new Error(`خطا در باز کردن دیتابیس public: ${event.target.error}`));
      };
    });
  }

  /**
   * باز کردن دیتابیس شرکت
   * @param {string|number} companyCode - کد شرکت (مثلاً '1100')
   * @returns {Promise<IDBDatabase>}
   */
  async openCompanyDb(companyCode) {
    const dbName = String(companyCode);

    if (this.databases.has(dbName)) {
      return this.databases.get(dbName);
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);

      request.onsuccess = (event) => {
        const db = event.target.result;
        this.databases.set(dbName, db);
        resolve(db);
      };

      request.onerror = (event) => {
        reject(new Error(`خطا در باز کردن دیتابیس ${dbName}: ${event.target.error}`));
      };
    });
  }

  /**
   * خواندن ستون‌ها از public/columns
   * @param {string} family - 'sanad' یا 'coding'
   * @returns {Promise<Array<{name: string, type: string}>>}
   */
  async getColumns(family) {
    const db = await this.openPublicDb();
    const storeName = 'columns';

    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`استور ${storeName} در دیتابیس public وجود ندارد.`);
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(family.toLowerCase());

      request.onsuccess = () => {
        const record = request.result;

        if (!record || !record.columns) {
          reject(new Error(`ستون‌های ${family} در public/columns یافت نشد.`));
          return;
        }

        // نرمال‌سازی ستون‌ها
        const columns = record.columns.map((col, index) => ({
          name: col.name || col.Name,
          type: col.type || col.Type || 'string',
          ordinal: col.ordinal || col.OrdinalPosition || index
        }));

        resolve(columns);
      };

      request.onerror = (event) => {
        reject(new Error(`خطا در خواندن ستون‌ها: ${event.target.error}`));
      };
    });
  }

  /**
   * خواندن لیست شرکت‌ها از Public/TK_sherkat
   * @returns {Promise<Array<{Codesherkat: string, EsmSherkat: string}>>}
   */
  async getCompanies() {
    try {
      const db = await this.openPublicDb();
      const storeName = Array.from(db.objectStoreNames).find(n => n.toLowerCase() === 'tk_sherkat');
      
      if (!storeName) {
        console.warn('⚠️ [getCompanies] استور tk_sherkat پیدا نشد!');
        return [];
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();

        req.onsuccess = () => {
          const results = req.result;
          
          // 🔧 خواندن کلیدها بدون حساسیت به حروف
          const getField = (obj, name) => {
            if (!obj) return undefined;
            if (obj[name] !== undefined) return obj[name];
            const lower = name.toLowerCase();
            for (const k in obj) {
              if (k.toLowerCase() === lower) return obj[k];
            }
            return undefined;
          };

          const companies = results.map(r => {
            const actualObj = (r && r.value) ? r.value : r; // اگر ساختار {value} بود
            const code = getField(actualObj, 'Codesherkat');
            const name = getField(actualObj, 'EsmSherkat');
            
            if (code !== undefined && name !== undefined) {
              return {
                Codesherkat: String(code),
                EsmSherkat: String(name)
              };
            }
            return null;
          }).filter(Boolean);

      //    console.log('📦 [getCompanies] تعداد شرکت‌های معتبر:', companies.length);

          // حذف تکراری‌ها و مرتب‌سازی
          const unique = Array.from(new Map(companies.map(c => [c.Codesherkat, c])).values());
          unique.sort((a, b) => a.Codesherkat.localeCompare(b.Codesherkat, undefined, { numeric: true }));
          
          resolve(unique);
        };

        req.onerror = () => reject(new Error('خطا در خواندن tk_sherkat: ' + req.error));
      });
    } catch (err) {
      console.error('❌ [getCompanies] خطای کلی:', err);
      return [];
    }
  }
  /**
   * استخراج سال‌های مالی موجود برای یک شرکت
   * با نگاه به نام دیتابیس‌های IndexedDB (چون هر شرکت یک دیتابیس است)
   * @param {string} companyCode
   * @returns {Promise<number[]>}
   */
  async getAvailableYears(companyCode) {
    try {
      const db = await this.openCompanyDb(companyCode);
      console.log(`✅ [getAvailableYears] دیتابیس ${companyCode} باز شد. استورها:`, Array.from(db.objectStoreNames));

      // پیدا کردن نام استور sanad بدون حساسیت به حروف
      const storeName = Array.from(db.objectStoreNames).find(n => n.toLowerCase() === 'sanad');

      if (!storeName) {
        console.warn(`⚠️ [getAvailableYears] استور sanad در دیتابیس ${companyCode} پیدا نشد!`);
        return [];
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAllKeys();

        req.onsuccess = () => {
          const keys = req.result;
          if (keys.length > 0) {
          }

          const years = new Set();
          keys.forEach(k => {
            if (Array.isArray(k) && k.length >= 1) {
              const year = Number(k[0]);
              if (!isNaN(year)) years.add(year);
            }
          });
          
          const sorted = Array.from(years).sort((a, b) => a - b);
          console.log(`✅ [getAvailableYears] سال‌های پیدا شده برای ${companyCode}:`, sorted);
          resolve(sorted);
        };

        req.onerror = () => {
          console.error(`❌ [getAvailableYears] خطا در getAllKeys:`, req.error);
          reject(new Error('خطا در خواندن کلیدهای sanad: ' + req.error));
        };
      });
    } catch (err) {
      console.error(`❌ [getAvailableYears] خطای کلی برای ${companyCode}:`, err);
      return [];
    }
  }
  /**
   * استخراج بلوک‌های فشرده از استور شرکت
   * @param {string|number} companyCode - کد شرکت
   * @param {string} family - 'sanad' یا 'coding'
   * @param {number} [year] - سال مالی (فقط برای sanad)
   * @returns {Promise<Uint8Array[]>}
   */
  async getCompressedBlocks(companyCode, family, year = null) {
    const db = await this.openCompanyDb(companyCode);
    const storeName = family.toLowerCase();

    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`استور ${storeName} در دیتابیس ${companyCode} وجود ندارد.`);
    }

    const blocks = [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      // ساخت KeyRange برای فیلتر
      let keyRange;

      if (family.toLowerCase() === 'sanad' && year !== null) {
        // کلید sanad: [year, companyCode, blockIndex]
        // فیلتر: [year, companyCode, 0] تا [year, companyCode, Infinity]
        keyRange = IDBKeyRange.bound(
          [year, String(companyCode), 0],
          [year, String(companyCode), Infinity]
        );
      } else if (family.toLowerCase() === 'coding') {
        // کلید coding: [companyCode, blockIndex]
        // فیلتر: [companyCode, 0] تا [companyCode, Infinity]
        keyRange = IDBKeyRange.bound(
          [String(companyCode), 0],
          [String(companyCode), Infinity]
        );
      } else {
        reject(new Error('پارامترهای نامعتبر برای getCompressedBlocks'));
        return;
      }

      const request = store.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor) {
          const value = cursor.value;

          // بررسی نوع داده
          if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
            blocks.push(value);
          } else if (value && value.value) {
            // اگر ساختار {key, value} باشد
            blocks.push(value.value);
          } else {
            this.logger.warn(`بلوک با کلید ${JSON.stringify(cursor.key)} فرمت نامعتبر دارد.`);
          }

          cursor.continue();
        } else {
          // پایان cursor
          this.logger.log(
            `✅ ${blocks.length} بلوک فشرده از ${storeName} (شرکت ${companyCode}${year ? `, سال ${year}` : ''}) استخراج شد.`
          );
          resolve(blocks);
        }
      };

      request.onerror = (event) => {
        reject(new Error(`خطا در استخراج بلوک‌ها: ${event.target.error}`));
      };
    });
  }

  /**
   * ترکیب همه: دریافت داده آماده برای Decompressor
   * @param {string|number} companyCode - کد شرکت
   * @param {string} family - 'sanad' یا 'coding'
   * @param {number} [year] - سال مالی (فقط برای sanad)
   * @returns {Promise<{columns: Array, blocks: Uint8Array[]}>}
   */
  async getReadyData(companyCode, family, year = null) {
    try {
      // ۱. خواندن ستون‌ها
      const columns = await this.getColumns(family);
      this.logger.log(`📋 ${columns.length} ستون از public/columns خوانده شد.`);

      // ۲. استخراج بلوک‌های فشرده
      const blocks = await this.getCompressedBlocks(companyCode, family, year);

      return {
        columns,
        blocks,
        companyCode: String(companyCode),
        family: family.toLowerCase(),
        year
      };

    } catch (error) {
      this.logger.error('❌ خطا در getReadyData:', error);
      throw error;
    }
  }

}

/* ============================ DataDecompressor ============================ */
/**
 * BINA DataDecompressor - نسخه اصلاح شده (Fixed)
 * 
 * تغییرات اصلی:
 * 1. فرض اولیه: rows شامل ستون‌های کلیدی (Id, CompanyCode, FiscalYear) نیستند.
 * 2. استخراج کلیدها از آرایه ids انجام می‌شود و به آبجکت اضافه می‌گردد.
 * 3. نگاشت ستون‌ها فقط برای داده‌های غیرکلیدی انجام می‌شود.
 */

class DataDecompressor {
  constructor(options = {}) {
    this.pako = options.pako || (typeof pako !== 'undefined' ? pako : undefined);
    if (!this.pako) {
      throw new Error('کتابخانه pako بارگذاری نشده است.');
    }

    this.options = {
      maxRows: options.maxRows ?? 250000,
      castTypes: options.castTypes ?? true,
      attachKeyFields: options.attachKeyFields ?? true
    };
  }

  /**
   * باز کردن بلوک‌ها و تبدیل به آرایه اشیاء
   */
  async inflateBlocks(compressedBlocks, columns, options = {}) {
    const opts = { ...this.options, ...options };
    
    // نرمال‌سازی ستون‌ها (حذف ستون‌های کلیدی از لیست نگاشت ردیف)
    const allColDefs = this.normalizeColumns(columns);
    
    // ستون‌هایی که باید از روی "rows" پر شوند (بدون Id/Company/Fiscal)
    const dataColDefs = allColDefs.filter(c => 
      !this._isIdColumn(c.name) && 
      !this._isCompanyColumn(c.name) && 
      !this._isFiscalYearColumn(c.name)
    );

    const result = [];

    // 🚀 بهینه‌سازی: نام ستون‌ها و نوع عددی‌شان یک‌بار محاسبه می‌شود،
    //    نه برای هر سلول از هر ردیف (بازگشایی ~۲ برابر سریع‌تر می‌شود)
    const dataNames = dataColDefs.map(c => c.name);
    const dataIsNumeric = dataColDefs.map(c => {
      const t = String(c.type).toLowerCase();
      return t.includes('int') || t.includes('decimal') || t.includes('money');
    });
    const colCount = dataNames.length;

    for (let blockIndex = 0; blockIndex < compressedBlocks.length; blockIndex++) {
      const inputBlock = compressedBlocks[blockIndex];
              const data = await this.inflateSingleBlock(inputBlock);

      if (!data || !Array.isArray(data.rows)) continue;

      const ids = Array.isArray(data.ids) ? data.ids : [];
      const rows = data.rows;

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        if (result.length >= opts.maxRows) break;

        const rawRow = rows[rowIndex];
        const idItem = ids[rowIndex];

        // ۱. ایجاد آبجکت پایه
        const obj = {};

        // ۲. استخراج و افزودن کلیدها از ids
        if (opts.attachKeyFields && idItem !== undefined) {
          this._attachKeys(obj, idItem);
        }

        // ۳. نگاشت داده‌های ردیف به ستون‌های باقی‌مانده
        // فرض: طول rawRow برابر با تعداد ستون‌های غیرکلیدی است
        for (let i = 0; i < colCount; i++) {
          const value = rawRow[i];

          if (!opts.castTypes || value === null || value === undefined) {
            obj[dataNames[i]] = opts.castTypes ? null : value;
          } else if (dataIsNumeric[i]) {
            const n = Number(value);
            obj[dataNames[i]] = isNaN(n) ? value : n;
          } else {
            obj[dataNames[i]] = value;
          }
        }

        result.push(obj);
      }
      
      // آزادسازی حافظه بلوک
      if (opts.releaseInputBlocks) compressedBlocks[blockIndex] = null;
    }

    return result;
  }

  async inflateSingleBlock(compressedBlock) {
    if (compressedBlock && typeof compressedBlock === 'object' && Array.isArray(compressedBlock.rows)) {
      return compressedBlock;
    }

    const bytes = this._toUint8Array(compressedBlock);
    const jsonString = this._gunzipToString(bytes);
    return JSON.parse(jsonString);
  }

  normalizeColumns(columns) {
    if (!Array.isArray(columns)) throw new Error('columns must be array');
    
    return columns.map((col, index) => {
      if (typeof col === 'string') {
        return { name: col, type: 'string', ordinal: index };
      }
      return {
        name: String(col.name || col.Name),
        type: String(col.type || col.Type || 'string'),
        ordinal: Number(col.ordinal || col.OrdinalPosition || index)
      };
    });
  }

  _attachKeys(obj, idItem) {
    // اگر idItem آرایه باشد (مثلاً [1402, 1100, 1])
    if (Array.isArray(idItem)) {
      // ترتیب استاندارد Sanad: [FiscalYear, CompanyCode, Id]
      if (idItem.length >= 3) {
        obj.FiscalYear = idItem[0];
        obj.CompanyCode = idItem[1];
        obj.Id = idItem[2];
      } 
      // ترتیب استاندارد Coding: [CompanyCode, Id]
      else if (idItem.length === 2) {
        obj.CompanyCode = idItem[0];
        obj.Id = idItem[1];
      } 
      else {
        obj.Id = idItem[0];
      }
    } 
    // اگر idItem ساده باشد
    else {
      obj.Id = idItem;
    }
  }

  _isIdColumn(name) { return name.toLowerCase() === 'id'; }
  _isCompanyColumn(name) { return ['companycode', 'company'].includes(name.toLowerCase()); }
  _isFiscalYearColumn(name) { return ['fiscalyear', 'year'].includes(name.toLowerCase()); }

  _toUint8Array(block) {
    if (block instanceof Uint8Array) return block;
    if (block instanceof ArrayBuffer) return new Uint8Array(block);
    throw new Error('Invalid block format');
  }

  _gunzipToString(bytes) {
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    let output;
    if (isGzip) {
      output = this.pako.ungzip(bytes, { to: 'string' });
    } else {
      output = this.pako.inflate(bytes, { to: 'string' });
    }
    return output;
  }
}

/* ============================ BinaReportEngine ============================ */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BinaReportEngine v1.1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 📖 توصیف کلی:
 * موتور تولید گزارش‌های حسابداری در سمت کلاینت (مرورگر).
 * این کامپوننت داده‌های فشرده (GZIP) را از IndexedDB می‌خواند،
 * با استفاده از الگوریتم‌های بهینه (Map-based Aggregation & Join)
 * پردازش می‌کند و خروجی را به صورت آرایه‌ای از اشیاء برمی‌گرداند
 * که مستقیماً به BinaGrid (یا هر گرید دیگر) قابل اتصال است.
 * 
 * 🔗 وابستگی‌ها:
 * - کلاس‌های BinaDBManager و DataDecompressor در همین فایل تعریف شده‌اند
 * - pako (کتابخانه GZIP - باید قبل از این فایل لود شود)
 * 
 * 📝 تغییرات v1.1.0:
 * - اصلاح متریک‌های عملکرد (هر فاز از t0 خودش)
 * - کش درون‌حافظه‌ای برای Drill-down‌های پیاپی
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

class BinaReportEngine {
  /**
   * سازنده کلاس
   * @param {Object} [options] - تنظیمات اختیاری
   * @param {BinaDBManager} [options.dbManager] - نمونه BinaDBManager
   * @param {DataDecompressor} [options.decompressor] - نمونه DataDecompressor
   * @param {boolean} [options.enablePerformanceLog=true] - نمایش لاگ زمان‌بندی
   * @param {Function} [options.logger=console] - تابع لاگ
   */
  constructor(options = {}) {
    this.options = Object.assign({
      enablePerformanceLog: true,
      logger: console
    }, options);

    this.dbManager = options.dbManager || new BinaDBManager();
    this.decompressor = options.decompressor || new DataDecompressor();

    // 🚀 کش درون‌حافظه‌ای: بازگشایی فشرده‌ها و خروجی گزارش‌ها یک‌بار انجام می‌شود
    //    تا Drill-down‌های بعدی بدون بازخوانی مجدد IndexedDB/GZIP اجرا شوند
    this._cache = {
      rows: new Map(),    // "family|company|year" → ردیف‌های بازشده
      results: new Map()  // "report|..." → خروجی نهایی
    };

    this.options.logger.log('✅ BinaReportEngine v1.1.0 آماده به کار است.');
  }

  /**
   * خواندن ردیف‌های یک خانواده (sanad/coding) با کش.
   * بار اول از IndexedDB می‌خواند و باز می‌کند، بارهای بعد همان آرایه برمی‌گردد.
   * @private
   */
  async _getCachedRows(companyCode, family, year, metrics, phaseName) {
    const key = `${family}|${companyCode}|${year === null || year === undefined ? '' : year}`;
    const hit = this._cache.rows.get(key);

    if (hit) {
      if (metrics && phaseName) {
        metrics.phases[phaseName] = { durationMs: 0, rowCount: hit.length, cached: true };
      }
      return hit;
    }

    const t0 = performance.now();
    const data = await this.dbManager.getReadyData(companyCode, family, year);
    const rows = await this.decompressor.inflateBlocks(
      data.blocks,
      data.columns,
      family === 'coding' ? { family, companyCode } : { family, companyCode, fiscalYear: year }
    );

    // فقط نتیجهٔ غیرخالی کش می‌شود؛ اگر خواندن ناقص بود، دفعهٔ بعد دوباره تلاش می‌کند
    if (rows.length > 0) this._cache.rows.set(key, rows);

    if (metrics && phaseName) {
      metrics.phases[phaseName] = {
        durationMs: performance.now() - t0,
        rowCount: rows.length,
        cached: false
      };
    }
    return rows;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * متد اصلی: execute
   * ═══════════════════════════════════════════════════════════════════════
   * 
   * نقطه ورود اصلی برای گزارش‌های از پیش تعریف‌شده (reportType).
   * @param {Object} params
   * @param {string} params.reportType - نوع گزارش ('taraz' یا 'daftarTafsil')
   * @param {string} params.companyCode - کد شرکت
   * @param {number} params.fiscalYear - سال مالی
   * @returns {Promise<Object[]>}
   */
  async execute(params) {
    this._validateParams(params);

    const startTime = performance.now();
    const metrics = {
      reportType: params.reportType,
      companyCode: params.companyCode,
      fiscalYear: params.fiscalYear,
      phases: {}
    };

    try {
      let result;
      switch (params.reportType) {
        case 'taraz':
          result = await this._generateTaraz(params, metrics);
          break;

        case 'daftarTafsil':                    // 👈 این ۳ خط را اضافه کن
          result = await this._generateDaftarTafsil(params, metrics);
          break;

        default:
          throw new Error(`نوع گزارش ناشناخته: ${params.reportType}. انواع پشتیبانی‌شده: taraz, daftarTafsil`);
      }

      metrics.totalTimeMs = performance.now() - startTime;
      metrics.resultCount = result.length;
      if (this.options.enablePerformanceLog) {
        this._logPerformance(metrics);
      }

      return result;

    } catch (error) {
      this.options.logger.error('❌ خطا در BinaReportEngine.execute:', error);
      throw error;
    }
  }
  /** Return a safe integer document number (Persian, Arabic or Latin digits). */
  _documentNumber(value) {
    if (value === undefined || value === null) return null;
    const digits = String(value).trim()
      .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0))
      .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660));
    if (!/^\d+$/.test(digits)) return null;
    const number = Number(digits);
    return Number.isSafeInteger(number) ? number : null;
  }

  /**
   * Exclude exactly one DOCUMENT (all its rows), not one accounting row.
   * Opening = number 1; closing = greatest document number;
   * account-closing = second-greatest distinct existing document number.
   * Boundaries are computed before filtering by account for drill-down consistency.
   */
  _excludedDocumentNumber(sanadRows, docType = 'all') {
    if (docType === 'all') return null;
    if (docType === 'eftetahieh') return 1;
    if (docType !== 'bastan' && docType !== 'ekhtetamieh') {
      throw new Error('نوع اسناد نامعتبر: ' + docType);
    }
    let last = null;
    let beforeLast = null;
    for (const row of sanadRows) {
      const number = this._documentNumber(row.shomarehsanad);
      if (number === null || number === last || number === beforeLast) continue;
      if (last === null || number > last) {
        beforeLast = last;
        last = number;
      } else if (beforeLast === null || number > beforeLast) {
        beforeLast = number;
      }
    }
    return docType === 'ekhtetamieh' ? last : beforeLast;
  }

  /**
   * دفتر تفصیل (ریز اسناد یک حساب)
   */
  async _generateDaftarTafsil(params, metrics) {
    const { companyCode, fiscalYear } = params;
    const filter = params.filter || {};
    const docType = params.docType || 'all';
    let t0 = performance.now();

    // Cache separates report variants by document exclusion mode.
    const daftarKey = `daftar|${companyCode}|${fiscalYear}|${docType}|` + JSON.stringify(filter || {});
    const cachedDaftar = this._cache.results.get(daftarKey);
    if (cachedDaftar) {
      metrics.phases.cache = { durationMs: 0, hit: true };
      return cachedDaftar.map(r => Object.assign({}, r));
    }

    // ۱. خواندن داده‌های Sanad (از کش، اگر قبلاً باز شده باشد)
    const sanadRows = await this._getCachedRows(companyCode, 'sanad', fiscalYear, metrics, 'sanadLoad');
    const excludedDocNumber = this._excludedDocumentNumber(sanadRows, docType);

    // ۲. فیلتر کردن بر اساس کدهای حساب
    t0 = performance.now();
    const result = [];

    for (const row of sanadRows) {
      if (excludedDocNumber !== null &&
          this._documentNumber(row.shomarehsanad) === excludedDocNumber) continue;
      // اعمال فیلتر
      if (filter.KOl_Code !== undefined && Number(row.kol_code) !== Number(filter.KOl_Code)) continue;
      if (filter.Moien_Code !== undefined && Number(row.moien_code) !== Number(filter.Moien_Code)) continue;
      if (filter.Tafsil_Code !== undefined && Number(row.tafsil_code) !== Number(filter.Tafsil_Code)) continue;

      result.push({
        ShomarehSanad: row.shomarehsanad,
        Tarikh: row.tarikh,
        SharhSanad: row.sharhsanad,
        Bedehkar: Number(row.bedehkar) || 0,
        Bestankar: Number(row.bestankar) || 0,
        Mandeh: 0,
        Vaziat: ''
      });
    }

    // مرتب‌سازی دفتر به ترتیب تاریخ و سپس شماره سند
    result.sort((a, b) => {
      const ta = String(a.Tarikh || '');
      const tb = String(b.Tarikh || '');
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (Number(a.ShomarehSanad) || 0) - (Number(b.ShomarehSanad) || 0);
    });

    // مانده تجمعی بعد از مرتب‌سازی حساب می‌شود تا با ترتیب نمایش بخواند
    let sumMandeh = 0;
    for (const r of result) {
      sumMandeh += (r.Bedehkar - r.Bestankar);
      r.Mandeh = Math.abs(sumMandeh);
      r.Vaziat = sumMandeh > 0 ? 'بد' : 'بس';
    }

    metrics.phases.filterAndSort = { durationMs: performance.now() - t0, resultCount: result.length };
    if (result.length > 0) this._cache.results.set(daftarKey, result);

    return result;
  }
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * تراز (Trial Balance) — سه سطح: kol (کل) / moien (معین) / tafsil (تفصیل)
   * ═══════════════════════════════════════════════════════════════════════
   *
   * @param {Object} params
   * @param {string} params.companyCode
   * @param {number} params.fiscalYear
   * @param {'kol'|'moien'|'tafsil'} params.level
   * @returns {Promise<Object[]>}
   */
  async _generateTaraz(params, metrics) {
    const { companyCode, fiscalYear, level } = params;
    const docType = params.docType || 'all';

    if (!['kol', 'moien', 'tafsil'].includes(level)) {
      throw new Error(`سطح نامعتبر: ${level}. مقادیر مجاز: kol, moien, tafsil`);
    }

    // 🚀 اگر همین درخواست (همان شرکت/سال/سطح/فیلتر) قبلاً ساخته شده، همان خروجی برگردد
    const cacheKey = `taraz|${companyCode}|${fiscalYear}|${level}|${docType}|` +
      JSON.stringify(params.filter || {}) + '|' + JSON.stringify(params.filters || {});

    const cached = this._cache.results.get(cacheKey);
    if (cached) {
      metrics.phases.cache = { durationMs: 0, hit: true };
      return cached.map(r => Object.assign({}, r));
    }

    // ═══ فاز ۱: بارگذاری داده‌های Coding ═══
    let t0 = performance.now();

    const codingRows = await this._getCachedRows(companyCode, 'coding', null, metrics, 'codingLoad');

    // ═══ فاز ۲: ساخت ایندکس Coding ═══
    t0 = performance.now();

    const codingMap = new Map();
    for (let i = 0; i < codingRows.length; i++) {
      const c = codingRows[i];
      let key;
      if (level === 'kol') {
        key = String(c.kol_code);
      } else if (level === 'moien') {
        key = `${c.kol_code}-${c.moien_code}`;
      } else {
        key = `${c.kol_code}-${c.moien_code}-${c.tafsil_code}`;
      }
      codingMap.set(key, {
        kol_onvan: c.kol_onvan || '',
        moien_onvan: c.moien_onvan || '',
        tafsil_onvan: c.tafsil_onvan || ''
      });
    }

    metrics.phases.codingIndex = {
      durationMs: performance.now() - t0,
      indexSize: codingMap.size
    };

    // ═══ فاز ۳: بارگذاری داده‌های Sanad ═══
    t0 = performance.now();

    const sanadRows = await this._getCachedRows(companyCode, 'sanad', fiscalYear, metrics, 'sanadLoad');
    const excludedDocNumber = this._excludedDocumentNumber(sanadRows, docType);

    // ═══ فاز ۴: تجمیع Sanad بر اساس سطح ═══
    t0 = performance.now();

    const aggregated = new Map();
    const filter = params.filter || null;

    for (let i = 0; i < sanadRows.length; i++) {
      const row = sanadRows[i];
      if (excludedDocNumber !== null &&
          this._documentNumber(row.shomarehsanad) === excludedDocNumber) continue;

      // 🔧 اعمال فیلتر Drill-down
      if (filter) {
        if (filter.KOl_Code !== undefined && Number(row.kol_code) !== Number(filter.KOl_Code)) continue;
        if (filter.Moien_Code !== undefined && Number(row.moien_code) !== Number(filter.Moien_Code)) continue;
        if (filter.Tafsil_Code !== undefined && Number(row.tafsil_code) !== Number(filter.Tafsil_Code)) continue;
      }

      let key;
      if (level === 'kol') {
        key = String(row.kol_code);
      } else if (level === 'moien') {
        key = `${row.kol_code}-${row.moien_code}`;
      } else {
        key = `${row.kol_code}-${row.moien_code}-${row.tafsil_code}`;
      }

      if (!aggregated.has(key)) {
        aggregated.set(key, {
          kol_code: row.kol_code,
          moien_code: level !== 'kol' ? row.moien_code : null,
          tafsil_code: level === 'tafsil' ? row.tafsil_code : null,
          totalBedehkar: 0,
          totalBestankar: 0
        });
      }

      const acc = aggregated.get(key);
      acc.totalBedehkar += (Number(row.bedehkar) || 0);
      acc.totalBestankar += (Number(row.bestankar) || 0);
    }

    metrics.phases.aggregation = {
      durationMs: performance.now() - t0,
      uniqueGroups: aggregated.size
    };

    // ═══ فاز ۵: ساخت خروجی با JOIN و اعمال فیلترها ═══
    t0 = performance.now();

    const result = [];
    const filters = params.filters || {}; // دریافت فیلترهای متنی/عددی

    for (const [key, sanad] of aggregated.entries()) {
      const coding = codingMap.get(key) || {};

      const bedehkar = sanad.totalBedehkar;
      const bestankar = sanad.totalBestankar;
      const mandehBedehkar = (bedehkar - bestankar) > 0 ? (bedehkar - bestankar) : 0;
      const mandehBestankar = (bestankar - bedehkar) > 0 ? (bestankar - bedehkar) : 0;

      // ساخت CodeHesab و OnvanHesab بر اساس سطح
      let codeHesab, onvanHesab;
      if (level === 'kol') {
        codeHesab = String(sanad.kol_code);
        onvanHesab = coding.kol_onvan || '';
      } else if (level === 'moien') {
        codeHesab = `${sanad.kol_code} - ${sanad.moien_code}`;
        onvanHesab = `${coding.kol_onvan || ''} - ${coding.moien_onvan || ''}`;
      } else {
        codeHesab = `${sanad.kol_code} - ${sanad.moien_code} - ${sanad.tafsil_code}`;
        onvanHesab = `${coding.kol_onvan || ''} - ${coding.moien_onvan || ''} - ${coding.tafsil_onvan || ''}`;
      }

      // ساخت آبجکت ردیف
      let rowObj = {
        EsmSherkat: companyCode,
        SalMali: fiscalYear,
        CodeHesab: codeHesab,
        KOl_Code: sanad.kol_code,
        Moien_Code: sanad.moien_code,
        Tafsil_Code: sanad.tafsil_code,
        OnvanHesab: onvanHesab,
        KOl_Onvan: coding.kol_onvan || '',
        Moien_Onvan: coding.moien_onvan || '',
        Tafsil_Onvan: coding.tafsil_onvan || '',
        GardeshBedehkar: bedehkar,
        GardeshBestankar: bestankar,
        MandehBedehkar: mandehBedehkar,
        MandehBestankar: mandehBestankar
      };

      // 🔧 حذف فیلدهای اضافی بر اساس سطح (تا اصلاً به گرید نروند)
      ['KOl_Code','KOl_Onvan','Moien_Code','Tafsil_Code',
 'Moien_Onvan','Tafsil_Onvan','EsmSherkat','SalMali'
].forEach(k => delete rowObj[k]);
      // 🔧 اعمال فیلترهای متنی/عددی
      let passesFilters = true;
      for (const [field, condition] of Object.entries(filters)) {
        if (!condition) continue;
        
        const val = rowObj[field];
        if (val === undefined) continue;

        if (typeof condition === 'string') {
          if (!String(val).includes(condition)) { passesFilters = false; break; }
        }
        else if (typeof condition === 'number') {
          if (Number(val) !== condition) { passesFilters = false; break; }
        }
        else if (typeof condition === 'object' && condition.value !== undefined) {
          const v = Number(val);
          const target = Number(condition.value);
          if (condition.op === '>') { if (!(v > target)) { passesFilters = false; break; } }
          else if (condition.op === '<') { if (!(v < target)) { passesFilters = false; break; } }
          else if (condition.op === '=') { if (v !== target) { passesFilters = false; break; } }
          else if (condition.op === 'between') {
            const min = Number(condition.min);
            const max = Number(condition.max);
            if (!(v >= min && v <= max)) { passesFilters = false; break; }
          }
        }
      }

      if (passesFilters) {
        result.push(rowObj);
      }
    }

    metrics.phases.joinAndTransform = {
      durationMs: performance.now() - t0,
      resultCount: result.length
    };

    // ═══ فاز ۶: مرتب‌سازی ═══
    t0 = performance.now();

    result.sort((a, b) => {
      if (a.KOl_Code !== b.KOl_Code) return a.KOl_Code - b.KOl_Code;
      if (a.Moien_Code !== b.Moien_Code) return (a.Moien_Code || 0) - (b.Moien_Code || 0);
      return (a.Tafsil_Code || 0) - (b.Tafsil_Code || 0);
    });

    metrics.phases.sorting = {
      durationMs: performance.now() - t0
    };

    // ═══ فاز ۷: نگه‌داشتن خروجی در کش (داده‌های خام هم برای Drill-down کش شده‌اند) ═══
    //    نکته: آرایه‌های خوانده‌شده کش شده‌اند و نباید خالی شوند.
    if (result.length > 0) this._cache.results.set(cacheKey, result);

    return result;
  }
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * اعتبارسنجی پارامترهای ورودی
   * ═══════════════════════════════════════════════════════════════════════
   * 
   * @private
   */
  _validateParams(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('پارامترهای ورودی باید یک آبجکت باشد.');
    }

    if (!params.reportType || typeof params.reportType !== 'string') {
      throw new Error('reportType (نوع گزارش) اجباری است و باید رشته باشد.');
    }

    if (!params.companyCode || typeof params.companyCode !== 'string') {
      throw new Error('companyCode (کد شرکت) اجباری است و باید رشته باشد.');
    }

    if (!params.fiscalYear || typeof params.fiscalYear !== 'number') {
      throw new Error('fiscalYear (سال مالی) اجباری است و باید عدد باشد.');
    }
    if (params.reportType === 'taraz' && !['kol', 'moien', 'tafsil'].includes(params.level)) {
      throw new Error('برای گزارش taraz، پارامتر level الزامی است (kol | moien | tafsil).');
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * نمایش آمار عملکرد در کنسول
   * ═══════════════════════════════════════════════════════════════════════
   * 
   * @private
   */
  _logPerformance(metrics) {
    const log = this.options.logger.log;
    log('📊 ─────────── گزارش عملکرد ───────────');
    log(`📋 نوع: ${metrics.reportType}`);
    log(`🏢 شرکت: ${metrics.companyCode} | 📅 سال: ${metrics.fiscalYear}`);
    log(`📦 ردیف‌های نتیجه: ${metrics.resultCount}`);

    if (metrics.phases) {
      log('⏱️ فازها:');
      for (const [name, phase] of Object.entries(metrics.phases)) {
        const detail = phase.rowCount !== undefined ? ` | ${phase.rowCount} ردیف` :
          phase.indexSize !== undefined ? ` | ${phase.indexSize} ایندکس` :
          phase.uniqueGroups !== undefined ? ` | ${phase.uniqueGroups} گروه` :
          phase.resultCount !== undefined ? ` | ${phase.resultCount} نتیجه` :
          '';
        log(`   • ${name}: ${phase.durationMs.toFixed(1)}ms${detail}`);
      }
    }

    log(`⚡ مجموع: ${metrics.totalTimeMs.toFixed(1)}ms`);
    log('─────────────────────────────────────');
  }

}

/* ============================ Taraz UI ============================ */
/* =========================================
   taraz.js - منطق و کامپوننت فرم تراز
   ========================================= */

let grid = null;
let tarazRequestId = 0;
let tarazRenderQueue = Promise.resolve(); // serializes UI updates during rapid filter changes
let activeTarazContext = null; // level currently displayed by the single main grid
const TARAZ_MAIN_GRID_NAME = 'Taraz'; // one persistent layout for all 3 levels

// Page-scoped drill-down mode. Nothing is registered on the global BinaGrid class.
let tarazDrillMode = 'taraz';

function installTarazDrillControls(view) {
  const toolbar = view.toolbar;
  if (!toolbar || toolbar.querySelector('.taraz-drill-controls')) return;
  const controls = document.createElement('div');
  controls.className = 'taraz-drill-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'نمایش اطلاعات آبشاری');
  const label = document.createElement('span');
  label.className = 'taraz-drill-title';
  label.textContent = 'نمایش اطلاعات آبشاری:';
  controls.appendChild(label);
  for (const [value, title] of [['taraz', 'تراز'], ['daftar', 'دفتر']]) {
    const option = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'tarazDrillMode';
    input.value = value;
    input.checked = value === tarazDrillMode;
    input.addEventListener('change', () => {
      if (input.checked) tarazDrillMode = value;
    });
    option.append(input, document.createTextNode(title));
    controls.appendChild(option);
  }
  const printButton = toolbar.querySelector('[data-act="print"]');
  if (printButton) printButton.insertAdjacentElement('afterend', controls);
  else toolbar.appendChild(controls);
}

function handleTarazCodeDblClick(e, context, currentLevel) {
  // Trigger only from an account-code cell, inside this page's specific grids.
  if (!context || e?.field !== 'CodeHesab' || !e.data?.CodeHesab) return;
  if (e.event?.target?.closest?.('.bina-selector-gutter,.bina-selector-corner,.bina-row-resizer')) return;
  const nextLevel = tarazDrillMode === 'daftar' ? 'daftar' :
    (currentLevel === 'kol' ? 'moien' : (currentLevel === 'moien' ? 'tafsil' : 'daftar'));
  openDrillDown(e.data, nextLevel, context.companyCode, context.fiscalYear, context.docType);
}

const engine = new BinaReportEngine();
const dbManager = engine.dbManager;

// عنوان ستون‌ها یک‌جا تعریف می‌شود و در گرید اصلی و مودال‌ها مشترک است
const TARAZ_CAPTIONS = {
  CodeHesab: 'کد حساب', OnvanHesab: 'عنوان حساب',
  GardeshBedehkar: 'بدهکار', GardeshBestankar: 'بستانکار',
  MandehBedehkar: 'مانده بد', MandehBestankar: 'مانده بس'
};

const DAFTAR_CAPTIONS = {
  ShomarehSanad: 'شماره سند', Tarikh: 'تاریخ', SharhSanad: 'شرح سند',
  Bedehkar: 'بدهکار', Bestankar: 'بستانکار', Mandeh: 'مانده', Vaziat: 'وضعیت'
};

// Carry over the latest existing layout from v1.0.2 (Taraz_kol/moien/tafsil)
// to one shared layout. Runs once, and never overwrites a newer shared layout.
function migrateTarazGridSettings() {
  try {
    const signature = Object.keys(TARAZ_CAPTIONS).sort().join('|');
    const key = 'BinaGrid.' + TARAZ_MAIN_GRID_NAME + '.' + signature + '.v1';
    if (localStorage.getItem(key)) return;
    const previous = ['kol', 'moien', 'tafsil'].map(level => {
      const value = localStorage.getItem('BinaGrid.Taraz_' + level + '.' + signature + '.v1');
      if (!value) return null;
      try {
        const parsed = JSON.parse(value);
        if (parsed?.version !== 1) return null;
        return { value, savedAt: Date.parse(parsed.savedAt || '') || 0 };
      } catch (_) { return null; }
    }).filter(Boolean);
    if (!previous.length) return;
    previous.sort((a, b) => b.savedAt - a.savedAt);
    localStorage.setItem(key, previous[0].value);
  } catch (err) {
    console.warn('[BinaTaraz] انتقال تنظیمات قدیمی ممکن نشد:', err);
  }
}

function ensureMainTarazGrid() {
  if (grid) return grid;
  migrateTarazGridSettings();
  grid = new BinaGrid('#gridContainer', {
    pageSize: 500,
    height: '100%',
    captions: TARAZ_CAPTIONS,
    columnCalcs: 'table'
  });
  installTarazDrillControls(grid);
  // Only this report instance: double-click ON CodeHesab, not on other cells/rows.
  grid.on('cellDblClick', (e) => {
    const context = activeTarazContext;
    if (context) handleTarazCodeDblClick(e, context, context.level);
  });
  return grid;
}

// Account segments must read LTR: Kol → Moien → Tafsil, regardless of page RTL.
async function applyAccountCodeDirection(view) {
  const col = view.table?.getColumn?.('CodeHesab');
  if (!col) return;
  const state = view.getColumnState('CodeHesab');
  // Preserve explicitly saved/selected alignment; CSS keeps code segments LTR.
  if (state.align == null) {
    state.align = 'left';
    await view.syncColumnAlignment('CodeHesab');
  }
}

// ==========================================
// ۱. توابع بارگذاری کمبوها (شرکت‌ها و سال‌ها)
// ==========================================
async function loadCompanies() {
  console.log('🚀 [loadCompanies] شروع...');
  const select = document.getElementById('companyCode');
  try {
    const companies = await dbManager.getCompanies();
    select.innerHTML = '';
    if (!companies || companies.length === 0) {
      select.innerHTML = '<option value="">شرکتی یافت نشد</option>';
      return;
    }
    companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.Codesherkat;
      opt.textContent = c.EsmSherkat + ' (' + c.Codesherkat + ')';
      select.appendChild(opt);
    });
    // بارگذاری سال‌های اولین شرکت
    await loadYears(companies[0].Codesherkat);
  } catch (err) {
    console.error('❌ [loadCompanies] خطا:', err);
    select.innerHTML = '<option value="">خطا در بارگذاری</option>';
  }
}

async function loadYears(companyCode) {
  console.log(`🚀 [loadYears] شروع برای شرکت: ${companyCode}`);
  const select = document.getElementById('fiscalYear');
  if (!companyCode) {
    select.innerHTML = '<option value="">--</option>';
    return;
  }
  select.innerHTML = '<option value="">در حال بارگذاری...</option>';
  try {
    const years = await dbManager.getAvailableYears(companyCode);
    select.innerHTML = '';
    if (!years || years.length === 0) {
      select.innerHTML = '<option value="">سالی یافت نشد</option>';
      return;
    }
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    });
    select.value = years[years.length - 1];
  } catch (err) {
    console.error('❌ [loadYears] خطا:', err);
    select.innerHTML = '<option value="">خطا</option>';
  }
}

// ==========================================
// ۲. تابع اصلی نمایش گرید تراز
// ==========================================
async function runTaraz() {
  const requestId = ++tarazRequestId;
  const level = document.querySelector('input[name="level"]:checked')?.value || 'kol';
  const docType = document.querySelector('input[name="docType"]:checked')?.value || 'all';
  const companyCode = document.getElementById('companyCode').value;
  const fiscalYear = Number(document.getElementById('fiscalYear').value);
  if (!companyCode || !fiscalYear) return;

  // Close drill-down windows as their parameters are no longer current.
  closeAllModals();
  try {
    const rows = await engine.execute({
      reportType: 'taraz', companyCode, fiscalYear, level, docType
    });
    if (requestId !== tarazRequestId) return;

    // setData resets/rebuilds columns in BinaGrid; serialize changes and always
    // use exactly the SAME main instance + table name + field signature.
    const job = tarazRenderQueue.catch(() => {}).then(async () => {
      if (requestId !== tarazRequestId) return;
      const view = ensureMainTarazGrid();
      const errorEl = document.getElementById('tarazGridError');
      if (errorEl) errorEl.remove();

      // Initialize the main Tabulator columns only once. BinaGrid.setData()
      // deliberately rebuilds columns, so calling it on each report-level change
      // would reset the live column layout, sizes, colors and header filters.
      const expectedSignature = Object.keys(TARAZ_CAPTIONS).sort().join('|');
      if (!view.tableName || view.fieldSignature !== expectedSignature) {
        // Even an empty first result needs the complete six-column schema.
        const emptyRow = {
          CodeHesab: '', OnvanHesab: '', GardeshBedehkar: 0,
          GardeshBestankar: 0, MandehBedehkar: 0, MandehBestankar: 0
        };
        await view.setData(rows.length ? rows : [emptyRow], TARAZ_MAIN_GRID_NAME, { own: true });
        if (!rows.length) await view.table.replaceData([]);
        // Default account-code presentation is LTR. Do not override a user's
        // chosen alignment every time a new level is selected.
        await applyAccountCodeDirection(view);
      } else {
        // Keep the very same Tabulator columns and BinaGrid instance; update
        // only row data. This preserves all live column-management settings.
        view.stateStore?.cancelPending?.();
        view.saveState();
        view.clearSelection();
        const indexedRows = rows.map((row, i) => ({ ...row, __id: i + 1 }));
        await view.table.replaceData(indexedRows);
        try { await view.table.setPage(1); } catch (_) { /* empty report */ }
        view._updateCount();
        view.smart.scheduleVisibleRows();
        view.smart.scheduleBottomCalcs();
        view._toggleEmpty();
        view.emit('dataLoaded', { tableName: TARAZ_MAIN_GRID_NAME, rows: rows.length });
      }
      view.stateStore?.cancelPending?.();
      view.saveState();
      if (requestId === tarazRequestId) {
        activeTarazContext = { level, docType, companyCode, fiscalYear };
      }
    });
    tarazRenderQueue = job;
    await job;
  } catch (err) {
    if (requestId !== tarazRequestId) return;
    console.error('[BinaTaraz] گزارش تراز:', err);
    const host = document.getElementById('gridContainer');
    if (host) {
      let alertEl = document.getElementById('tarazGridError');
      if (!alertEl) {
        alertEl = document.createElement('div');
        alertEl.id = 'tarazGridError';
        alertEl.className = 'taraz-grid-error';
        alertEl.setAttribute('role', 'alert');
        host.appendChild(alertEl);
      }
      alertEl.textContent = 'خطا در نمایش تراز: ' + (err?.message || 'نامشخص');
    }
  }
}

// ==========================================
// ۳. پنجره‌های Drill-down — روی هم باز می‌شوند
//    هر سطح یک مودال مستقل است که روی مودال قبلی
//    می‌نشیند؛ بستن هر مودال فقط همان سطح را می‌بندد
//    و سطح قبلی (گرید زیرین) دوباره در دسترس می‌شود.
// ==========================================
let modalSeq = 0;
const modalStack = [];

// چیدمان آبشاری: هر سطح کمی کوچک‌تر و جابه‌جا می‌شود تا سطح قبلی از پشت آن دیده شود
function _layoutModalStack() {
  modalStack.forEach((m, i) => {
    m.overlay.style.zIndex = String(9000 + i * 10);
    m.overlay.style.background = `rgba(15, 23, 42, ${Math.min(0.22 + i * 0.12, 0.55)})`;
    m.box.style.transform = `translate(${i * -18}px, ${i * 12}px)`;
    m.box.style.width = `calc(92vw - ${i * 36}px)`;
    m.box.style.height = `calc(88vh - ${i * 24}px)`;
  });
}

function _createModal(levelKey) {
  modalSeq += 1;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  // رنگ نوار بالای گرید هر سطح با سطح‌های دیگر فرق می‌کند (در taraz.css)
  if (levelKey) overlay.dataset.level = levelKey;
  overlay.innerHTML =
    '<div class="modal-box">' +
      '<div class="modal-header">' +
        '<h3 class="modal-title">جزئیات</h3>' +
        '<button type="button" class="modal-close" title="بستن این سطح (Esc)">✕</button>' +
      '</div>' +
      '<div class="modal-body" id="modalBody_' + modalSeq + '"></div>' +
    '</div>';

  const m = {
    seq: modalSeq,
    overlay: overlay,
    box: overlay.querySelector('.modal-box'),
    titleEl: overlay.querySelector('.modal-title'),
    bodyEl: overlay.querySelector('.modal-body'),
    grid: null
  };

  overlay.querySelector('.modal-close').addEventListener('click', (ev) => {
    ev.stopPropagation();
    _closeModal(m);
  });

  // کلیک روی پس‌زمینه‌ی همان سطح = بستن همان سطح
  overlay.addEventListener('mousedown', (ev) => {
    if (ev.target === overlay) _closeModal(m);
  });

  document.body.appendChild(overlay);
  modalStack.push(m);
  _layoutModalStack();
  return m;
}

// بستن یک مودال مشخص به‌همراه سطح‌های بالاترِ آن (اگر از میانه بسته شود)
function _closeModal(target) {
  const idx = modalStack.indexOf(target);
  if (idx === -1) return;
  while (modalStack.length > idx) {
    const m = modalStack.pop();
    if (m.grid) {
      try { m.grid.destroy(); } catch (err) { console.warn(err); }
      m.grid = null;
    }
    m.overlay.remove();
  }
  _layoutModalStack();
}

function closeAllModals() {
  while (modalStack.length) _closeModal(modalStack[modalStack.length - 1]);
}

// Esc فقط بالاترین سطح را می‌بندد
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && modalStack.length) {
    ev.preventDefault();
    _closeModal(modalStack[modalStack.length - 1]);
  }
});

// Open the existing accounting-document viewer in a page-local modal.
// Its lookup key includes company, fiscal year and document number.
function openSanadDocument(companyCode, fiscalYear, documentNumber) {
  const m = _createModal('sanad');
  m.titleEl.textContent = `سند حسابداری شماره ${documentNumber} — شرکت ${companyCode} — سال مالی ${fiscalYear}`;
  m.bodyEl.replaceChildren();
  const frame = document.createElement('iframe');
  frame.className = 'taraz-sanad-frame';
  frame.title = m.titleEl.textContent;
  const url = new URL('./tab-16.html', window.location.href);
  url.searchParams.set('companyCode', String(companyCode));
  url.searchParams.set('fiscalYear', String(fiscalYear));
  url.searchParams.set('documentNumber', String(documentNumber));
  frame.src = url.href;
  m.bodyEl.appendChild(frame);
}

// ==========================================
// ۴. باز کردن سطح بعدی تراز (Drill-down)
// ==========================================
async function openDrillDown(parentRow, nextLevel, companyCode, fiscalYear, docType = 'all') {
  // استخراج کدها از CodeHesab (مثلاً "11 - 1103 - 100001")
  // نکته: فقط بخش‌هایی که واقعاً وجود دارند به فیلتر اضافه می‌شوند؛
  // در غیر این صورت Number(undefined) = NaN و موتور همه ردیف‌ها را حذف می‌کند.
  const parts = String(parentRow.CodeHesab)
    .split('-')
    .map(s => s.trim())
    .filter(s => s !== '');

  const toCode = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };

  const filter = {};
  const kodKol = toCode(parts[0]);
  const kodMoien = toCode(parts[1]);
  const kodTafsil = toCode(parts[2]);

  if (kodKol !== undefined) filter.KOl_Code = kodKol;
  if (kodMoien !== undefined) filter.Moien_Code = kodMoien;
  if (kodTafsil !== undefined) filter.Tafsil_Code = kodTafsil;

  let title = '';
  let reportType = 'taraz';

  if (nextLevel === 'daftar') {
    // نام دفتر بر اساس عمق کد حساب: ۱ بخش = کل، ۲ بخش = معین، ۳ بخش = تفصیل
    const ledgerLabel = parts.length === 1 ? 'دفتر کل' :
      (parts.length === 2 ? 'دفتر معین' : 'دفتر تفصیل');
    title = `${ledgerLabel}: ${parentRow.CodeHesab} — ${parentRow.OnvanHesab}`;
    reportType = 'daftarTafsil';
  } else {
    title = `جزئیات: ${parentRow.CodeHesab} — ${parentRow.OnvanHesab} (سطح ${nextLevel === 'moien' ? 'معین' : 'تفصیل'})`;
  }

  // مودال جدید روی مودال فعلی باز می‌شود (سطح قبلی زیر آن باقی می‌ماند)
  const m = _createModal(nextLevel);
  m.titleEl.textContent = title;

  m.bodyEl.innerHTML = '<div class="modal-loading">در حال بارگذاری…</div>';

  try {
    const rows = await engine.execute({
      reportType: reportType,
      companyCode: companyCode,
      fiscalYear: fiscalYear,
      level: nextLevel === 'daftar' ? 'tafsil' : nextLevel,
      filter: filter,
      docType: docType
    });

    // اگر کاربر در این فاصله سطح را بست، چیزی نساز
    if (!modalStack.includes(m)) return;

    if (!rows || rows.length === 0) {
      m.bodyEl.innerHTML = '<div class="modal-loading">برای این حساب ردیفی یافت نشد.</div>';
      return;
    }

    const captions = nextLevel === 'daftar' ? DAFTAR_CAPTIONS : TARAZ_CAPTIONS;

    const containerId = 'modalBody_' + m.seq;
    m.bodyEl.innerHTML = '';

    m.grid = new BinaGrid('#' + containerId, {
      pageSize: 500, height: '100%', captions: captions
    });

    await m.grid.setData(rows, `Drill_${nextLevel}`, { own: true });

    if (!modalStack.includes(m)) {
      try { m.grid.destroy(); } catch (err) { console.warn(err); }
      m.grid = null;
      return;
    }

    // Only ledger document-number cells open the full accounting document.
    if (nextLevel === 'daftar') {
      m.grid.on('cellDblClick', (e) => {
        if (!modalStack.includes(m) || e?.field !== 'ShomarehSanad') return;
        const documentNumber = e.data?.ShomarehSanad;
        if (documentNumber === undefined || documentNumber === null || String(documentNumber).trim() === '') return;
        openSanadDocument(companyCode, fiscalYear, documentNumber);
      });
    }

    // Per-instance handlers only for balance drill-down windows; ledgers are terminal.
    if (nextLevel === 'moien' || nextLevel === 'tafsil') {
      const context = { companyCode, fiscalYear, docType };
      m.grid.on('cellDblClick', (e) => {
        if (modalStack.includes(m)) handleTarazCodeDblClick(e, context, nextLevel);
      });
    }

  } catch (err) {
    console.error(err);
    if (modalStack.includes(m)) {
      m.bodyEl.innerHTML = '<p style="color:red;padding:10px;">خطا: ' + err.message + '</p>';
    }
  }
}

// ==========================================
// ۵. رویدادهای اولیه (شروع به کار)
// نکته: رویدادها فقط یک‌بار و داخل DOMContentLoaded بسته می‌شوند؛
// بستن دوباره‌ی change باعث اجرای تکراری و هم‌زمان runTaraz می‌شد.
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  // ۱. وصل کردن رویدادها (بعد از اینکه HTML لود شد)
  const companyEl = document.getElementById('companyCode');
  const yearEl = document.getElementById('fiscalYear');

  if (companyEl) {
    companyEl.addEventListener('change', async (e) => {
      await loadYears(e.target.value);
      runTaraz();
    });
  }

  if (yearEl) {
    yearEl.addEventListener('change', () => {
      runTaraz();
    });
  }

  // Recalculate on any level or document-type change (single event binding).
  document.querySelectorAll('input[name="level"], input[name="docType"]').forEach(input => {
    input.addEventListener('change', () => { if (input.checked) runTaraz(); });
  });

  // ۲. شروع به کار
  await loadCompanies();
  runTaraz();
});

