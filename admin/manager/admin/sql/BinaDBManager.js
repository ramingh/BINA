/**
 * BINA Database Manager
 * نسخه: 1.0.0
 * 
 * مسئولیت:
 * - مدیریت اتصال به دیتابیس‌های IndexedDB (public + شرکت‌ها)
 * - خواندن Schema از public/columns
 * - خواندن متادیتا از public/catalog
 * - استخراج هدفمند بلوک‌های فشرده بر اساس CompanyCode و FiscalYear
 */

(function (global) {
  'use strict';

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
     * خواندن متادیتا از public/catalog
     * @param {string|number} companyCode - کد شرکت
     * @param {string} family - 'sanad' یا 'coding'
     * @param {number} [year] - سال مالی (فقط برای sanad)
     * @returns {Promise<Object>}
     */
    async getCatalog(companyCode, family, year = null) {
      const db = await this.openPublicDb();
      const storeName = 'catalog';

      if (!db.objectStoreNames.contains(storeName)) {
        throw new Error(`استور ${storeName} در دیتابیس public وجود ندارد.`);
      }

      // ساخت کلید catalog
      const key = year 
        ? `${family.toLowerCase()}_${year}_${companyCode}`
        : `${family.toLowerCase()}_${companyCode}`;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const record = request.result;

          if (!record) {
            reject(new Error(`متادیتای ${key} در public/catalog یافت نشد.`));
            return;
          }

          resolve(record);
        };

        request.onerror = (event) => {
          reject(new Error(`خطا در خواندن catalog: ${event.target.error}`));
        };
      });
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
     * @returns {Promise<{columns: Array, blocks: Uint8Array[], catalog: Object}>}
     */
    async getReadyData(companyCode, family, year = null) {
      try {
        // ۱. خواندن ستون‌ها
        const columns = await this.getColumns(family);
        this.logger.log(`📋 ${columns.length} ستون از public/columns خوانده شد.`);

        // ۲. خواندن متادیتا (اختیاری - برای اطلاعات تکمیلی)



        
        // let catalog = null;
        // try {
        //   catalog = await this.getCatalog(companyCode, family, year);
        //   this.logger.log(`📊 متادیتا از public/catalog خوانده شد: ${catalog.serverCount || 0} رکورد`);
        // } catch (error) {
        //   this.logger.warn(`⚠️ متادیتا یافت نشد: ${error.message}`);
        // }

        // ۳. استخراج بلوک‌های فشرده
        const blocks = await this.getCompressedBlocks(companyCode, family, year);

        return {
          columns,
          blocks,
          // catalog,
          companyCode: String(companyCode),
          family: family.toLowerCase(),
          year
        };

      } catch (error) {
        this.logger.error('❌ خطا در getReadyData:', error);
        throw error;
      }
    }

    /**
     * بستن تمام دیتابیس‌های باز شده
     */
    closeAll() {
      this.databases.forEach((db, name) => {
        db.close();
        this.logger.log(`🔒 دیتابیس ${name} بسته شد.`);
      });
      this.databases.clear();
    }

    /**
     * بستن یک دیتابیس خاص
     * @param {string} dbName
     */
    closeDb(dbName) {
      if (this.databases.has(dbName)) {
        const db = this.databases.get(dbName);
        db.close();
        this.databases.delete(dbName);
        this.logger.log(`🔒 دیتابیس ${dbName} بسته شد.`);
      }
    }
  }

  // Browser global
  global.BinaDBManager = BinaDBManager;

  // CommonJS / Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BinaDBManager;
  }

})(typeof window !== 'undefined' ? window : globalThis);