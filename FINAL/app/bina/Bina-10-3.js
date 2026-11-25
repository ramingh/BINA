/* Bina-10-3.js — اسناد حسابداری شرکت‌ها | نسخه 1.2.60
 * Companies: Public/TK_sherkat. Years & document blocks: {CompanyCode}/Sanad.
 * Columns: Public/Columns (sanad/coding); captions: Public/TK_dic.
 * Display-only CodeHesab = Kol + Moien + Tafsil, OnvanHesab from Coding.
 * Id and CompanyCode are not shown; stored IndexedDB data remains unchanged.
 * All reads are read-only. There is no row cap or SQL/SQLite dependency.
 */
(function (root) {
  'use strict';

  const companySelect = document.getElementById('bina-documents-company');
  const yearSelect = document.getElementById('bina-documents-year');
  const status = document.getElementById('bina-documents-status');
  const host = document.getElementById('bina-documents-grid');
  const toText = value => value == null ? '' : String(value).trim();
  const ascii = value => toText(value)
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
  const compare = (a, b) => ascii(a).localeCompare(ascii(b), 'fa', { numeric: true });
  // Normalize ONLY for matching (Persian/Arabic numerals, numeric leading zeros).
  // Never convert long account numbers to JS Number or change persisted codes.
  const codeKey = value => {
    const code = ascii(value);
    return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, '') : code;
  };
  const accountKey = (kol, moien, tafsil) =>
    [kol, moien, tafsil].map(codeKey).join('|');
  function accountLanguage() {
    let lang = '';
    try { lang = root.parent?.document?.documentElement?.lang || ''; } catch (_) {}
    if (!lang) try { lang = root.localStorage.getItem('sidebarLanguage') || ''; } catch (_) {}
    if (!lang) lang = document.documentElement.lang || 'fa';
    return /^en(?:[-_]|$)/i.test(lang) ? 'en' : /^ar(?:[-_]|$)/i.test(lang) ? 'ar' : 'fa';
  }
  function visualAccountCode(value) {
    const lang = accountLanguage();
    const parts = ascii(value).split(' - ');
    if (lang === 'en') parts.reverse();
    const digits = lang === 'en' ? '0123456789' :
      lang === 'ar' ? '٠١٢٣٤٥٦٧٨٩' : '۰۱۲۳۴۵۶۷۸۹';
    return parts.join(' - ').replace(/[0-9]/g, digit => digits[Number(digit)]);
  }
  function compareAccountCodes(left, right) {
    const aa = ascii(left).split(/\s+-\s+/);
    const bb = ascii(right).split(/\s+-\s+/);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      const diff = compare(aa[i] || '', bb[i] || '');
      if (diff) return diff;
    }
    return 0;
  }
  const defaultCaptions = {
    id:'شناسه', companycode:'کد شرکت', fiscalyear:'سال مالی',
    shomarehsanad:'شماره سند', tarikh:'تاریخ', kol_code:'کد کل',
    moien_code:'کد معین', tafsil_code:'کد تفصیل',
    codehesab:'کد حساب', onvanhesab:'عنوان حساب',
    sharhsanad:'شرح سند', bedehkar:'بدهکار', bestankar:'بستانکار'
  };
  let manager = null;
  let decompressor = null;
  let grid = null;
  let companies = [];
  let years = [];
  let captions = { ...defaultCaptions };
  let knownDbs = [];
  let changeId = 0;
  let gridOps = Promise.resolve();
  let codePresentationInstalled = false;
  let whenReady = Promise.resolve();
  const savedState = (() => {
    try { return root.frameElement?.__binaState || null; }
    catch (_) { return null; }
  })();

  function setStatus(message, isError = false) {
    status.textContent = message || '';
    status.classList.toggle('error', !!isError);
  }
  async function existingDatabaseNames() {
    if (typeof indexedDB.databases !== 'function')
      throw new Error('مرورگر امکان بررسی بانک‌های موجود IndexedDB را ندارد.');
    return (await indexedDB.databases()).filter(item => item?.name).map(item => String(item.name));
  }
  function findDbName(code) {
    return knownDbs.find(name => name.toLowerCase() === String(code).toLowerCase()) || '';
  }
  function storeByName(db, wanted) {
    return Array.from(db.objectStoreNames).find(name => name.toLowerCase() === wanted.toLowerCase()) || '';
  }
  function extractValue(entry) {
    if (entry && typeof entry === 'object' && !(entry instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(entry) && 'value' in entry) return entry.value;
    return entry;
  }

  // Read available fiscal years from the keys of *this* company's Sanad store.
  async function readYears(companyCode) {
    const dbName = findDbName(companyCode);
    if (!dbName) throw new Error('دیتابیس شرکت ' + companyCode + ' در IndexedDB پیدا نشد.');
    const db = await manager.openCompanyDb(dbName);
    const storeName = storeByName(db, 'Sanad');
    if (!storeName) throw new Error('جدول Sanad برای شرکت ' + companyCode + ' وجود ندارد.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => {
        const found = new Set();
        for (const key of request.result || []) {
          if (!Array.isArray(key) || key.length < 3 || ascii(key[1]) !== ascii(companyCode)) continue;
          const year = ascii(key[0]);
          if (year) found.add(year);
        }
        resolve([...found].sort(compare));
      };
      request.onerror = () => reject(request.error || new Error('خواندن سال‌های مالی ممکن نشد.'));
    });
  }

  // Read all compressed blocks of the selected year; accepts numeric and string key segments.
  // Cursor rather than IDBKeyRange avoids silently omitting data when year/code key types vary.
  async function readBlocks(companyCode, year) {
    const dbName = findDbName(companyCode);
    if (!dbName) throw new Error('بانک شرکت انتخاب‌شده وجود ندارد.');
    const db = await manager.openCompanyDb(dbName);
    const storeName = storeByName(db, 'Sanad');
    if (!storeName) throw new Error('جدول Sanad در بانک شرکت انتخاب‌شده پیدا نشد.');
    return new Promise((resolve, reject) => {
      const blocks = [];
      const tx = db.transaction(storeName, 'readonly');
      const cursor = tx.objectStore(storeName).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const key = item.key;
        if (Array.isArray(key) && key.length >= 3 &&
            ascii(key[0]) === ascii(year) && ascii(key[1]) === ascii(companyCode)) {
          const block = extractValue(item.value);
          if (block != null) blocks.push(block);
        }
        item.continue();
      };
      cursor.onerror = () => reject(cursor.error || new Error('خطا در خواندن بلوک‌های اسناد.'));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('خواندن اطلاعات اسناد انجام نشد.'));
      tx.oncomplete = () => resolve(blocks);
    });
  }

  // The coding store is keyed by [CompanyCode, Id] in each company's own DB.
  // Use a readonly cursor to tolerate numeric or string key components.
  async function readCodingBlocks(companyCode) {
    const dbName = findDbName(companyCode);
    if (!dbName) throw new Error('بانک شرکت انتخاب‌شده در IndexedDB وجود ندارد.');
    const db = await manager.openCompanyDb(dbName);
    const storeName = storeByName(db, 'Coding');
    if (!storeName) throw new Error('جدول Coding در بانک شرکت انتخاب‌شده پیدا نشد.');
    return new Promise((resolve, reject) => {
      const blocks = [];
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const key = cursor.key;
        if (Array.isArray(key) && codeKey(key[0]) === codeKey(companyCode)) {
          const block = extractValue(cursor.value);
          if (block != null) blocks.push(block);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('خواندن بلوک‌های کدینگ ممکن نشد.'));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('خواندن Coding انجام نشد.'));
      tx.oncomplete = () => resolve(blocks);
    });
  }

  function accountCaption(row, ...candidates) {
    for (const name of candidates) {
      const value = toText(row[name]);
      if (value) return value;
    }
    return '';
  }
  async function readCodingTitles(companyCode, token) {
    const [columns, blocks] = await Promise.all([
      manager.getColumns('coding'), readCodingBlocks(companyCode)
    ]);
    const schemaNames = decompressor.normalizeColumns(columns)
      .map(item => item.name.toLowerCase());
    const titles = new Map();
    let currentLayout = null;
    let previousLength = -1;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      if (token !== changeId) return null;
      const decoded = await decompressor.inflateSingleBlock(blocks[blockIndex]);
      blocks[blockIndex] = null;
      if (!decoded || !Array.isArray(decoded.rows))
        throw new Error('فرمت بلوک Coding شماره ' + (blockIndex + 1) + ' نامعتبر است.');
      for (const raw of decoded.rows) {
        let row;
        if (Array.isArray(raw)) {
          if (raw.length !== previousLength) {
            currentLayout = layoutFor(schemaNames, raw.length);
            previousLength = raw.length;
          }
          row = {};
          currentLayout.forEach((field, index) => { row[field] = raw[index]; });
        } else if (raw && typeof raw === 'object') {
          row = Object.fromEntries(Object.entries(raw).map(([field, value]) => [field.toLowerCase(), value]));
        } else continue;
        const key = accountKey(row.kol_code, row.moien_code, row.tafsil_code);
        if (!toText(row.kol_code)) continue;
        // The title is the complete path, matching the existing accounting views.
        const title = [
          accountCaption(row, 'kol_onvan', 'onvan_kol'),
          accountCaption(row, 'moien_onvan', 'onvan_moien'),
          accountCaption(row, 'tafsil_onvan', 'onvan_tafsil')
        ].filter(Boolean).join(' - ');
        if (title && (!titles.has(key) || title.length > titles.get(key).length))
          titles.set(key, title);
      }
      if ((blockIndex + 1) % 8 === 0)
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return token === changeId ? titles : null;
  }

  // Only the VIEW is transformed: never rewrite Sanad or Coding records.
  function showDocumentsWithTitles(rows, titles) {
    let unmatched = 0;
    const shown = rows.map(row => {
      const parts = [row.kol_code, row.moien_code, row.tafsil_code];
      const code = parts.map(toText).filter(part => part !== '').join(' - ');
      const title = titles.get(accountKey(...parts)) || '';
      if (code && !title) unmatched++;
      const output = {};
      let insertedAccount = false;
      for (const [field, value] of Object.entries(row)) {
        if (field === 'id' || field === 'companycode' || field === 'company') continue;
        if (field === 'kol_code' || field === 'moien_code' || field === 'tafsil_code') {
          if (!insertedAccount) {
            output.codehesab = code;
            output.onvanhesab = title;
            insertedAccount = true;
          }
          continue;
        }
        output[field] = value;
      }
      if (!insertedAccount) {
        output.codehesab = code;
        output.onvanhesab = title;
      }
      return output;
    });
    return { rows:shown, unmatched };
  }

  // Same BinaGrid smart formatter as other reports, so user-selected colors,
  // font sizes and bold settings remain authoritative. The raw code is stable.
  async function installAccountCodePresentation() {
    const col = grid?.table?.getColumn?.('codehesab');
    if (!col) return;
    await col.updateDefinition({
      formatter: cell => {
        const node = grid.smart.cellFormatter(cell);
        node.textContent = visualAccountCode(cell.getValue());
        node.style.direction = 'ltr';
        node.style.unicodeBidi = 'isolate';
        return node;
      },
      sorter: compareAccountCodes
    });
    if (codePresentationInstalled) return;
    codePresentationInstalled = true;
    const refresh = () => {
      for (const row of grid.table?.getRows('visible') || []) {
        const cell = row.getCells().find(item => item.getField() === 'codehesab');
        if (!cell) continue;
        const node = cell.getElement()?.querySelector('.smart');
        if (!node) continue;
        node.textContent = visualAccountCode(cell.getValue());
        node.style.direction = 'ltr';
        node.style.unicodeBidi = 'isolate';
      }
    };
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; refresh(); });
    };
    let parentRoot = null;
    try { parentRoot = root.parent?.document?.documentElement; } catch (_) {}
    const observer = parentRoot && root.MutationObserver ? new MutationObserver(schedule) : null;
    observer?.observe(parentRoot, {attributes:true, attributeFilter:['lang']});
    root.addEventListener('storage', schedule);
    grid.table.on('renderComplete', schedule);
    schedule();
  }

  async function readCaptions() {
    try {
      const db = await manager.openPublicDb();
      const store = storeByName(db, 'TK_dic');
      if (!store) return { ...defaultCaptions };
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      const result = { ...defaultCaptions };
      const priorities = new Map();
      for (const item of rows) {
        const record = extractValue(item);
        if (!record || typeof record !== 'object') continue;
        const name = toText(record.caption ?? record.Caption).toLowerCase();
        const caption = toText(record.fieldname ?? record.FieldName);
        if (!name || !caption) continue;
        const priority = String(record.countrycode ?? record.CountryCode ?? '') === '2' ? 0 : 1;
        if (!priorities.has(name) || priority < priorities.get(name)) {
          result[name] = caption;
          priorities.set(name, priority);
        }
      }
      return result;
    } catch (error) {
      console.warn('[tab-10-3] عناوین فیلدها:', error);
      return { ...defaultCaptions };
    }
  }

  // Supports compressed rows that omit key fields, include all fields, or contain objects.
  // Do not cast BIGINT/money strings to Number: doing so would lose exact precision.
  function layoutFor(schemaNames, rowLength) {
    const isKey = name => ['id','companycode','company','fiscalyear','year'].includes(name);
    const candidates = [
      schemaNames.filter(name => !isKey(name)),
      schemaNames.filter(name => name !== 'id'),
      schemaNames
    ];
    const layout = candidates.find(items => items.length === rowLength);
    if (!layout) throw new Error('ساختار ستون‌های Sanad با داده فشرده مطابقت ندارد (طول ردیف: ' + rowLength + ').');
    return layout;
  }
  async function readSanadRows(companyCode, year, token) {
    const [columns, blocks] = await Promise.all([
      manager.getColumns('sanad'), readBlocks(companyCode, year)
    ]);
    const definitions = decompressor.normalizeColumns(columns);
    const schemaNames = definitions.map(item => item.name.toLowerCase());
    if (!blocks.length) return [];
    const result = [];
    let count = 0;
    let currentLayout = null;
    let currentLength = -1;
    const ensureNames = [...schemaNames];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      if (token !== changeId) return null;
      const decoded = await decompressor.inflateSingleBlock(blocks[blockIndex]);
      blocks[blockIndex] = null;
      if (!decoded || !Array.isArray(decoded.rows))
        throw new Error('فرمت بلوک فشرده شماره ' + (blockIndex + 1) + ' نامعتبر است.');
      const ids = Array.isArray(decoded.ids) ? decoded.ids : [];
      for (let i = 0; i < decoded.rows.length; i++) {
        const raw = decoded.rows[i];
        let data;
        if (Array.isArray(raw)) {
          if (raw.length !== currentLength) {
            currentLayout = layoutFor(schemaNames, raw.length);
            currentLength = raw.length;
          }
          data = {};
          currentLayout.forEach((field, index) => { data[field] = raw[index]; });
        } else if (raw && typeof raw === 'object') {
          data = Object.fromEntries(Object.entries(raw).map(([field, value]) => [field.toLowerCase(), value]));
        } else {
          throw new Error('فرمت ردیف سند نامعتبر است.');
        }
        const id = ids[i];
        if (Array.isArray(id)) {
          if (id.length >= 3) {
            if (data.fiscalyear == null) data.fiscalyear = id[0];
            if (data.companycode == null) data.companycode = id[1];
            if (data.id == null) data.id = id[2];
          } else if (id.length && data.id == null) data.id = id[id.length - 1];
        } else if (id != null && data.id == null) data.id = id;
        if (data.companycode == null) data.companycode = companyCode;
        if (data.fiscalyear == null) data.fiscalyear = year;
        // Additional fields in an object record remain visible, not discarded.
        if (result.length === 0) {
          for (const field of Object.keys(data)) if (!ensureNames.includes(field)) ensureNames.push(field);
        }
        const row = {};
        for (const field of ensureNames) row[field] = data[field] == null ? '' : data[field];
        result.push(row);
        count++;
      }
      if ((blockIndex + 1) % 8 === 0) {
        setStatus(count.toLocaleString('fa-IR') + ' ردیف سند در حال خواندن…');
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (token !== changeId) return null;
    // Number-of-document and date sorting; keep the full account/document line detail.
    result.sort((a, b) => compare(a.tarikh ?? a.tarikhsanad, b.tarikh ?? b.tarikhsanad) ||
      compare(a.shomarehsanad ?? a.shomare_sanad, b.shomarehsanad ?? b.shomare_sanad) ||
      compare(a.id, b.id));
    return result;
  }

  // Serialize mutations to BinaGrid so an old async setData can never overwrite a newer selection.
  function updateGrid(fn) {
    gridOps = gridOps.catch(() => {}).then(fn);
    return gridOps;
  }
  function clearGrid(token) {
    return updateGrid(async () => { if (token === changeId && grid) await grid.clearData(); });
  }
  async function updateDocuments() {
    const token = ++changeId;
    const company = toText(companySelect.value);
    const year = toText(yearSelect.value);
    await clearGrid(token);
    if (!company || !year) { setStatus('شرکت و سال مالی را انتخاب کنید.'); return; }
    setStatus('در حال خواندن اسناد ' + year + '…');
    try {
      const [rows, titles] = await Promise.all([
        readSanadRows(company, year, token), readCodingTitles(company, token)
      ]);
      if (token !== changeId || !rows || !titles) return;
      const displayed = showDocumentsWithTitles(rows, titles);
      await updateGrid(async () => {
        if (token !== changeId) return;
        grid.options.captions = { ...captions,
          codehesab: 'کد حساب', onvanhesab: 'عنوان حساب' };
        await grid.setData(displayed.rows, 'BinaCompanySanad', { own:true });
        if (token !== changeId) return;
        await installAccountCodePresentation();
        if (token !== changeId) return;
        const warning = displayed.unmatched ?
          ' (' + displayed.unmatched.toLocaleString('fa-IR') + ' حساب بدون عنوان منطبق در Coding)' : '';
        setStatus(rows.length.toLocaleString('fa-IR') + ' ردیف سند خوانده شد.' + warning);
        try { grid.table?.redraw(true); } catch (_) { /* redraw optional */ }
      });
    } catch (error) {
      if (token !== changeId) return;
      console.error('[tab-10-3] اسناد شرکت:', error);
      setStatus(error?.message || 'خواندن اسناد انجام نشد.', true);
      await clearGrid(token);
    }
  }
  async function updateYears(preferredYear = '') {
    const token = ++changeId;
    const company = toText(companySelect.value);
    yearSelect.disabled = true;
    yearSelect.replaceChildren(new Option('در حال دریافت سال‌ها…', ''));
    await clearGrid(token);
    if (!company) { yearSelect.replaceChildren(new Option('—', '')); return; }
    setStatus('در حال دریافت سال‌های مالی…');
    try {
      years = await readYears(company);
      if (token !== changeId) return;
      if (!years.length) {
        yearSelect.replaceChildren(new Option('بدون سند', ''));
        setStatus('برای این شرکت سال مالی دارای سند پیدا نشد.');
        return;
      }
      yearSelect.replaceChildren(...years.map(y => new Option(y, y)));
      yearSelect.value = years.includes(preferredYear) ? preferredYear : years[years.length - 1];
      yearSelect.disabled = false;
      await updateDocuments();
    } catch (error) {
      if (token !== changeId) return;
      console.error('[tab-10-3] سال‌های شرکت:', error);
      yearSelect.replaceChildren(new Option('—', ''));
      setStatus(error?.message || 'خواندن سال‌های مالی انجام نشد.', true);
    }
  }

  async function init() {
    if (!root.BinaGrid || !root.BinaDBManager || !root.DataDecompressor)
      throw new Error('گرید استاندارد یا ابزارهای بانک اطلاعاتی BINA بارگذاری نشده‌اند.');
    manager = new root.BinaDBManager();
    decompressor = new root.DataDecompressor();
    grid = new root.BinaGrid(host, {
      height:'100%', pageSize:500, noTranslateBody:true,
      rowSelector:true, storagePrefix:'BinaCompanySanad'
    });
    root.BinaCompanyDocuments = { grid, get companies() { return companies; }, get years() { return years; } };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => { try { grid.table?.redraw(true); } catch (_) {} });
      observer.observe(host);
    }
    knownDbs = await existingDatabaseNames();
    const publicName = findDbName('public');
    if (!publicName) throw new Error('بانک Public در IndexedDB یافت نشد.');
    manager.publicDbName = publicName;
    companies = (await manager.getCompanies()).filter(item => toText(item.Codesherkat));
    companies.sort((a, b) => compare(a.Codesherkat, b.Codesherkat));
    if (!companies.length) throw new Error('شرکتی در Public/TK_sherkat پیدا نشد.');
    captions = await readCaptions();
    companySelect.replaceChildren(...companies.map(item => new Option(
      toText(item.EsmSherkat) + ' (' + toText(item.Codesherkat) + ')', toText(item.Codesherkat)
    )));
    const savedCompany = toText(savedState?.params?.company);
    const savedYear = toText(savedState?.params?.year);
    const firstAvailable = companies.find(item => !!findDbName(item.Codesherkat));
    companySelect.value = companies.some(item => toText(item.Codesherkat) === savedCompany)
      ? savedCompany : toText((firstAvailable || companies[0]).Codesherkat);
    companySelect.addEventListener('change', () => updateYears());
    yearSelect.addEventListener('change', updateDocuments);
    await updateYears(savedYear);
  }

  root.BinaPage = {
    whenReady() { return whenReady; },
    getState() {
      return { params: { company:companySelect.value || '', year:yearSelect.value || '' },
        page:grid?.table?.getPage?.() || 1 };
    },
    async setState(state) {
      await whenReady;
      const company = toText(state?.params?.company);
      const year = toText(state?.params?.year);
      if (companies.some(item => toText(item.Codesherkat) === company)) {
        companySelect.value = company;
        await updateYears(year);
      } else if (years.includes(year)) {
        yearSelect.value = year;
        await updateDocuments();
      }
    },
    onShow() { try { grid?.table?.redraw(true); } catch (_) {} }
  };
  function start() {
    whenReady = init().catch(error => {
      console.error('[tab-10-3] راه‌اندازی اسناد حسابداری شرکت‌ها:', error);
      setStatus(error?.message || 'خطا در راه‌اندازی صفحه.', true);
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})(window);
