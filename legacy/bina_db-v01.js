/**
 * ============================================================================
 * bina_db-v01.js (نسخه نهایی)
 * ============================================================================
 * کامپوننت دریافت و ذخیره‌سازی مدیریت شده اطلاعات
 *
 * شامل دو کلاس:
 *   ۱) webservice  - دریافت اطلاعات از سرور
 *   ۲) Index_db    - ذخیره و مدیریت در IndexedDB
 * ============================================================================
 */



/* ============================================================================
 * کلاس webservice
 * ============================================================================ */
class webservice {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.retryCount = options.retryCount ?? 2;
    this.retryDelay = options.retryDelay ?? 1000;
    this._userSignal = null;
  }

  setSignal(signal) {
    this._userSignal = signal;
  }

  async get_list_tbl(options = {}) {
    const signal = this._userSignal || options.signal;
    const tablesList = await this._fetchApi('tables', {}, signal);
    if (!Array.isArray(tablesList)) throw new Error('پاسخ mode=tables آرایه نیست');

    const results = [];
    const errors = [];

    for (const item of tablesList) {
      if (signal?.aborted) throw new DOMException('توقف', 'AbortError');
      const tableName = item.table;
      try {
        const stats = await this._fetchApi('stats', {
          table: tableName
        }, signal);
        if (!stats || stats.ok !== true || !Array.isArray(stats.columns)) throw new Error('stats نامعتبر');
        results.push({
          key: tableName,
          value: {
            count: Number(stats.count) || 0,
            columns: stats.columns.map(c => ({
              name: String(c.name),
              type: String(c.type || '')
            })),
            idcolumn: String(stats.idcolumn || 'Id'),
            idIndex: Number(stats.idIndex)
          }
        });
      } catch (err) {
        errors.push({
          table: tableName,
          error: err.message
        });
      }
    }
    return {
      results,
      errors
    };
  }

  async *get_deta_tbl(tableName, batchSize, count = 0, options = {}) {
    const signal = this._userSignal || options.signal;
    let idIndex = options.idIndex;

    if (typeof idIndex !== 'number' || idIndex < 0) {
      const stats = await this._fetchApi('stats', {
        table: tableName
      }, signal);
      if (!stats || typeof stats.idIndex !== 'number') throw new Error('idIndex قابل دریافت نیست');
      idIndex = stats.idIndex;
    }

    let lastId = 0;
    let received = 0;
    let batchNo = 0;

    while (count === 0 || received < count) {
      if (signal?.aborted) throw new DOMException('توقف', 'AbortError');
      const data = await this._fetchApi('data', {
        table: tableName,
        lastId,
        batchSize
      }, signal);

      let rows;
      if (Array.isArray(data)) rows = data;
      else if (data && Array.isArray(data.rows)) rows = data.rows;
      else rows = [];

      if (rows.length === 0) break;

      batchNo++;
      received += rows.length;

      const lastRow = rows[rows.length - 1];
      if (Array.isArray(lastRow) && typeof lastRow[idIndex] !== 'undefined') {
        lastId = lastRow[idIndex];
      } else {
        break;
      }

      yield {
        batchNo,
        rows,
        lastId,
        received,
        total: count
      };

      if (rows.length < batchSize) break;
    }
  }

  async _fetchApi(mode, params = {}, signal) {
    const url = new URL(this.endpoint);
    url.searchParams.set('mode', mode);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    let lastError;
    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          cache: 'no-store',
          signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') throw err;
        if (attempt < this.retryCount) await new Promise(r => setTimeout(r, this.retryDelay));
      }
    }
    throw lastError;
  }
}



/* ============================================================================
 * کلاس Index_db
 * ============================================================================ */
class Index_db {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.blockSize = options.blockSize || 30000;
    this._public = null;
    this._company = null;
  }

  /* ─── متدهای اتصال به دیتابیس ─── */

  async _requestPersistence() {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  async _openpublic() {
    if (this._public) return this._public;
    this._public = await new Promise((resolve, reject) => {
      const req = indexedDB.open('public', 5);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;

        if (oldVersion < 5) {
          if (db.objectStoreNames.contains('ServerTables')) db.deleteObjectStore('ServerTables');
          if (db.objectStoreNames.contains('catalog')) db.deleteObjectStore('catalog');
          if (db.objectStoreNames.contains('columns')) db.deleteObjectStore('columns');
        }

        if (!db.objectStoreNames.contains('ServerTables')) db.createObjectStore('ServerTables', {
          keyPath: 'table'
        });
        if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog', {
          keyPath: 'key'
        });
        if (!db.objectStoreNames.contains('columns')) db.createObjectStore('columns', {
          keyPath: 'key'
        });
        if (!db.objectStoreNames.contains('tk_dic')) db.createObjectStore('tk_dic');
        if (!db.objectStoreNames.contains('tk_sherkat')) db.createObjectStore('tk_sherkat');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('دیتابیس در تب دیگری باز است.'));
    });
    return this._public;
  }

  async _openCompany(companyCode) {
    if (this._company?.code === String(companyCode)) return this._company.db;
    this._closeCompany();
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(String(companyCode), 5);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;

        if (oldVersion < 5) {
          if (db.objectStoreNames.contains('Coding')) db.deleteObjectStore('Coding');
          if (db.objectStoreNames.contains('Sanad')) db.deleteObjectStore('Sanad');
        }
        if (db.objectStoreNames.contains('BlockIndex')) db.deleteObjectStore('BlockIndex');

        if (!db.objectStoreNames.contains('Coding')) db.createObjectStore('Coding');
        if (!db.objectStoreNames.contains('Sanad')) db.createObjectStore('Sanad');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('دیتابیس شرکت در تب دیگری باز است.'));
    });
    this._company = {
      code: String(companyCode),
      db
    };
    return db;
  }

  _closeCompany() {
    if (this._company) {
      try {
        this._company.db.close();
      } catch (e) {}
      this._company = null;
    }
  }

  close() {
    this._closeCompany();
    if (this._public) {
      try {
        this._public.close();
      } catch (e) {}
      this._public = null;
    }
  }

  /* ─── توابع کمکی IndexedDB ─── */

  _req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  _txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => {};
    });
  }

  /* ─── متدهای فشرده‌سازی ─── */

  async _gzip(obj) {
    const enc = new TextEncoder();
    const stream = new Blob([enc.encode(JSON.stringify(obj))]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async _gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(await new Response(stream).arrayBuffer()));
  }

  /* ─── متدهای ذخیره متادیتا ─── */

  async save_table_list(results) {
    const db = await this._openpublic();
    const tx = db.transaction('ServerTables', 'readwrite');
    const store = tx.objectStore('ServerTables');
    store.clear();
    for (const r of results) {
      store.put({
        table: r.key,
        count: r.value.count,
        idcolumn: r.value.idcolumn,
        idIndex: r.value.idIndex,
        columns: r.value.columns
      });
    }
    await this._txDone(tx);
  }

  async save_columns(results) {
    const db = await this._openpublic();
    const tx = db.transaction('columns', 'readwrite');
    const store = tx.objectStore('columns');
    const families = {};
    for (const r of results) {
      const info = this._parseTableName(r.key);
      if (info && !families[info.family]) {
        families[info.family] = {
          key: info.family,
          columns: r.value.columns,
          idcolumn: r.value.idcolumn,
          idIndex: r.value.idIndex,
          sourceTable: r.key
        };
      }
    }
    for (const fam of Object.values(families)) store.put(fam);
    await this._txDone(tx);
  }

  async get_checkpoint(tableName) {
    const db = await this._openpublic();
    return (await this._req(db.transaction('catalog', 'readonly').objectStore('catalog').get(tableName))) || null;
  }

  async _save_checkpoint(state) {
    const db = await this._openpublic();
    const tx = db.transaction('catalog', 'readwrite');
    tx.objectStore('catalog').put({
      ...state,
      key: state.table
    });
    await this._txDone(tx);
  }

  async get_tables_list() {
    const db = await this._openpublic();
    return await this._req(db.transaction('ServerTables', 'readonly').objectStore('ServerTables').getAll());
  }

  async get_columns(family) {
    const db = await this._openpublic();
    return await this._req(db.transaction('columns', 'readonly').objectStore('columns').get(family));
  }

  /* ─── متد ذخیره بسته داده ─── */

  async save_batch(tableName, batch, schema) {
    const info = this._parseTableName(tableName);
    if (!info) throw new Error(`نام جدول نامعتبر: ${tableName}`);

    const db = await this._openCompany(info.company);
    const family = info.family;

    const ids = [];
    const vals = [];
    for (const row of batch.rows) {
      const id = row[schema.idIndex];
      const values = row.filter((_, i) => i !== schema.idIndex);
      ids.push(id);
      vals.push(values);
    }

    const packed = await this._gzip({
      ids,
      rows: vals
    });
    const blockNo = batch.batchNo - 1;
    const blockKey = family === 'Sanad' ? [info.year, info.company, blockNo] : [info.company, blockNo];

    const tx = db.transaction([family], 'readwrite');
    tx.objectStore(family).put(packed, blockKey);
    await this._txDone(tx);

    const state = await this.get_checkpoint(tableName) || {
      table: tableName,
      family,
      company: info.company,
      year: info.year,
      lastId: 0,
      received: 0,
      finished: false,
      blocks: []
    };
    state.lastId = batch.lastId;
    state.received = batch.received;
    state.finished = (batch.received >= batch.total);
    state.blocks = state.blocks || [];
    state.blocks.push({
      n: blockNo,
      firstId: ids[0],
      lastId: ids[ids.length - 1],
      count: ids.length
    });
    await this._save_checkpoint(state);
  }

  /* ─── متد خواندن داده ─── */

  async get_rows(tableName, afterId = -1, limit = 50) {
    const info = this._parseTableName(tableName);
    if (!info) throw new Error(`نام جدول نامعتبر: ${tableName}`);

    const schema = await this.get_columns(info.family);
    if (!schema) throw new Error(`Schema یافت نشد`);

    const state = await this.get_checkpoint(tableName);
    if (!state || !state.blocks || state.blocks.length === 0) return [];

    const db = await this._openCompany(info.company);
    const neededBlocks = state.blocks.filter(b => b.lastId > afterId);
    if (neededBlocks.length === 0) return [];

    const tx = db.transaction(info.family, 'readonly');
    const store = tx.objectStore(info.family);
    const blockKeys = neededBlocks.map(b =>
      info.family === 'Sanad' ? [info.year, info.company, b.n] : [info.company, b.n]
    );
    const packedList = await Promise.all(blockKeys.map(k => this._req(store.get(k))));

    const out = [];
    for (let b = 0; b < packedList.length && out.length < limit; b++) {
      if (!packedList[b]) continue;
      const un = await this._gunzip(packedList[b]);
      for (let i = 0; i < un.ids.length && out.length < limit; i++) {
        if (un.ids[i] > afterId) {
          const obj = {};
          let k = 0;
          schema.columns.forEach((c, idx) => {
            obj[c.name] = idx === schema.idIndex ? un.ids[i] : un.rows[i][k++];
          });
          out.push(obj);
        }
      }
    }
    return out;
  }

  /* ─── متدهای جداول tk_ ─── */

  async save_tk_dic(batch, schema) {
    const db = await this._openpublic();
    const ccIdx = schema.columns.findIndex(c => c.name.toLowerCase() === 'countrycode');
    const fnIdx = schema.columns.findIndex(c => c.name.toLowerCase() === 'fieldname');
    const capIdx = schema.columns.findIndex(c => c.name.toLowerCase() === 'caption');
    if (ccIdx < 0 || fnIdx < 0 || capIdx < 0) throw new Error('ستون‌های tk_dic یافت نشد');

    const tx = db.transaction('tk_dic', 'readwrite');
    const store = tx.objectStore('tk_dic');
    for (const row of batch.rows) {
      store.put(row[capIdx], [row[ccIdx], row[fnIdx]]);
    }
    await this._txDone(tx);
  }

  async save_tk_sherkat(batch, schema) {
    const db = await this._openpublic();
    const csIdx = schema.columns.findIndex(c => c.name.toLowerCase() === 'codesherkat');
    const esIdx = schema.columns.findIndex(c => c.name.toLowerCase() === 'esmsherkat');
    if (csIdx < 0 || esIdx < 0) throw new Error('ستون‌های tk_sherkat یافت نشد');

    const tx = db.transaction('tk_sherkat', 'readwrite');
    const store = tx.objectStore('tk_sherkat');
    for (const row of batch.rows) {
      store.put(1, [row[csIdx], row[esIdx]]);
    }
    await this._txDone(tx);
  }

  async get_translation(fieldName, countryCode = 2) {
    const db = await this._openpublic();
    return (await this._req(db.transaction('tk_dic', 'readonly').objectStore('tk_dic').get([countryCode, fieldName]))) || null;
  }

  async get_company_name(codeSherkat) {
    const db = await this._openpublic();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tk_sherkat', 'readonly');
      const store = tx.objectStore('tk_sherkat');
      const range = IDBKeyRange.bound([codeSherkat, ''], [codeSherkat, '\uffff']);
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) resolve(cursor.key[1]);
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /* ─── Orchestrator: sync_all ─── */

  async sync_all(onProgress = null) {
    const emit = (event, data) => onProgress && onProgress({
      event,
      ...data
    });

    await this._requestPersistence();
    await this._openpublic();

    let localTables = await this.get_tables_list();

    if (localTables.length === 0) {
      emit('phase', {
        phase: 'fetching-public',
        message: 'دریافت لیست جداول و Schema...'
      });
      const {
        results,
        errors
      } = await this.ws.get_list_tbl();

      if (results.length === 0) throw new Error('هیچ جدولی دریافت نشد');

      await this.save_table_list(results);
      await this.save_columns(results);
      localTables = results.map(r => ({
        table: r.key,
        count: r.value.count,
        idcolumn: r.value.idcolumn,
        idIndex: r.value.idIndex,
        columns: r.value.columns
      }));

      emit('phase', {
        phase: 'fetching-tk',
        message: 'دریافت جداول ترجمه و شرکت‌ها...'
      });
      await this._sync_tk_tables(localTables);
    }

    emit('phase', {
      phase: 'comparing',
      message: 'بررسی جداول ناقص...'
    });
    const toSync = [];

    for (const t of localTables) {
      const info = this._parseTableName(t.table);
      if (!info) continue;

      const state = await this.get_checkpoint(t.table);
      const isComplete = state?.finished && state?.received >= t.count;

      if (!isComplete) {
        toSync.push({
          table: t.table,
          count: t.count,
          idIndex: t.idIndex,
          info
        });
      }
    }

    if (toSync.length === 0) {
      emit('phase', {
        phase: 'done',
        message: 'همه جداول کامل هستند.'
      });
      return {
        synced: 0,
        total: 0
      };
    }

    emit('phase', {
      phase: 'downloading',
      message: `دانلود ${toSync.length} جدول ناقص...`,
      total: toSync.length
    });
    let done = 0;

    for (const t of toSync) {
      emit('table-start', {
        table: t.table,
        done,
        total: toSync.length
      });

      const schema = await this.get_columns(t.info.family);

      for await (const batch of this.ws.get_deta_tbl(t.table, this.blockSize, t.count, {
        idIndex: t.idIndex
      })) {
        await this.save_batch(t.table, batch, schema);
        emit('batch', {
          table: t.table,
          batchNo: batch.batchNo,
          received: batch.received,
          total: batch.total
        });
      }

      done++;
      emit('table-done', {
        table: t.table,
        done,
        total: toSync.length
      });
    }

    emit('phase', {
      phase: 'done',
      message: 'همگام‌سازی کامل شد.'
    });
    return {
      synced: done,
      total: toSync.length
    };
  }

  async _sync_tk_tables(localTables) {
    const tkdikTable = localTables.find(t => t.table === 'tk_dic_FieldName');
    const tksherkatTable = localTables.find(t => t.table === 'tk_EsmSherkatHolding');

    if (tkdikTable) {
      const schema = {
        columns: tkdikTable.columns,
        idcolumn: tkdikTable.idcolumn,
        idIndex: tkdikTable.idIndex
      };
      for await (const batch of this.ws.get_deta_tbl('tk_dic_FieldName', 50000, tkdikTable.count, {
        idIndex: tkdikTable.idIndex
      })) {
        await this.save_tk_dic(batch, schema);
      }
    }

    if (tksherkatTable) {
      const schema = {
        columns: tksherkatTable.columns,
        idcolumn: tksherkatTable.idcolumn,
        idIndex: tksherkatTable.idIndex
      };
      for await (const batch of this.ws.get_deta_tbl('tk_EsmSherkatHolding', 50000, tksherkatTable.count, {
        idIndex: tksherkatTable.idIndex
      })) {
        await this.save_tk_sherkat(batch, schema);
      }
    }
  }

  /* ─── متد کمکی ─── */

  _parseTableName(tableName) {
    const name = String(tableName || '').trim();
    let m = /^coding_(\d+)$/i.exec(name);
    if (m) return {
      table: name,
      company: m[1],
      family: 'Coding',
      year: null
    };

    m = /^sanad_(\d{4})_(\d+)$/i.exec(name);
    if (m) return {
      table: name,
      company: m[2],
      family: 'Sanad',
      year: Number(m[1])
    };

    return null;
  }
}



/* ============================================================================
 * اتصال به window
 * ============================================================================ */
if (typeof window !== 'undefined') {
  window.webservice = webservice;
  window.Index_db = Index_db;
}