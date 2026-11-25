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

        case 'daftarTafsil':
          result = await this._generateDaftarTafsil(params, metrics);
          break;

        case 'daftarMoienKol':
          result = await this._generateDaftarMoienKol(params, metrics);
          break;

        case 'daftarTafsilMoien':
          result = await this._generateDaftarTafsilMoien(params, metrics);
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
        Bedehkar: binaLedgerText(binaLedgerUnits(row.bedehkar)),
        Bestankar: binaLedgerText(binaLedgerUnits(row.bestankar)),
        Mandeh: 0,
        Vaziat: ''
      });
    }

    // Date first, then document number; Persian/Arabic digits and unpadded months
    // must not change chronological order. JS stable sort preserves line order
    // for multiple accounting entries in the same document.
    result.sort((a, b) => {
      const ta = binaLedgerDateKey(a.Tarikh), tb = binaLedgerDateKey(b.Tarikh);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return binaLedgerDocCompare(a.ShomarehSanad, b.ShomarehSanad);
    });

    // Debit is positive, credit is negative; display magnitude + status.
    // BIGINT balances remain exact even above Number.MAX_SAFE_INTEGER.
    let running = 0n;
    for (const r of result) {
      running += binaLedgerUnits(r.Bedehkar) - binaLedgerUnits(r.Bestankar);
      r.Mandeh = binaLedgerText(running < 0n ? -running : running);
      r.Vaziat = binaLedgerStatus(running);
    }

    metrics.phases.filterAndSort = { durationMs: performance.now() - t0, resultCount: result.length };
    if (result.length > 0) this._cache.results.set(daftarKey, result);

    return result;
  }
  /**
   * گردش معین‌های زیرمجموعه یک کل، به شکل یک دفتر مشترک.
   * فقط این نمای ویژه به جای مانده و وضعیت، کد و عنوان معین دارد.
   * سندها در سطح ردیف باقی می‌مانند؛ هیچ تجمیعی بین معین‌ها صورت نمی‌گیرد.
   */
  async _generateDaftarMoienKol(params, metrics) {
    const { companyCode, fiscalYear } = params;
    const docType = params.docType || 'all';
    const kolCode = params.filter?.KOl_Code;
    if (kolCode === undefined || kolCode === null || String(kolCode).trim() === '') {
      throw new Error('برای نمایش معین‌های دفتر کل، کد کل الزامی است.');
    }
    const cacheKey = `daftarMoienKol|${companyCode}|${fiscalYear}|${docType}|${binaAccountKey(kolCode)}`;
    const cached = this._cache.results.get(cacheKey);
    if (cached) {
      metrics.phases.cache = { durationMs: 0, hit: true };
      return cached.map(row => ({ ...row }));
    }

    let t0 = performance.now();
    const codingRows = await this._getCachedRows(companyCode, 'coding', null, metrics, 'codingLoad');
    const moienTitles = new Map();
    for (const c of codingRows) {
      if (binaAccountKey(c.kol_code) !== binaAccountKey(kolCode)) continue;
      const key = binaAccountKey(c.moien_code);
      if (key && !moienTitles.get(key) && c.moien_onvan) {
        moienTitles.set(key, String(c.moien_onvan));
      }
    }
    metrics.phases.codingIndex = { durationMs: performance.now() - t0, indexSize: moienTitles.size };

    t0 = performance.now();
    const sanadRows = await this._getCachedRows(companyCode, 'sanad', fiscalYear, metrics, 'sanadLoad');
    const excludedDocNumber = this._excludedDocumentNumber(sanadRows, docType);
    const result = [];
    for (const row of sanadRows) {
      if (binaAccountKey(row.kol_code) !== binaAccountKey(kolCode)) continue;
      if (excludedDocNumber !== null &&
          this._documentNumber(row.shomarehsanad) === excludedDocNumber) continue;

      const moienCode = row.moien_code === null || row.moien_code === undefined ? '' : String(row.moien_code);
      result.push({
        ShomarehSanad: row.shomarehsanad,
        Tarikh: row.tarikh,
        SharhSanad: row.sharhsanad,
        Bedehkar: binaLedgerText(binaLedgerUnits(row.bedehkar)),
        Bestankar: binaLedgerText(binaLedgerUnits(row.bestankar)),
        CodeMoien: moienCode,
        OnvanMoien: moienTitles.get(binaAccountKey(moienCode)) || String(row.moien_onvan || '')
      });
    }
    // First chronological date, then document number; preserve row order on ties.
    result.sort((a, b) => {
      const da = binaLedgerDateKey(a.Tarikh), db = binaLedgerDateKey(b.Tarikh);
      if (da !== db) return da < db ? -1 : 1;
      return binaLedgerDocCompare(a.ShomarehSanad, b.ShomarehSanad);
    });
    metrics.phases.filterAndSort = { durationMs: performance.now() - t0, resultCount: result.length };
    if (result.length) this._cache.results.set(cacheKey, result);
    return result;
  }
  /**
   * گردش تمام تفصیلی‌های زیرمجموعه یک معین در یک دفتر مشترک.
   * Unlike a ledger for one Tafsil, each document line identifies its own
   * Tafsil code and title; no running balance/status is shown here.
   * Both Kol and Moien are mandatory to prevent mixing similarly numbered
   * Moien accounts from different Kol groups.
   */
  async _generateDaftarTafsilMoien(params, metrics) {
    const { companyCode, fiscalYear } = params;
    const docType = params.docType || 'all';
    const kolCode = params.filter?.KOl_Code;
    const moienCode = params.filter?.Moien_Code;
    if (!binaAccountKey(kolCode) || !binaAccountKey(moienCode)) {
      throw new Error('برای گردش تفصیلی‌های معین، کد کل و معین الزامی است.');
    }

    const cacheKey = `daftarTafsilMoien|${companyCode}|${fiscalYear}|${docType}|${binaAccountKey(kolCode)}|${binaAccountKey(moienCode)}`;
    const cached = this._cache.results.get(cacheKey);
    if (cached) {
      metrics.phases.cache = { durationMs: 0, hit: true };
      return cached.map(row => ({ ...row }));
    }

    let t0 = performance.now();
    const codingRows = await this._getCachedRows(companyCode, 'coding', null, metrics, 'codingLoad');
    const tafsilTitles = new Map();
    for (const row of codingRows) {
      if (binaAccountKey(row.kol_code) !== binaAccountKey(kolCode) ||
          binaAccountKey(row.moien_code) !== binaAccountKey(moienCode)) continue;
      const key = binaAccountKey(row.tafsil_code);
      if (key && !tafsilTitles.get(key) && row.tafsil_onvan) {
        tafsilTitles.set(key, String(row.tafsil_onvan));
      }
    }
    metrics.phases.codingIndex = { durationMs: performance.now() - t0, indexSize: tafsilTitles.size };

    t0 = performance.now();
    const sanadRows = await this._getCachedRows(companyCode, 'sanad', fiscalYear, metrics, 'sanadLoad');
    const excludedDocNumber = this._excludedDocumentNumber(sanadRows, docType);
    const result = [];
    for (const row of sanadRows) {
      if (binaAccountKey(row.kol_code) !== binaAccountKey(kolCode) ||
          binaAccountKey(row.moien_code) !== binaAccountKey(moienCode)) continue;
      if (excludedDocNumber !== null &&
          this._documentNumber(row.shomarehsanad) === excludedDocNumber) continue;

      const tafsilCode = row.tafsil_code == null ? '' : String(row.tafsil_code);
      result.push({
        ShomarehSanad: row.shomarehsanad,
        Tarikh: row.tarikh,
        SharhSanad: row.sharhsanad,
        Bedehkar: binaLedgerText(binaLedgerUnits(row.bedehkar)),
        Bestankar: binaLedgerText(binaLedgerUnits(row.bestankar)),
        CodeTafsil: tafsilCode,
        OnvanTafsil: tafsilTitles.get(binaAccountKey(tafsilCode)) || String(row.tafsil_onvan || '')
      });
    }
    result.sort((a, b) => {
      const da = binaLedgerDateKey(a.Tarikh), db = binaLedgerDateKey(b.Tarikh);
      if (da !== db) return da < db ? -1 : 1;
      return binaLedgerDocCompare(a.ShomarehSanad, b.ShomarehSanad);
    });
    metrics.phases.filterAndSort = { durationMs: performance.now() - t0, resultCount: result.length };
    if (result.length) this._cache.results.set(cacheKey, result);
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

    // CodeHesab preserves Kol → Moien → Tafsil in the stored value.
    // The individual fields were intentionally removed from the displayed rows
    // above, so sorting by KOl_Code/Moien_Code/Tafsil_Code here is ineffective.
    // Compare the raw code segments numerically (without losing leading zeros).
    result.sort((a, b) => binaTarazCompareAccountCodes(a.CodeHesab, b.CodeHesab));

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

/* BINA ledgers: exact running balance and predictable date/document sorting.
   The stored account and document identifiers are never modified for display. */
const BINA_LEDGER_SCALE = 1000000n;
function binaLatinDigits(value) {
  return String(value ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660));
}
function binaLedgerUnits(value) {
  if (value == null || value === '') return 0n;
  const s = binaLatinDigits(value).trim().replace(/[,٬\s]/g, '').replace(/٫/g, '.').replace(/−/g, '-');
  const m = /^([+-]?)(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return 0n;
  const unit = BigInt(m[2]) * BINA_LEDGER_SCALE + BigInt((m[3] || '').padEnd(6, '0'));
  return m[1] === '-' ? -unit : unit;
}
function binaLedgerText(units) {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / BINA_LEDGER_SCALE;
  const frac = (abs % BINA_LEDGER_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + String(whole) + (frac ? '.' + frac : '');
}
// Compare numeric account identifiers without stripping their stored display format.
// For example, codes 083 and 83 refer to the same account for lookup purposes.
function binaAccountKey(value) {
  if (value == null) return '';
  const normalized = binaLatinDigits(value).trim();
  return /^\d+$/.test(normalized) ? BigInt(normalized).toString() : normalized;
}
// Natural ascending order for the raw hierarchical balance account code.
// A visible CodeHesab always stores Kol-Moien-Tafsil, regardless of the UI language.
// BigInt prevents codes larger than Number.MAX_SAFE_INTEGER from sorting incorrectly.
function binaTarazCompareAccountCodes(firstCode, secondCode) {
  const first = binaLatinDigits(firstCode).split(/\s*-\s*/);
  const second = binaLatinDigits(secondCode).split(/\s*-\s*/);
  const count = Math.max(first.length, second.length);
  for (let i = 0; i < count; i++) {
    const a = (first[i] || '').trim();
    const b = (second[i] || '').trim();
    if (a === b) continue;
    if (!a) return -1;
    if (!b) return 1;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
      const x = BigInt(a), y = BigInt(b);
      if (x !== y) return x < y ? -1 : 1;
      continue; // e.g. 002 and 2 are the same numeric code.
    }
    const cmp = a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
    if (cmp) return cmp;
  }
  return 0;
}
function binaLedgerNet(rows) {
  return (rows || []).reduce((amount, r) => amount + binaLedgerUnits(r.Bedehkar) - binaLedgerUnits(r.Bestankar), 0n);
}
function binaLedgerStatus(net) { return net > 0n ? 'بد' : net < 0n ? 'بس' : '—'; }
function binaLedgerDateKey(value) {
  const source = binaLatinDigits(value).trim();
  const pieces = source.split(/\D+/).filter(Boolean);
  if (pieces.length >= 3) {
    return pieces[0].padStart(4, '0') + pieces[1].padStart(2, '0') + pieces[2].padStart(2, '0') +
      pieces.slice(3).map(p => p.padStart(2, '0')).join('');
  }
  return source.replace(/\D/g, '');
}
function binaLedgerDocCompare(a, b) {
  const x = binaLatinDigits(a).trim(), y = binaLatinDigits(b).trim();
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
    const lx = BigInt(x), ly = BigInt(y);
    return lx < ly ? -1 : lx > ly ? 1 : 0;
  }
  return x.localeCompare(y, 'fa', { numeric: true });
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

function handleTarazCodeDblClick(e, context, currentLevel, sourceModal = null) {
  // Account-code drill-down is scoped to this page's BinaGrid instances.
  if (!context || e?.field !== 'CodeHesab' || !e.data?.CodeHesab) return;
  if (e.event?.target?.closest?.('.bina-selector-gutter,.bina-selector-corner,.bina-row-resizer')) return;

  // Opening another branch from an ancestor must not leave unrelated descendants
  // on screen. The selected ancestor itself stays open, with its layout intact.
  if (sourceModal) {
    if (!_closeDescendantsOf(sourceModal)) return;
  } else {
    closeAllModals();
  }

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
// This is NOT a single-Moien ledger: multiple Moien codes share one Kol report.
const DAFTAR_MOIEN_KOL_CAPTIONS = {
  ShomarehSanad: 'شماره سند', Tarikh: 'تاریخ', SharhSanad: 'شرح سند',
  Bedehkar: 'بدهکار', Bestankar: 'بستانکار',
  CodeMoien: 'کد حساب معین', OnvanMoien: 'عنوان حساب معین'
};

// In the special Moien breakdown, each ledger line belongs to one of the
// underlying Tafsil accounts (not one running-balance account).
const DAFTAR_TAFSIL_MOIEN_CAPTIONS = {
  ShomarehSanad: 'شماره سند', Tarikh: 'تاریخ', SharhSanad: 'شرح سند',
  Bedehkar: 'بدهکار', Bestankar: 'بستانکار',
  CodeTafsil: 'کد حساب تفصیل', OnvanTafsil: 'عنوان حساب تفصیل'
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

// Display order only: stored CodeHesab remains Kol-Moien-Tafsil for filtering.
// Persian / Arabic: Kol on the left, Moien middle, Tafsil right.
// English: Tafsil on the left, Moien middle, Kol right.
function tarazAccountLanguage() {
  let language = '';
  try { language = window.parent?.document?.documentElement?.lang || ''; } catch (_) {}
  if (!language) {
    try { language = localStorage.getItem('sidebarLanguage') || ''; } catch (_) {}
  }
  return language.toLowerCase().split('-')[0] === 'en' ? 'en' :
    language.toLowerCase().split('-')[0] === 'ar' ? 'ar' : 'fa';
}
function tarazDisplayAccountCode(value) {
  const segments = String(value ?? '').split('-').map(s => s.trim());
  if (tarazAccountLanguage() === 'en') segments.reverse();
  const visual = segments.join(' - ');
  const digits = tarazAccountLanguage() === 'en' ? '0123456789' :
    tarazAccountLanguage() === 'ar' ? '٠١٢٣٤٥٦٧٨٩' : '۰۱۲۳۴۵۶۷۸۹';
  return visual.replace(/[0-9۰-۹٠-٩]/g, c => {
    const d = c.charCodeAt(0);
    const n = d >= 48 && d <= 57 ? d - 48 :
      d >= 0x06f0 && d <= 0x06f9 ? d - 0x06f0 : d - 0x0660;
    return digits[n];
  });
}

// Shared account-code component for the GREEN cascade-window titles.
// Keep the visual order independent of the RTL title: in fa/ar the LEFTMOST
// segment is Kol, then Moien, then Tafsil; in en the order is reversed.
// The raw CodeHesab, filters, and user-selected column layout never change.
function setTarazDrillWindowTitle(titleEl, prefix, codeSegments, accountTitle = '', clickable = false) {
  const parts = (codeSegments || []).map(v => String(v ?? '').trim()).filter(Boolean);
  const codeEl = document.createElement(clickable ? 'button' : 'bdi');
  codeEl.className = 'taraz-title-account-code' + (clickable ? ' taraz-ledger-kol-code' : '');
  codeEl.dir = 'ltr';
  if (clickable) codeEl.type = 'button';
  codeEl.textContent = tarazDisplayAccountCode(parts.join(' - '));
  titleEl.replaceChildren(
    document.createTextNode(prefix + ' '),
    codeEl,
    ...(accountTitle ? [document.createTextNode(' — ' + accountTitle)] : [])
  );
  return codeEl;
}
async function installTarazAccountCodePresentation(view) {
  if (view._tarazCodePresentation) return;
  const column = view.table?.getColumn?.('CodeHesab');
  if (!column) return;
  const applyCode = cell => {
    const node = view.smart.cellFormatter(cell); // standard BinaGrid font/colors/bold
    node.textContent = tarazDisplayAccountCode(cell.getValue());
    node.style.direction = 'ltr';
    node.style.unicodeBidi = 'isolate';
    return node;
  };
  // Use the same numeric hierarchy when the user sorts the code column.
  await column.updateDefinition({ formatter: applyCode, sorter: binaTarazCompareAccountCodes });
  const refresh = () => {
    // Update currently rendered cells after a language change; the formatter
    // handles newly virtualized cells automatically during scrolling.
    for (const row of view.table?.getRows('visible') || []) {
      const cell = row.getCells().find(c => c.getField() === 'CodeHesab');
      if (!cell) continue;
      const node = cell.getElement()?.querySelector('.smart');
      if (!node) continue;
      const text = tarazDisplayAccountCode(cell.getValue());
      if (node.textContent !== text) node.textContent = text;
      node.style.direction = 'ltr';
      node.style.unicodeBidi = 'isolate';
    }
  };
  let frame = 0;
  const scheduleRefresh = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  };
  const parentRoot = (() => {
    try { return window.parent?.document?.documentElement; } catch (_) { return null; }
  })();
  const observer = parentRoot && window.MutationObserver ? new MutationObserver(scheduleRefresh) : null;
  observer?.observe(parentRoot, { attributes: true, attributeFilter: ['lang'] });
  window.addEventListener('storage', scheduleRefresh);
  view.table.on('renderComplete', scheduleRefresh);
  view._tarazCodePresentation = () => {
    observer?.disconnect();
    window.removeEventListener('storage', scheduleRefresh);
    view.table?.off('renderComplete', scheduleRefresh);
    if (frame) cancelAnimationFrame(frame);
  };
  scheduleRefresh();
}

// Account segments are visual-only; do not override a saved user alignment.
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
        await installTarazAccountCodePresentation(view);
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
      // Always open each balance level in ascending account-code order,
      // even if a sort on another column was saved in this shared grid.
      view.table.setSort('CodeHesab', 'asc');
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
// ۳. پنجره‌های شناور و غیرمسدودکننده Drill-down
//    - no backdrops, blur or dimming of ancestor grids
//    - cascade exposes each ancestor's title bar (Access-style)
//    - title-bar drag, focus/bring-to-front, viewport-safe placement
//    - closing an ancestor closes only its dependent descendants
//    All behavior is private to Bina-15-8.js, not the shared BinaGrid.
// ==========================================
let modalSeq = 0;
let modalFocusSeq = 0;
const modalStack = [];
// Main shell is a different document (the page lives in an iframe).
// Lock only shell navigation, never the in-page grids or floating windows.
function _syncShellDrillNavigation() {
  if (window.parent === window) return;
  try {
    if (window.parent.BinaDrillNavigationLock?.setLocked) {
      window.parent.BinaDrillNavigationLock.setLocked(modalStack.length > 0, window);
      return;
    }
    window.parent.postMessage({ type: 'bina:drill-navigation-state', open: modalStack.length > 0 }, '*');
  } catch (_) { /* standalone/local preview: no shell to lock */ }
}
window.addEventListener('pagehide', () => {
  try { window.parent?.BinaDrillNavigationLock?.setLocked(false, window); } catch (_) {}
});
const DRILL_Z_BASE = 9000;
const _clampModal = (value, low, high) => Math.max(low, Math.min(value, high));

function _defaultModalRect(depth) {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const edgeX = _clampModal(Math.round(vw * .015), 8, 22);
  const edgeY = _clampModal(Math.round(vh * .020), 8, 20);
  const stepX = _clampModal(Math.round(vw * .037), 30, 58);
  const stepY = _clampModal(Math.round(vh * .045), 28, 42);
  // Keep the top level nearly full-screen while retaining readable ancestor
  // title strips (and enough room for a child window on narrower displays).
  const left = Math.min(edgeX + depth * stepX, Math.max(edgeX, vw - 300));
  const top = Math.min(edgeY + depth * stepY, Math.max(edgeY, vh - 220));
  return {
    left, top,
    width: Math.max(1, vw - left - edgeX),
    height: Math.max(1, vh - top - edgeY)
  };
}

function _setModalRect(m, rect) {
  m.box.style.left = Math.round(rect.left) + 'px';
  m.box.style.top = Math.round(rect.top) + 'px';
  m.box.style.width = Math.round(rect.width) + 'px';
  m.box.style.height = Math.round(rect.height) + 'px';
}

function _syncModalFocus() {
  const ordered = modalStack.slice().sort((a, b) => a.focusOrder - b.focusOrder);
  ordered.forEach((m, i) => {
    m.overlay.style.zIndex = String(DRILL_Z_BASE + i * 3);
    m.box.classList.toggle('is-active', i === ordered.length - 1);
  });
}

function _focusModal(m) {
  if (!modalStack.includes(m)) return;
  m.focusOrder = ++modalFocusSeq;
  _syncModalFocus();
}

function _layoutModalStack() {
  modalStack.forEach((m, i) => {
    if (!m.manuallyMoved) {
      _setModalRect(m, _defaultModalRect(i));
      return;
    }
    // Preserve the position selected by the user on resize, but don't let a
    // floating window disappear beyond the viewport after a resize.
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const width = Math.min(m.box.offsetWidth || vw - 16, Math.max(1, vw - 16));
    const height = Math.min(m.box.offsetHeight || vh - 16, Math.max(1, vh - 16));
    _setModalRect(m, {
      left: _clampModal(m.box.offsetLeft, 8, Math.max(8, vw - width - 8)),
      top: _clampModal(m.box.offsetTop, 8, Math.max(8, vh - height - 8)),
      width, height
    });
  });
  _syncModalFocus();
}

// A press on the header is NOT immediately a drag. Capturing the pointer and
// calling preventDefault on the first press prevented browsers from delivering
// a reliable double-click to the Kol account code in the title.
// Move the pointer >= 6px before starting a drag; clicks remain untouched.
// A Kol ledger title is NEVER draggable; only the neighboring explicit handle
// (or a non-drill title in another modal) can move the window.
function _makeModalDraggable(m) {
  const header = m.box.querySelector('.modal-header');
  const DRAG_THRESHOLD = 6;
  let pending = null;

  const removeTracking = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopTracking);
    window.removeEventListener('pointercancel', stopTracking);
  };

  function stopTracking(ev) {
    if (!pending || pending.id !== ev.pointerId) return;
    pending = null;
    m.box.classList.remove('is-dragging');
    removeTracking();
  }

  function onPointerMove(ev) {
    if (!pending || pending.id !== ev.pointerId) return;
    const dx = ev.clientX - pending.x;
    const dy = ev.clientY - pending.y;
    if (!pending.started) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      pending.started = true;
      m.box.classList.add('is-dragging');
    }
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const left = _clampModal(pending.left + dx,
      8, Math.max(8, vw - m.box.offsetWidth - 8));
    const top = _clampModal(pending.top + dy,
      8, Math.max(8, vh - m.box.offsetHeight - 8));
    m.box.style.left = Math.round(left) + 'px';
    m.box.style.top = Math.round(top) + 'px';
    m.manuallyMoved = true;
    if (ev.cancelable) ev.preventDefault();
  }

  header.addEventListener('pointerdown', ev => {
    // Code and its entire green title are a drill target, NEVER a drag handle.
    // The explicit drag handle remains usable even in Kol-ledger windows.
    if (ev.button !== 0 || !ev.isPrimary ||
        ev.target.closest('.is-kol-drill-title, button:not(.modal-drag-handle), a, input, select, textarea')) return;
    _focusModal(m);
    if (pending) removeTracking();
    pending = { id: ev.pointerId, x: ev.clientX, y: ev.clientY,
      left: m.box.offsetLeft, top: m.box.offsetTop, started: false };
    // Do NOT preventDefault or capture the pointer on a simple press: native
    // click/dblclick must still reach the account-code trigger.
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', stopTracking);
    window.addEventListener('pointercancel', stopTracking);
  });

  // A window can be destroyed while dragging; discard any outstanding state.
  m.stopDragging = () => {
    pending = null;
    m.box.classList.remove('is-dragging');
    removeTracking();
  };
}

function _createModal(levelKey) {
  modalSeq += 1;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  if (levelKey) overlay.dataset.level = levelKey;
  overlay.innerHTML =
    '<section class="modal-box" role="dialog" aria-modal="false" aria-labelledby="modalTitle_' + modalSeq + '">' +
      '<div class="modal-header">' +
        '<h3 class="modal-title" id="modalTitle_' + modalSeq + '">جزئیات</h3>' +
        '<button type="button" class="modal-drag-handle" title="برای جابه‌جایی پنجره، این دستگیره را بکشید" aria-label="جابه‌جایی پنجره با موس">' +
          '<span aria-hidden="true">⠿</span><span class="modal-drag-label">جابه‌جایی</span>' +
        '</button>' +
        '<button type="button" class="modal-close" title="بستن این سطح (Esc)" aria-label="بستن پنجره">✕</button>' +
      '</div>' +
      '<div class="modal-body" id="modalBody_' + modalSeq + '"></div>' +
    '</section>';

  const m = {
    seq: modalSeq, overlay,
    box: overlay.querySelector('.modal-box'),
    titleEl: overlay.querySelector('.modal-title'),
    bodyEl: overlay.querySelector('.modal-body'),
    focusOrder: 0,
    manuallyMoved: false,
    grid: null
  };

  overlay.querySelector('.modal-close').addEventListener('click', (ev) => {
    ev.stopPropagation();
    _closeModal(m);
  });
  m.box.addEventListener('pointerdown', () => _focusModal(m));
  _makeModalDraggable(m);

  // No backdrop-click close: other windows and the parent report stay usable.
  document.body.appendChild(overlay);
  modalStack.push(m);
  _syncShellDrillNavigation();
  _focusModal(m);
  _layoutModalStack();
  return m;
}

// Closing a level closes its descendants but not any ancestor.
function _closeModal(target) {
  const idx = modalStack.indexOf(target);
  if (idx === -1) return;
  while (modalStack.length > idx) {
    const m = modalStack.pop();
    m.stopDragging?.();
    if (m.grid) {
      try { m.grid._tarazCodePresentation?.(); } catch (_) {}
      try { m.grid.destroy(); } catch (err) { console.warn(err); }
      m.grid = null;
    }
    m.overlay.remove();
  }
  if (modalStack.length) _focusModal(modalStack[modalStack.length - 1]);
  _syncShellDrillNavigation();
  _layoutModalStack();
}

function _closeDescendantsOf(parent) {
  const idx = modalStack.indexOf(parent);
  if (idx < 0) return false;
  if (modalStack.length > idx + 1) _closeModal(modalStack[idx + 1]);
  return true;
}

function closeAllModals() {
  while (modalStack.length) _closeModal(modalStack[0]);
}

window.addEventListener('resize', _layoutModalStack);

// Escape closes the currently foremost floating window, unless another
// control such as the column manager has its own open dialog.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !modalStack.length || ev.defaultPrevented) return;
  if (document.querySelector('.bina-cm.open')) return;
  ev.preventDefault();
  const front = modalStack.reduce((best, m) => m.focusOrder > best.focusOrder ? m : best);
  _closeModal(front);
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
  const url = new URL('./tab-15-1.html', window.location.href);
  url.searchParams.set('companyCode', String(companyCode));
  url.searchParams.set('fiscalYear', String(fiscalYear));
  url.searchParams.set('documentNumber', String(documentNumber));
  frame.src = url.href;
  m.bodyEl.appendChild(frame);
}

// The standard BinaGrid sums every numeric column. In ledgers, the final
// balance is NOT the sum of balances: it is SUM(debit) - SUM(credit).
// Override only this ledger instance (not the global BinaGrid component).
async function configureBinaLedgerSummary(view, rows) {
  const table = view?.table;
  if (!table) return;
  const calcRows = data => Array.isArray(data) ? data : rows;
  const balance = (_values, data) => {
    const net = binaLedgerNet(calcRows(data));
    return binaLedgerText(net < 0n ? -net : net);
  };
  const status = (_values, data) => binaLedgerStatus(binaLedgerNet(calcRows(data)));
  const definitions = [
    ['Mandeh', { bottomCalc: balance, bottomCalcFormatter: view.makeBottomCalcFormatter('Mandeh') }],
    ['Vaziat', { bottomCalc: status, bottomCalcFormatter: 'plaintext' }],
    ['SharhSanad', { bottomCalc: () => 'جمع:' , bottomCalcFormatter: 'plaintext' }]
  ];
  for (const [field, definition] of definitions) {
    const column = table.getColumn(field);
    if (column) await column.updateDefinition(definition);
  }
  // Keep date/document sorting fixed. Otherwise clicking a header could make
  // the running balance appear unrelated to the visible transaction sequence.
  for (const column of table.getColumns()) {
    if (column.getField()) await column.updateDefinition({ headerSort: false });
  }
  // A sort saved by a previous version must not override chronological order.
  await Promise.resolve(table.clearSort());
}

// The Kol identifier INSIDE the green "دفتر کل" title (not the floating
// window's generic header) is a dedicated, keyboard-accessible drill target.
// It must never start a title-bar drag. All events stay scoped to BinaTaraz.
// Ledger Kol code in the GREEN title bar. The whole title is also a forgiving
// double-click hit area: users sometimes click the title text next to the code.
// Handler is page-scoped; other grid instances never acquire this behaviour.
function installKolLedgerTitleDrill(modal, kolCode, kolTitle, companyCode, fiscalYear, docType) {
  modal.titleEl.replaceChildren();
  modal.titleEl.classList.add('is-kol-drill-title');
  modal.titleEl.setAttribute('title', 'روی کد حساب دابل‌کلیک کنید تا گردش معین‌ها باز شود');
  const trigger = setTarazDrillWindowTitle(modal.titleEl, 'دفتر کل:',
    [kolCode], kolTitle, true);
  trigger.setAttribute('aria-label', 'باز کردن گردش معین‌های کل ' + kolCode + ' با دابل‌کلیک');
  trigger.title = 'برای باز کردن گردش معین‌های کل ' + kolCode + ' دابل‌کلیک کنید';

  let activationInProgress = false;
  function activate(ev) {
    ev?.stopPropagation();
    ev?.preventDefault();
    if (activationInProgress || !modalStack.includes(modal)) return;
    activationInProgress = true;
    _focusModal(modal);
    if (_closeDescendantsOf(modal)) {
      Promise.resolve(openKolMoienBreakdown(kolCode, kolTitle, companyCode, fiscalYear, docType))
        .catch(err => console.error('[BinaTaraz] باز کردن گردش معین‌ها:', err))
        .finally(() => { activationInProgress = false; });
    } else {
      activationInProgress = false;
    }
  }
  // On the entire green title, not on its floating-window frame. Since the
  // drag handler starts only after true movement, native dblclick now arrives.
  modal.titleEl.addEventListener('dblclick', activate);
  trigger.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
  });
}

// Moien ledger heading uses the same independent double-click target as
// the Kol ledger heading. The draggable region explicitly excludes this title.
function installMoienLedgerTitleDrill(modal, kolCode, moienCode, moienTitle, companyCode, fiscalYear, docType) {
  modal.titleEl.replaceChildren();
  modal.titleEl.classList.add('is-kol-drill-title'); // reusable interactive title/drag exclusion
  modal.titleEl.title = 'روی کد حساب معین دابل‌کلیک کنید تا گردش تفصیلی‌ها باز شود';
  const trigger = setTarazDrillWindowTitle(modal.titleEl, 'دفتر معین:',
    [kolCode, moienCode], moienTitle, true);
  trigger.setAttribute('aria-label', `باز کردن گردش تفصیلی‌های معین ${moienCode} با دابل‌کلیک`);
  trigger.title = `برای باز کردن گردش تفصیلی‌های معین ${moienCode} دابل‌کلیک کنید`;

  let busy = false;
  function activate(ev) {
    ev?.stopPropagation();
    ev?.preventDefault();
    if (busy || !modalStack.includes(modal)) return;
    busy = true;
    _focusModal(modal);
    if (_closeDescendantsOf(modal)) {
      Promise.resolve(openMoienTafsilBreakdown(kolCode, moienCode, moienTitle, companyCode, fiscalYear, docType))
        .catch(err => console.error('[BinaTaraz] باز کردن گردش تفصیلی‌ها:', err))
        .finally(() => { busy = false; });
    } else {
      busy = false;
    }
  }
  modal.titleEl.addEventListener('dblclick', activate);
  trigger.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
  });
}

// Details of every Moien within the selected Kol, without a running balance.
// Clicking an individual Moien code opens its original, single-account ledger.
async function openKolMoienBreakdown(kolCode, kolTitle, companyCode, fiscalYear, docType = 'all') {
  const m = _createModal('daftarMoienKol');
  setTarazDrillWindowTitle(m.titleEl, 'گردش معین‌های کل', [kolCode], kolTitle);
  m.bodyEl.innerHTML = '<div class="modal-loading">در حال بارگذاری…</div>';
  try {
    const rows = await engine.execute({
      reportType: 'daftarMoienKol', companyCode, fiscalYear,
      filter: { KOl_Code: kolCode }, docType
    });
    if (!modalStack.includes(m)) return;
    if (!rows.length) {
      m.bodyEl.innerHTML = '<div class="modal-loading">گردشی برای معین‌های این حساب کل یافت نشد.</div>';
      return;
    }
    m.bodyEl.replaceChildren();
    m.grid = new BinaGrid('#modalBody_' + m.seq, {
      pageSize: 500, height: '100%', captions: DAFTAR_MOIEN_KOL_CAPTIONS
    });
    await m.grid.setData(rows, 'Drill_DaftarMoienKol', { own: true });
    if (!modalStack.includes(m)) {
      m.grid.destroy();
      m.grid = null;
      return;
    }
    await configureBinaLedgerBreakdown(m.grid);
    m.grid.on('cellDblClick', e => {
      if (!modalStack.includes(m) || !e?.data) return;
      if (e.field === 'ShomarehSanad') {
        const docNumber = e.data.ShomarehSanad;
        if (docNumber == null || String(docNumber).trim() === '') return;
        _closeDescendantsOf(m);
        openSanadDocument(companyCode, fiscalYear, docNumber);
      } else if (e.field === 'CodeMoien') {
        const moienCode = e.data.CodeMoien;
        if (moienCode == null || String(moienCode).trim() === '') return;
        _closeDescendantsOf(m);
        openDrillDown({
          CodeHesab: `${kolCode} - ${moienCode}`,
          OnvanHesab: e.data.OnvanMoien || ''
        }, 'daftar', companyCode, fiscalYear, docType);
      }
    });
  } catch (err) {
    console.error('[BinaTaraz] دفتر معین‌های کل:', err);
    if (modalStack.includes(m)) {
      m.bodyEl.textContent = 'خطا در نمایش گردش معین‌ها: ' + (err?.message || 'نامشخص');
      m.bodyEl.classList.add('taraz-modal-error');
    }
  }
}

// All Tafsil document lines under one Moien. CodeTafsil double-click
// opens the existing single-Tafsil ledger; document-number double-click opens
// the full accounting document. No handlers leak to the global BinaGrid.
async function openMoienTafsilBreakdown(kolCode, moienCode, moienTitle, companyCode, fiscalYear, docType = 'all') {
  const m = _createModal('daftarTafsilMoien');
  setTarazDrillWindowTitle(m.titleEl, 'گردش تفصیلی‌های معین',
    [kolCode, moienCode], moienTitle);
  m.bodyEl.innerHTML = '<div class="modal-loading">در حال بارگذاری…</div>';
  try {
    const rows = await engine.execute({
      reportType: 'daftarTafsilMoien', companyCode, fiscalYear,
      filter: { KOl_Code: kolCode, Moien_Code: moienCode }, docType
    });
    if (!modalStack.includes(m)) return;
    if (!rows.length) {
      m.bodyEl.innerHTML = '<div class="modal-loading">گردشی برای تفصیلی‌های این حساب معین یافت نشد.</div>';
      return;
    }
    m.bodyEl.replaceChildren();
    m.grid = new BinaGrid('#modalBody_' + m.seq, {
      pageSize: 500, height: '100%', captions: DAFTAR_TAFSIL_MOIEN_CAPTIONS
    });
    await m.grid.setData(rows, 'Drill_DaftarTafsilMoien', { own: true });
    if (!modalStack.includes(m)) {
      m.grid.destroy();
      m.grid = null;
      return;
    }
    await configureBinaLedgerBreakdown(m.grid);
    m.grid.on('cellDblClick', e => {
      if (!modalStack.includes(m) || !e?.data) return;
      if (e.field === 'ShomarehSanad') {
        const documentNumber = e.data.ShomarehSanad;
        if (documentNumber == null || String(documentNumber).trim() === '') return;
        _closeDescendantsOf(m);
        openSanadDocument(companyCode, fiscalYear, documentNumber);
      } else if (e.field === 'CodeTafsil') {
        const tafsilCode = e.data.CodeTafsil;
        if (tafsilCode == null || String(tafsilCode).trim() === '') return;
        _closeDescendantsOf(m);
        openDrillDown({
          CodeHesab: `${kolCode} - ${moienCode} - ${tafsilCode}`,
          OnvanHesab: e.data.OnvanTafsil || ''
        }, 'daftar', companyCode, fiscalYear, docType);
      }
    });
  } catch (err) {
    console.error('[BinaTaraz] دفتر تفصیلی‌های معین:', err);
    if (modalStack.includes(m)) {
      m.bodyEl.textContent = 'خطا در نمایش گردش تفصیلی‌ها: ' + (err?.message || 'نامشخص');
      m.bodyEl.classList.add('taraz-modal-error');
    }
  }
}

async function configureBinaLedgerBreakdown(view) {
  if (!view?.table) return;
  const description = view.table.getColumn('SharhSanad');
  if (description) await description.updateDefinition({
    bottomCalc: () => 'جمع:', bottomCalcFormatter: 'plaintext'
  });
  // Code and title are identifiers/text; never sum or format them as financials.
  for (const column of view.table.getColumns()) {
    if (column.getField()) await column.updateDefinition({ headerSort: false });
  }
  await Promise.resolve(view.table.clearSort());
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

  let titlePrefix = '';
  let reportType = 'taraz';

  if (nextLevel === 'daftar') {
    // نام دفتر بر اساس عمق کد حساب: ۱ بخش = کل، ۲ بخش = معین، ۳ بخش = تفصیل
    const ledgerLabel = parts.length === 1 ? 'دفتر کل' :
      (parts.length === 2 ? 'دفتر معین' : 'دفتر تفصیل');
    titlePrefix = `${ledgerLabel}:`;
    reportType = 'daftarTafsil';
  } else {
    titlePrefix = `تراز ${nextLevel === 'moien' ? 'معین' : 'تفصیلی'} —`;
  }

  // مودال جدید روی مودال فعلی باز می‌شود (سطح قبلی زیر آن باقی می‌ماند)
  const m = _createModal(nextLevel);
  if (nextLevel === 'daftar' && parts.length === 1) {
    installKolLedgerTitleDrill(m, parts[0], parentRow.OnvanHesab,
      companyCode, fiscalYear, docType);
  } else if (nextLevel === 'daftar' && parts.length === 2) {
    installMoienLedgerTitleDrill(m, parts[0], parts[1], parentRow.OnvanHesab,
      companyCode, fiscalYear, docType);
  } else {
    setTarazDrillWindowTitle(m.titleEl, titlePrefix, parts, parentRow.OnvanHesab);
  }

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
    if (nextLevel === 'daftar') await configureBinaLedgerSummary(m.grid, rows);
    else {
      await installTarazAccountCodePresentation(m.grid);
      m.grid.table.setSort('CodeHesab', 'asc');
    }

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
        _closeDescendantsOf(m);
        openSanadDocument(companyCode, fiscalYear, documentNumber);
      });
    }

    // Per-instance handlers only for balance drill-down windows; ledgers are terminal.
    if (nextLevel === 'moien' || nextLevel === 'tafsil') {
      const context = { companyCode, fiscalYear, docType };
      m.grid.on('cellDblClick', (e) => {
        if (modalStack.includes(m)) handleTarazCodeDblClick(e, context, nextLevel, m);
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

