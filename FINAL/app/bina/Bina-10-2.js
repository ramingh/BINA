/* Bina-10-2.js — کدینگ شرکت‌ها. تمامی شرکت‌ها از Public/TK_sherkat خوانده می‌شوند؛
   دادهٔ Coding هر شرکت از دیتابیس IndexedDB همان کد شرکت بارگذاری می‌شود.
   صفحه از گرید عمومی BinaGrid استفاده می‌کند و محدودیت انتخابگر BinaLocalSql.sources ندارد. */
(function (root) {
  'use strict';

  const select = document.getElementById('bina-coding-company');
  const status = document.getElementById('bina-coding-company-status');
  const host = document.getElementById('bina-coding-grid');
  const asText = value => value == null ? '' : String(value).trim();
  const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  let manager = null;
  let decompressor = null;
  let grid = null;
  let loadId = 0;
  let companyList = [];
  let codingCaptions = {};
  let whenReady = Promise.resolve();
  const priorState = (() => {
    try { return root.frameElement && root.frameElement.__binaState; }
    catch (_) { return null; }
  })();

  function showStatus(text, error = false) {
    status.textContent = text || '';
    status.classList.toggle('error', !!error);
  }

  async function listExistingDbs() {
    if (typeof indexedDB?.databases !== 'function')
      throw new Error('مرورگر امکان فهرست‌کردن دیتابیس‌های IndexedDB را ندارد.');
    return (await indexedDB.databases()).filter(db => db && db.name).map(db => String(db.name));
  }

  function pickDbName(names, wanted) {
    return names.find(name => name.toLowerCase() === wanted.toLowerCase()) || '';
  }

  /* Read the field titles from the same public dictionary used by BinaLocalSql. */
  async function readCaptions() {
    try {
      const db = await manager.openPublicDb();
      const storeName = Array.from(db.objectStoreNames).find(n => n.toLowerCase() === 'tk_dic');
      if (!storeName) return {};
      const records = await new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const captionMap = new Map();
      const rank = record => String(record.countrycode ?? record.CountryCode ?? '') === '2' ? 0 : 1;
      for (const item of records) {
        const record = item && item.value && typeof item.value === 'object' ? item.value : item;
        if (!record) continue;
        const technical = asText(record.caption ?? record.Caption).toLowerCase();
        const title = asText(record.fieldname ?? record.FieldName);
        if (!technical || !title) continue;
        const current = captionMap.get(technical);
        if (!current || rank(record) < current.priority) captionMap.set(technical, { title, priority: rank(record) });
      }
      return Object.fromEntries(Array.from(captionMap, ([name, item]) => [name, item.title]));
    } catch (error) {
      console.warn('[tab-10-2] دریافت عناوین کدینگ:', error);
      return {};
    }
  }

  // Unlike a string-only key range, a cursor works for native numeric OR string
  // company codes and for object-store names with different letter casing.
  async function readRawCoding(companyCode) {
    const names = await listExistingDbs();
    const databaseName = pickDbName(names, companyCode);
    if (!databaseName)
      throw new Error('بانک اطلاعاتی شرکت ' + companyCode + ' در IndexedDB موجود نیست.');
    const db = await manager.openCompanyDb(databaseName);
    const storeName = Array.from(db.objectStoreNames).find(name => name.toLowerCase() === 'coding');
    if (!storeName)
      throw new Error('جدول Coding در دیتابیس شرکت ' + companyCode + ' پیدا نشد.');
    return new Promise((resolve, reject) => {
      const blocks = [];
      const tx = db.transaction(storeName, 'readonly');
      const cursor = tx.objectStore(storeName).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (Array.isArray(c.key) && asText(c.key[0]) === companyCode) {
          const value = c.value;
          const block = value && typeof value === 'object' && !(value instanceof ArrayBuffer) &&
            !(value instanceof Uint8Array) && 'value' in value ? value.value : value;
          if (block != null) blocks.push(block);
        }
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error || new Error('خواندن بلوک کدینگ ممکن نشد.'));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('خواندن جدول کدینگ ممکن نشد.'));
      tx.oncomplete = () => resolve(blocks);
    });
  }

  async function loadCodingRows(companyCode) {
    const [columns, blocks] = await Promise.all([
      manager.getColumns('coding'), readRawCoding(companyCode)
    ]);
    if (!blocks.length) return [];

    const definitions = decompressor.normalizeColumns(columns);
    const dataDefs = definitions.filter(column => !/^(?:id|companycode|company|fiscalyear|year)$/i.test(column.name));
    const result = [];
    for (const block of blocks) {
      const decoded = await decompressor.inflateSingleBlock(block);
      if (!decoded || !Array.isArray(decoded.rows)) continue;
      const ids = Array.isArray(decoded.ids) ? decoded.ids : [];
      for (let index = 0; index < decoded.rows.length; index++) {
        const raw = decoded.rows[index];
        const item = {};
        if (Array.isArray(raw)) {
          const fields = raw.length === definitions.length ? definitions : dataDefs;
          fields.forEach((col, i) => { item[col.name.toLowerCase()] = raw[i] == null ? '' : raw[i]; });
        } else if (raw && typeof raw === 'object') {
          for (const [key, value] of Object.entries(raw)) item[key.toLowerCase()] = value;
        } else continue;
        const id = ids[index];
        if (Array.isArray(id)) {
          if (id.length > 1 && item.companycode === undefined) item.companycode = id[0];
          if (item.id === undefined) item.id = id[id.length - 1];
        } else if (id !== undefined && item.id === undefined) {
          item.id = id;
        }
        result.push(item);
      }
      // Yield between blocks for very large datasets; no arbitrary row cap is applied.
      if (result.length && result.length % 20000 < decoded.rows.length)
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return result;
  }

  async function updateForCompany() {
    if (!grid || !select.value) return;
    const id = ++loadId;
    const company = asText(select.value);
    showStatus('در حال دریافت کدینگ ' + company + '…');
    try {
      const rows = await loadCodingRows(company);
      if (id !== loadId) return;
      grid.options.captions = { ...codingCaptions };
      await grid.clearData();
      await grid.setData(rows, 'BinaCompanyCoding', { own: true });
      if (id !== loadId) return;
      showStatus(rows.length.toLocaleString('fa-IR') + ' ردیف کدینگ خوانده شد.');
      try { grid.table?.redraw(true); } catch (_) { /* no-op */ }
    } catch (error) {
      if (id !== loadId) return;
      console.error('[tab-10-2] دریافت کدینگ:', error);
      try { await grid.clearData(); } catch (_) { /* no-op */ }
      showStatus(error?.message || 'خطا در خواندن کدینگ شرکت', true);
    }
  }

  async function init() {
    if (!root.BinaGrid || !root.BinaDBManager || !root.DataDecompressor)
      throw new Error('فایل‌های اصلی BinaGrid / BinaDBManager / DataDecompressor بارگذاری نشده‌اند.');
    manager = new root.BinaDBManager();
    decompressor = new root.DataDecompressor();
    grid = new root.BinaGrid(host, {
      height: '100%', pageSize: 500, noTranslateBody: true,
      rowSelector: true, storagePrefix: 'BinaCompanyCoding'
    });
    root.BinaCodingCompanies = { grid, get companies() { return companyList; } };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        try { grid.table?.redraw(true); } catch (_) { /* no-op */ }
      });
      observer.observe(host);
    }

    const dbNames = await listExistingDbs();
    const publicName = pickDbName(dbNames, 'public');
    if (!publicName) throw new Error('دیتابیس public در IndexedDB وجود ندارد.');
    manager.publicDbName = publicName;
    companyList = (await manager.getCompanies()).filter(item => asText(item.Codesherkat));
    companyList.sort((a, b) => naturalOrder(asText(a.Codesherkat), asText(b.Codesherkat)));
    if (!companyList.length) throw new Error('هیچ شرکتی در public/tk_sherkat پیدا نشد.');
    codingCaptions = await readCaptions();
    select.replaceChildren(...companyList.map(item =>
      new Option(asText(item.EsmSherkat) + ' (' + asText(item.Codesherkat) + ')', asText(item.Codesherkat))
    ));
    const saved = asText(priorState?.params?.company);
    // Prefer the user's saved selection; otherwise select a company with an existing DB.
    const firstAvailable = companyList.find(item => !!pickDbName(dbNames, asText(item.Codesherkat)));
    const initialCode = companyList.some(item => asText(item.Codesherkat) === saved)
      ? saved : asText((firstAvailable || companyList[0]).Codesherkat);
    select.value = initialCode;
    select.addEventListener('change', updateForCompany);
    await updateForCompany();
  }

  root.BinaPage = {
    whenReady() { return whenReady; },
    getState() { return { params: { company: select?.value || '' }, page: grid?.table?.getPage?.() || 1 }; },
    async setState(state) {
      await whenReady;
      const company = asText(state?.params?.company);
      if (company && companyList.some(item => asText(item.Codesherkat) === company)) {
        select.value = company;
        await updateForCompany();
      }
    },
    onShow() { try { grid?.table?.redraw(true); } catch (_) { /* no-op */ } }
  };
  function start() {
    whenReady = init().catch(error => {
      console.error('[tab-10-2] راه‌اندازی کدینگ:', error);
      showStatus(error?.message || 'خطا در راه‌اندازی صفحه', true);
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
