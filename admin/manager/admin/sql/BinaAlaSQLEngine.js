/**
 * BINA AlaSQL Engine
 * نسخه: 1.0.0
 * 
 * مسئولیت:
 * - ثبت داده‌های باز شده در AlaSQL به عنوان جداول موقت
 * - اجرای کوئری‌های SQL (شامل JOIN, SUM, GROUP BY, CASE WHEN)
 * - پاکسازی حافظه پس از اتمام کار
 */

(function (global) {
  'use strict';

  class BinaAlaSQLEngine {
    constructor(options = {}) {
      this.alasql = options.alasql || global.alasql;

      if (!this.alasql) {
        throw new Error(
          'کتابخانه AlaSQL بارگذاری نشده است. قبل از BinaAlaSQLEngine.js باید alasql.min.js را اضافه کنید.'
        );
      }

      this.registeredTables = new Set(); // ردیابی جداول ثبت شده برای پاکسازی
      this.logger = options.logger || console;
      
      // تنظیمات بهینه‌سازی AlaSQL
      this.alasql.options.autocommit = true;
    }

    /**
     * ثبت یک آرایه داده به عنوان جدول موقت در AlaSQL
     * @param {string} tableName - نام جدول (مثلاً 'TempSanad_1395_1100')
     * @param {Object[]} data - آرایه اشیاء (خروجی DataDecompressor)
     */
    registerTempTable(tableName, data) {
      if (!tableName || typeof tableName !== 'string') {
        throw new Error('نام جدول معتبر نیست.');
      }

      if (!Array.isArray(data)) {
        throw new Error('داده باید آرایه باشد.');
      }

      // اگر جدول قبلاً وجود دارد، حذفش کن
      if (this.registeredTables.has(tableName)) {
        this.dropTempTable(tableName);
      }

      // ثبت در AlaSQL
      this.alasql(`CREATE TABLE ${tableName}`);
      this.alasql.tables[tableName].data = data;
      this.alasql.tables[tableName].columns = this._extractColumns(data);
      
      this.registeredTables.add(tableName);
      this.logger.log(`✅ جدول موقت ${tableName} با ${data.length.toLocaleString()} ردیف ثبت شد.`);
    }

    /**
     * اجرای کوئری SQL
     * @param {string} sql - رشته کوئری SQL
     * @param {Object} [params] - پارامترهای کوئری (اختیاری)
     * @returns {Promise<any>} نتیجه کوئری
     */
    async executeQuery(sql, params = {}) {
      if (!sql || typeof sql !== 'string') {
        throw new Error('کوئری SQL معتبر نیست.');
      }

      try {
        this.logger.log(`⏳ در حال اجرای کوئری...`);
        const startTime = Date.now();

        // اجرای کوئری
        const result = this.alasql(sql, params);

        const elapsed = Date.now() - startTime;
        this.logger.log(`✅ کوئری در ${elapsed}ms اجرا شد. ${Array.isArray(result) ? result.length : 0} ردیف برگشت.`);

        return result;

      } catch (error) {
        this.logger.error('❌ خطا در اجرای کوئری:', error.message);
        throw new Error(`خطای SQL: ${error.message}\n\nکوئری: ${sql}`);
      }
    }

    /**
     * حذف یک جدول موقت از حافظه
     * @param {string} tableName - نام جدول
     */
    dropTempTable(tableName) {
      if (this.registeredTables.has(tableName)) {
        try {
          if (this.alasql.tables[tableName]) {
            this.alasql.tables[tableName].data = null;
            delete this.alasql.tables[tableName];
          }
          this.alasql(`DROP TABLE IF EXISTS ${tableName}`);
          this.registeredTables.delete(tableName);
          this.logger.log(`🗑️ جدول موقت ${tableName} حذف شد.`);
        } catch (error) {
          this.logger.warn(`⚠️ خطا در حذف جدول ${tableName}:`, error.message);
        }
      }
    }

    /**
     * حذف تمام جداول موقت (پاکسازی کامل حافظه)
     */
    dropAllTempTables() {
      const tables = Array.from(this.registeredTables);
      tables.forEach(tableName => this.dropTempTable(tableName));
      this.logger.log(`🧹 تمام جداول موقت پاک شدند.`);
    }

    /**
     * لیست جداول موقت ثبت شده
     * @returns {string[]}
     */
    listTables() {
      return Array.from(this.registeredTables);
    }

    /**
     * بررسی وجود یک جدول
     * @param {string} tableName
     * @returns {boolean}
     */
    hasTable(tableName) {
      return this.registeredTables.has(tableName);
    }

    /**
     * استخراج ستون‌ها از داده (برای ثبت در AlaSQL)
     * @private
     */
    _extractColumns(data) {
      if (!data || data.length === 0) return [];
      
      const firstRow = data[0];
      return Object.keys(firstRow).map(key => ({
        columnid: key,
        dbtypeid: typeof firstRow[key]
      }));
    }
  }

  // Browser global
  global.BinaAlaSQLEngine = BinaAlaSQLEngine;

  // CommonJS / Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BinaAlaSQLEngine;
  }

})(typeof window !== 'undefined' ? window : globalThis);