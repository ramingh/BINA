/**
 * BINA DataDecompressor - نسخه اصلاح شده (Fixed)
 * 
 * تغییرات اصلی:
 * 1. فرض اولیه: rows شامل ستون‌های کلیدی (Id, CompanyCode, FiscalYear) نیستند.
 * 2. استخراج کلیدها از آرایه ids انجام می‌شود و به آبجکت اضافه می‌گردد.
 * 3. نگاشت ستون‌ها فقط برای داده‌های غیرکلیدی انجام می‌شود.
 */

(function (global) {
  'use strict';

  class DataDecompressor {
    constructor(options = {}) {
      this.pako = options.pako || global.pako;
      
      if (!this.pako && typeof require === 'function') {
        try { this.pako = require('pako'); } catch (_) {}
      }

      if (!this.pako) {
        throw new Error('کتابخانه pako بارگذاری نشده است.');
      }

      this.options = {
        maxRows: options.maxRows ?? 250000,
        castTypes: options.castTypes ?? true,
        attachKeyFields: options.attachKeyFields ?? true,
        logger: options.logger ?? console
      };

      this.decoder = new TextDecoder('utf-8');
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

      for (let blockIndex = 0; blockIndex < compressedBlocks.length; blockIndex++) {
        const inputBlock = compressedBlocks[blockIndex];
        const data = await this.inflateSingleBlock(inputBlock, opts);

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
            this._attachKeys(obj, idItem, opts);
          }

          // ۳. نگاشت داده‌های ردیف به ستون‌های باقی‌مانده
          // فرض: طول rawRow برابر با تعداد ستون‌های غیرکلیدی است
          for (let i = 0; i < dataColDefs.length; i++) {
            const colDef = dataColDefs[i];
            const value = rawRow[i];
            
            obj[colDef.name] = opts.castTypes 
              ? this._castValue(value, colDef.type) 
              : value;
          }

          result.push(obj);
        }
        
        // آزادسازی حافظه بلوک
        if (opts.releaseInputBlocks) compressedBlocks[blockIndex] = null;
      }

      return result;
    }

    async inflateSingleBlock(compressedBlock, options = {}) {
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

    _attachKeys(obj, idItem, opts) {
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

    _castValue(value, type) {
      if (value === null || value === undefined) return null;
      const t = type.toLowerCase();
      if (t.includes('int') || t.includes('decimal') || t.includes('money')) {
        const n = Number(value);
        return isNaN(n) ? value : n;
      }
      return value;
    }

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

  global.DataDecompressor = DataDecompressor;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataDecompressor;
  }

})(typeof window !== 'undefined' ? window : globalThis);