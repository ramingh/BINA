/* Bina-10-1.js — فهرست شرکت‌ها در گرید استاندارد BINA، بدون تغییر در بانک اطلاعاتی. */
(function () {
  'use strict';

  const captions = {
    Radif: 'ردیف',
    CodeSherkat: 'کد شرکت',
    EsmSherkat: 'نام شرکت',
    NoeSherkat: 'نوع شرکت',
    Id: 'شناسه'
  };
  const columns = {
    Radif: { width: 90 },
    CodeSherkat: { width: 140 },
    EsmSherkat: { width: 370 },
    NoeSherkat: { width: 165 },
    Id: { width: 120 }
  };
  const status = document.getElementById('companies-status');
  let grid = null;

  function getField(row, name) {
    if (!row || typeof row !== 'object') return '';
    if (row[name] !== undefined) return row[name];
    const lowerName = name.toLowerCase();
    const found = Object.keys(row).find(key => key.toLowerCase() === lowerName);
    return found === undefined ? '' : row[found];
  }

  function asText(value) { return value == null ? '' : String(value); }

  async function existingPublicDatabaseName() {
    // When available, inspect names first: opening an unknown DB must not create it.
    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      const match = databases.find(db => String(db.name || '').toLowerCase() === 'public');
      if (!match) throw new Error('دیتابیس public وجود ندارد.');
      return match.name;
    }
    return 'public';
  }

  async function readCompanies() {
    const databaseName = await existingPublicDatabaseName();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      let settled = false;
      const fail = message => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      request.onupgradeneeded = event => {
        // Abort rather than create a new empty database on older browsers.
        event.target.transaction?.abort();
        fail('دیتابیس public وجود ندارد.');
      };
      request.onerror = () => fail('باز کردن دیتابیس public ممکن نشد.');
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        const storeName = Array.from(db.objectStoreNames)
          .find(name => name.toLowerCase() === 'tk_sherkat');
        if (!storeName) {
          db.close();
          fail('استور tk_sherkat در دیتابیس public پیدا نشد.');
          return;
        }
        let transaction;
        try { transaction = db.transaction([storeName], 'readonly'); }
        catch (_) { db.close(); fail('خواندن جدول tk_sherkat ممکن نشد.'); return; }
        const rowsRequest = transaction.objectStore(storeName).getAll();
        rowsRequest.onsuccess = () => {
          const unique = new Map();
          for (const entry of rowsRequest.result) {
            const value = entry && entry.value ? entry.value : entry;
            const code = asText(getField(value, 'codesherkat')).trim();
            if (!code) continue;
            unique.set(code, {
              CodeSherkat: code,
              EsmSherkat: asText(getField(value, 'esmsherkat')),
              NoeSherkat: asText(getField(value, 'noesherkat')),
              Id: asText(getField(value, 'id'))
            });
          }
          const companies = [...unique.values()].sort((a, b) =>
            a.CodeSherkat.localeCompare(b.CodeSherkat, undefined, { numeric: true }));
          const result = companies.map((company, index) => ({
            Radif: index + 1,
            ...company
          }));
          settled = true;
          db.close();
          resolve(result);
        };
        rowsRequest.onerror = () => { db.close(); fail('خواندن جدول tk_sherkat ممکن نشد.'); };
      };
    });
  }

  async function init() {
    try {
      if (typeof window.BinaGrid !== 'function') {
        throw new Error('گرید استاندارد BINA بارگذاری نشده است (Tabulator / com_grid.js).');
      }
      grid = new BinaGrid('#companies-grid', {
        height: '100%',
        pageSize: 100,
        captions,
        presetcolumns: columns,
        storagePrefix: 'BinaCompanies',
        rowSelector: true
      });
      window.BinaCompaniesGrid = grid;
      const companies = await readCompanies();
      await grid.setData(companies, 'BinaCompanies', { own: true });
      status.textContent = `${companies.length.toLocaleString('fa-IR')} شرکت خوانده شد.`;
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => { try { grid.table?.redraw(true); } catch (_) {} });
        observer.observe(document.getElementById('companies-grid'));
      }
    } catch (error) {
      console.error('[BinaCompanies] بارگذاری شرکت‌ها:', error);
      status.textContent = `خطا: ${error.message || 'نامشخص'}`;
      status.classList.add('error');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
