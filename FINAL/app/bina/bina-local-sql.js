/* ═══════════════════════════════════════════════════════════════════════
   bina-local-sql. js — کویری SQL روی بانک لوکال (بلوک‌های gzip) — بدون UI، مستقل از گرید
   وابستگی: AlaSQL (اگر در صفحه نباشد خودش از CDN لود می‌کند)
   ساختار بانک لوکال:
     هر شرکت یک دیتابیس IndexedDB:  Coding [شرکت, Id]   Sanad [سال, شرکت, Id]
     مقدار: Uint8Array = gzip({ids, rows})   یا   آرایهٔ ردیفی (بدون Id)
     دیتابیس‌هایی که استور catalog دارند (public و   قدیمی) نادیده گرفته می‌شوند.
   const sql = new BinaLocalSql({ onProgress: m => console.log(m) });
   const r = await sql.query("SELECT TOP 100 * FROM [Bina].[dbo].[vw_All_Sanad] WHERE [_SrcTable] LIKE '%1200%'");
   // r = { rows, ms, loadMs, used, loaded, warnings, sql }
   جدول‌ها (View):
     vw_All_Sanad  (= Sanad = Sanad_ALL_ALL)   همهٔ سندها ؛ ستون مجازی _SrcTable = Sanad_سال_شرکت
     Sanad_1399_ALL ، Sanad_ALL_1200 ، Sanad_1399_1200
     vw_All_Coding (= Coding = Coding_ALL) ، Coding_1200
   ستون‌ها و عنوان‌ها (پویا — هیچ نام ستونی در کد ثابت نیست):
     • نام و نوع ستون‌های هر خانواده از استور columns بانک public خوانده می‌شود (کلید coding / sanad).
       عضو idIndex در ردیف‌ها نیست؛ خودش با نام idColumn (مثلاً id) جدا اضافه می‌شود.
     • نوع int/bigint/… → عدد؛ nvarchar → رشته. نام فیلد دقیقاً همان حروف کوچک متادیتاست (kol_code …).
     • عنوان فارسی: رکوردهای tk_dic با countrycode=2 که caption آن (کوچک‌شده) برابر نام ستون است → fieldname فارسی.
       engine.captions() = { kol_code: 'کد کل', … } برای گزینهٔ captions گرید.
     • اگر متادیتا نبود یا طول ردیف با چیدمان نخواند → C0… با هشدار آشکار (بی‌صدا نه).
   سرعت و حافظه:
     • فقط (سال، شرکت)هایی که کویری لازم دارد باز و در رم نگه داشته می‌شوند؛ بار دوم از رم می‌آید.
     • اگر کویری تک‌جدولی باشد و در WHERE شرطِ AND ی  _SrcTable LIKE '…' / = '…'  داشته باشد،
       بلوک‌های بقیهٔ جدول‌ها اصلاً خوانده یا باز نمی‌شوند (نتیجه دقیقاً همان است).
     • سقف حافظه: cacheMaxRows (قدیمی‌ترین‌ها آزاد می‌شوند) و queryMaxRows (خطای واضح).
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const ALASQL_URL = 'https://cdn.jsdelivr.net/npm/alasql@4';
  const tick = () => new Promise(r => setTimeout(r, 8));
  const DEC = new TextDecoder();
  /* نام و نوع ستون‌ها از متادیتای IndexedDB می‌آید (استور columns در بانک public) — نه از کد */
  const isNumType = t => /^(int|bigint|smallint|tinyint|decimal|numeric|float|real|money)/i.test(String(t || ''));
  let alasqlLoading = null;

  function ensureAlasql() {
    if (typeof alasql !== 'undefined') return Promise.resolve();
    return alasqlLoading || (alasqlLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = ALASQL_URL;
      s.onload = res;
      s.onerror = () => {
        alasqlLoading = null;
        rej(new Error('بارگذاری AlaSQL ناموفق بود (alasql.min.-js را کنار صفحه بگذار)'));
      };
      document.head.append(s);
    }));
  }
  /* نام واقعی استور بدون حساسیت به حروف (Sanad / sanad) */
  const findStore = (names, want) => Array.from(names).find(n => String(n).toLowerCase() === want.toLowerCase()) || null;
  const isBinary = v => v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v);
  async function gunzipJSON(v) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(DEC.decode(await new Response(stream).arrayBuffer()));
  }
  const toNum = x => (typeof x === 'string' && x.trim() !== '' && isFinite(x)) ? +x : x;

  function openDb(name) {
    return new Promise((res, rej) => {
      const q = indexedDB.open(name); /* بدون نسخه — هیچ‌وقت upgrade نمی‌کند */
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
      q.onblocked = () => rej(new Error('IndexedDB در تب دیگری بلوکه است.'));
    });
  }
  /* همهٔ رکوردهای یک استور */
  function readAll(db, store) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const rq = tx.objectStore(store).getAll();
      tx.oncomplete = () => res(rq.result);
      tx.onerror = tx.onabort = () => rej(tx.error || new Error('خطای IndexedDB'));
    });
  }
  /* ───────── تحلیل SQL ───────── */
  /* محتوای رشته‌ها و [..] را با فاصله پر می‌کند (طول ثابت) تا کلیدواژه‌های داخلشان دیده نشوند */
  function blank(s) {
    return s.replace(/'(?:[^']|'')*'/g, m => "'" + ' '.repeat(m.length - 2) + "'")
      .replace(/\[[^\]]*\]/g, m => '[' + ' '.repeat(m.length - 2) + ']');
  }
  const blankStrings = s => s.replace(/'(?:[^']|'')*'/g, m => "'" + ' '.repeat(m.length - 2) + "'");
  /* [Bina].[dbo]. ، Bina.dbo. ، dbo. */
  function stripDb(sql) {
    return String(sql || '')
      .replace(/(?:\[[^\]]+\]|\w+)\s*\.\s*(?:\[dbo\]|dbo)\s*\.\s*/gi, '')
      .replace(/(?:\[dbo\]|\bdbo)\s*\.\s*/gi, '');
  }
  /* نام جدول‌های بعد از FROM / JOIN (نام همان‌طور که تایپ شده) */
  function findRefs(sql) {
    const flat = blankStrings(sql),
      seen = new Map();
    const re = /\b(?:from|join)\s+(?:\[([^\]]+)\]|([A-Za-z_]\w*))/gi;
    let m;
    while ((m = re.exec(flat)) !== null) {
      const raw = m[1] || m[2];
      if (!seen.has(raw.toLowerCase())) seen.set(raw.toLowerCase(), raw);
    }
    return [...seen.values()];
  }

  function resolveRef(raw) {
    let m;
    const all = x => /^all$/i.test(x) ? null : String(x);
    if (/^(vw_all_sanad|sanad)$/i.test(raw)) return {
      family: 'Sanad',
      y: null,
      co: null
    };
    if ((m = /^sanad_(all|\d+)_(all|\d+)$/i.exec(raw))) return {
      family: 'Sanad',
      y: all(m[1]),
      co: all(m[2])
    };
    if (/^(vw_all_coding|coding)$/i.test(raw)) return {
      family: 'Coding',
      y: null,
      co: null
    };
    if ((m = /^coding_(all|\d+)$/i.exec(raw))) return {
      family: 'Coding',
      y: null,
      co: all(m[1])
    };
    return null;
  }
  /* شرط‌های AND ی روی _SrcTable (فقط کویری تک‌جدولی و بدون OR/UNION/زیرکویری) → آرایهٔ توابع تست نام جدول.
     همیشه «ابرمجموعهٔ» ردیف‌های لازم را نگه می‌دارد؛ خود WHERE بعداً توسط AlaSQL کامل اعمال می‌شود. */
  function srcFilters(sql) {
    const flat = blank(sql);
    const cnt = re => (flat.match(re) || []).length;
    if (cnt(/\bfrom\b/gi) !== 1 || cnt(/\bselect\b/gi) !== 1 || cnt(/\b(?:join|union|intersect|except)\b/gi)) return [];
    const w = /\bwhere\b/i.exec(flat);
    if (!w) return [];
    const start = w.index + 5;
    const e = /\b(?:group\s+by|order\s+by|having|limit|offset|fetch)\b/i.exec(flat.slice(start));
    const end = e ? start + e.index : flat.length;
    const fc = flat.slice(start, end);
    const cuts = [];
    let d = 0;
    for (let i = 0; i < fc.length; i++) {
      const c = fc[i];
      if (c === '(') d++;
      else if (c === ')') d--;
      else if (d === 0 && /[A-Za-z]/.test(c) && !/\w/.test(fc[i - 1] || ' ')) {
        const wd = /^[A-Za-z]+/.exec(fc.slice(i, i + 8))[0];
        if (/\w/.test(fc[i + wd.length] || ' ')) continue;
        const lw = wd.toLowerCase();
        if (lw === 'or') return []; /* OR در سطح اول → هیچ پیش‌فیلتری نمی‌زنیم */
        if (lw === 'and') cuts.push(i);
      }
    }
    const orig = sql.slice(start, end),
      pieces = [];
    let last = 0;
    cuts.forEach(i => {
      pieces.push(orig.slice(last, i));
      last = i + 3;
    });
    pieces.push(orig.slice(last));
    const PAT = /^\s*(?:(?:\[[^\]]+\]|\w+)\s*\.\s*)?\[?_SrcTable\]?\s*(=|like)\s*N?'((?:[^']|'')*)'\s*;?\s*$/i;
    const out = [];
    for (const p of pieces) {
      const m = PAT.exec(p);
      if (!m) continue;
      const pat = m[2].replace(/''/g, "'");
      if (m[1] === '=') {
        const v = pat.toLowerCase();
        out.push(n => n.toLowerCase() === v);
        continue;
      }
      if (pat.indexOf('[') >= 0) continue; /* کلاس کاراکتری در LIKE → ساده نگه می‌داریم */
      const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
      out.push(n => re.test(n));
    }
    return out;
  }
  class BinaLocalSql {
    constructor(opts) {
      opts = opts || {};
      this.onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
      this.cacheMaxRows = opts.cacheMaxRows || 2000000; /* بیشتر از این → قدیمی‌ترین‌ها از رم خارج می‌شوند */
      this.queryMaxRows = opts.queryMaxRows || 4000000; /* یک کویری بیشتر از این لازم داشت → خطا */
      this.titleCountry = opts.titleCountry === undefined ? 2 : opts.titleCountry; /* countrycode رکوردهای tk_dic که caption آن نام فنی ستون است؛ null = همه */
      this._metaDb = null; /* نام دیتابیس public (دارای catalog و columns) */
      this._layouts = new Map(); /* کلید خانواده (coding/sanad) → {names, row:[{n,num}], idName, sig} */
      this._titles = new Map(); /* نام ستون → عنوان فارسی */
      this._warns = []; /* هشدارهای ساختاری (نمایش داده می‌شوند) */
      this._notes = []; /* پوشش عنوان‌ها و تعارض‌ها (فقط کنسول و warnings()) */
      this._src = null; /* نام منبع → {table,family,year,company,parts,blocks} */
      this._cache = new Map(); /* نام منبع → {rows, t} */
      this._clock = 0;
      this._ready = null;
      this._chain = Promise.resolve();
    }
    _emit(m) {
      if (this.onProgress) {
        try {
          this.onProgress(m);
        } catch (e) {
          /* noop */ }
      }
    }
    /* کشف منبع‌ها فقط از روی کلیدها — هیچ بلوکی باز نمی‌شود */
    init() {
      if (this._ready) return this._ready;
      this._ready = (async () => {
        await ensureAlasql();
        if (typeof indexedDB.databases !== 'function') throw new Error('indexedDB.databases() در این مرورگر پشتیبانی نمی‌شود.');
        const src = new Map();
        for (const info of await indexedDB.databases()) {
          if (!info.name) continue;
          const db = await openDb(info.name);
          try {
            const names = db.objectStoreNames;
            if (findStore(names, 'catalog')) {
              if (findStore(names, 'columns')) this._metaDb = info.name;
              continue;
            } /* public /   قدیمی */
            for (const fam of ['Sanad', 'Coding']) {
              const store = findStore(names, fam); /* sanad هم قبول است */
              if (!store) continue;
              const keys = await new Promise((res, rej) => {
                const tx = db.transaction(store, 'readonly');
                const rq = tx.objectStore(store).getAllKeys();
                tx.oncomplete = () => res(rq.result);
                tx.onerror = tx.onabort = () => rej(tx.error);
              });
              for (const k of keys) {
                if (!Array.isArray(k)) continue;
                const isS = fam === 'Sanad';
                const name = isS ? 'Sanad_' + k[0] + '_' + k[1] : 'Coding_' + k[0];
                let s = src.get(name);
                if (!s) src.set(name, s = {
                  table: name,
                  family: fam,
                  year: isS ? k[0] : null,
                  company: isS ? k[1] : k[0],
                  parts: [],
                  blocks: 0
                });
                let p = s.parts.find(x => x.db === info.name);
                if (!p) s.parts.push(p = {
                  db: info.name,
                  store,
                  prefix: isS ? k.slice(0, 2) : k.slice(0, 1)
                });
                s.blocks++;
              }
            }
          } finally {
            db.close();
          }
        }
        this._src = src;
        await this._loadMeta();
      })().catch(e => {
        this._ready = null;
        throw e;
      });
      return this._ready;
    }
    /* فهرست منبع‌ها + وضعیت رم */
    async sources() {
      await this.init();
      return [...this._src.values()]
        .map(s => ({
          table: s.table,
          family: s.family,
          year: s.year,
          company: s.company,
          blocks: s.blocks,
          loaded: this._cache.has(s.table)
        }))
        .sort((a, b) => a.table.localeCompare(b.table, undefined, {
          numeric: true
        }));
    }
    /* چه چیزی الان در رم است */
    status() {
      const tables = [...this._cache.entries()].map(([table, e]) => ({
        table,
        rows: e.rows.length
      }));
      return {
        tables,
        totalRows: tables.reduce((a, t) => a + t.rows, 0)
      };
    }
    clear(name) {
      if (name == null) this._cache.clear();
      else this._cache.delete(name);
    }
    _warn(m) {
      if (this._warns.indexOf(m) >= 0) return;
      this._warns.push(m);
      try {
        console.warn('[BinaLocalSql] ' + m);
      } catch (e) {
        /* noop */ }
    }
    _note(m) {
      if (this._notes.indexOf(m) >= 0) return;
      this._notes.push(m);
      try {
        console.warn('[BinaLocalSql] ' + m);
      } catch (e) {
        /* noop */ }
    }
    _layoutFor(family) {
      return this._layouts.get(String(family).toLowerCase()) || null;
    }
    /* متادیتا را از بانک public می‌خواند: columns (چیدمان) و tk_dic (عنوان فارسی). خطا کشنده نیست → C0… با هشدار */
    async _loadMeta() {
      this._layouts = new Map();
      this._titles = new Map();
      this._warns = [];
      this._notes = [];
      if (!this._metaDb) {
        this._warn('بانک متادیتا (public با استورهای catalog و columns) پیدا نشد؛ ستون‌ها C0… نام می‌گیرند.');
        return;
      }
      let colRecs = [],
        dicRecs = [];
      try {
        const db = await openDb(this._metaDb);
        try {
          const cs = findStore(db.objectStoreNames, 'columns'),
            ds = findStore(db.objectStoreNames, 'tk_dic');
          colRecs = cs ? await readAll(db, cs) : [];
          dicRecs = ds ? await readAll(db, ds) : [];
          if (!ds) this._note('استور tk_dic پیدا نشد؛ عنوان ستون‌ها همان نام فنی می‌ماند.');
        } finally {
          db.close();
        }
      } catch (e) {
        this._warn('خواندن متادیتا ناموفق بود: ' + (e && e.message ? e.message : e));
        return;
      }
      /* ۱) چیدمان هر خانواده: columns منهای عضو idIndex */
      for (const rec of colRecs) {
        if (!rec || rec.key == null || !Array.isArray(rec.columns)) continue;
        const cols = rec.columns.map(c => (typeof c === 'string' ? {
          name: c,
          type: ''
        } : c));
        let idx = Number.isInteger(rec.idIndex) ? rec.idIndex : cols.findIndex(c => c && c.name === rec.idColumn);
        if (idx >= cols.length) idx = -1;
        const row = cols.filter((c, i) => i !== idx).map(c => ({
          n: String(c.name),
          num: isNumType(c.type)
        }));
        const idName = rec.idColumn || (idx >= 0 && cols[idx] ? String(cols[idx].name) : 'id');
        this._layouts.set(String(rec.key).toLowerCase(), {
          key: String(rec.key),
          row,
          idName,
          sig: row.map(c => c.n + (c.num ? '#' : '')).join('|') + '@' + idName
        });
      }
      if (!this._layouts.size) this._warn('استور columns خالی یا نامعتبر است؛ ستون‌ها C0… نام می‌گیرند.');
      /* ۲) عنوان فارسی: lowercase(caption) = نام ستون ← fieldname (کوچک‌ترین key در تعارض) */
      const wanted = new Map();
      this._layouts.forEach(l => l.row.forEach(c => wanted.set(c.n.toLowerCase(), c.n)));
      const best = new Map();
      for (const rec of dicRecs) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        if (this.titleCountry != null && String(rec.countrycode) !== String(this.titleCountry)) continue;
        const cap = String(rec.caption == null ? '' : rec.caption).trim().toLowerCase();
        const fa = String(rec.fieldname == null ? '' : rec.fieldname).trim();
        if (!cap || !fa || !wanted.has(cap)) continue;
        const prev = best.get(cap);
        if (!prev) {
          best.set(cap, {
            fa,
            key: Number(rec.key)
          });
          continue;
        }
        if (prev.fa === fa) continue;
        this._note('چند عنوان برای «' + wanted.get(cap) + '»: «' + prev.fa + '» و «' + fa + '» — عنوان با key کوچک‌تر می‌ماند.');
        if (Number(rec.key) < prev.key) best.set(cap, {
          fa,
          key: Number(rec.key)
        });
      }
      const missing = [];
      wanted.forEach((name, lower) => {
        const b = best.get(lower);
        if (b) this._titles.set(name, b.fa);
        else missing.push(name);
      });
      if (missing.length) this._note('عنوان فارسی در tk_dic پیدا نشد برای ' + missing.length + ' ستون: ' + missing.join(', '));
    }
    /* بعد از سینک دوباره: چیدمان و عنوان‌ها دوباره خوانده شود؛ جدول‌های رم با چیدمان قدیمی در اولین استفاده کنار می‌روند */
    async reloadMeta() {
      await this.init();
      await this._loadMeta();
    }
    /* {نام ستون: عنوان فارسی} — برای گزینهٔ captions گرید */
    captions() {
      const o = {};
      this._titles.forEach((v, k) => {
        o[k] = v;
      });
      return o;
    }
    /* چیدمان یک خانواده: { idName, columns:[{name,type}] } یا null */
    layout(family) {
      const l = this._layoutFor(family);
      return l ? {
        idName: l.idName,
        columns: l.row.map(c => ({
          name: c.n,
          numeric: c.num
        }))
      } : null;
    }
    warnings() {
      return this._warns.concat(this._notes);
    }
    _toRows(src, ids, raw) {
      const n = raw.length,
        out = new Array(n),
        name = src.table;
      const lay = this._layoutFor(src.family);
      let cols = lay ? lay.row : null;
      if (cols) {
        /* هم‌ترازی: طول ردیف واقعی = ستون‌های چیدمان منهای id */
        const first = raw.find(v => Array.isArray(v));
        if (first && first.length !== cols.length) {
          this._warn('طول ردیف ' + name + ' (' + first.length + ') با چیدمان ' + src.family + ' (' + cols.length + ' ستون بدون id) نمی‌خواند؛ ستون‌ها C0… نام می‌گیرند.');
          cols = null;
        }
      }
      const idName = lay ? lay.idName : 'Id';
      for (let i = 0; i < n; i++) {
        const r = raw[i],
          o = {};
        o[idName] = ids ? ids[i] : null;
        if (Array.isArray(r)) {
          if (cols) {
            for (let c = 0; c < cols.length; c++) o[cols[c].n] = cols[c].num ? toNum(r[c]) : r[c];
          } else {
            for (let c = 0; c < r.length; c++) o['C' + c] = r[c];
          }
        } else if (r && typeof r === 'object') Object.assign(o, r);
        o._SrcTable = name;
        out[i] = o;
      }
      return out;
    }
    /* یک منبع (سال، شرکت) — فقط یک‌بار از IndexedDB */
    async _load(src, pos) {
      const lay = this._layoutFor(src.family),
        sig = lay ? lay.sig : '';
      const hit = this._cache.get(src.table);
      if (hit && hit.sig === sig) {
        hit.t = ++this._clock;
        return {
          rows: hit.rows,
          fresh: false
        };
      }
      if (hit) this._cache.delete(src.table); /* چیدمان عوض شده → رم این جدول دوباره ساخته شود */
      const rows = [];
      for (const part of src.parts) {
        this._emit('خواندن ' + src.table + (pos ? ' (' + pos + ')' : '') + '…');
        const db = await openDb(part.db);
        let keys, vals;
        try {
          [keys, vals] = await new Promise((res, rej) => {
            const tx = db.transaction(part.store, 'readonly');
            const st = tx.objectStore(part.store);
            const range = IDBKeyRange.bound(part.prefix, part.prefix.concat([
              []
            ]));
            const rk = st.getAllKeys(range),
              rv = st.getAll(range);
            tx.oncomplete = () => res([rk.result, rv.result]);
            tx.onerror = tx.onabort = () => rej(tx.error || new Error('خطای IndexedDB'));
          });
        } finally {
          db.close();
        }
        const BATCH = 8;
        for (let i = 0; i < vals.length; i += BATCH) {
          const chunk = await Promise.all(vals.slice(i, i + BATCH).map(async (v, j) => {
            const key = keys[i + j];
            if (isBinary(v)) {
              const p = await gunzipJSON(v);
              return this._toRows(src, p.ids, p.rows);
            }
            if (Array.isArray(v)) return this._toRows(src, [key[key.length - 1]], [v]);
            return [];
          }));
          for (const arr of chunk)
            for (let k = 0; k < arr.length; k++) rows.push(arr[k]);
          if (i + BATCH < vals.length) await tick();
        }
      }
      this._cache.set(src.table, {
        rows,
        t: ++this._clock,
        sig
      });
      return {
        rows,
        fresh: true
      };
    }
    _evict(keep) {
      let total = 0;
      this._cache.forEach(e => {
        total += e.rows.length;
      });
      if (total <= this.cacheMaxRows) return;
      const order = [...this._cache.entries()].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].t - b[1].t);
      for (const [k, e] of order) {
        if (total <= this.cacheMaxRows) break;
        this._cache.delete(k);
        total -= e.rows.length;
      }
    }
    /* یک منبع (مثلاً 'Sanad_1399_1200') مستقیم، بدون AlaSQL و بدون کپی — آرایهٔ بافرشده را برمی‌گرداند.
       نتیجه را تغییر نده (همان آرایهٔ داخل رم است). خروجی: { rows, fresh } */
    rows(table) {
      const run = this._chain.then(async () => {
        await this.init();
        const s = this._src.get(table);
        if (!s) throw new Error('منبع «' + table + '» وجود ندارد.');
        const out = await this._load(s);
        this._evict(new Set([table]));
        return out;
      });
      this._chain = run.catch(() => {});
      return run;
    }
    /* کویری‌ها پشت‌سرهم اجرا می‌شوند (جدول‌های موقت AlaSQL مشترک‌اند) */
    query(sql) {
      const run = this._chain.then(() => this._query(sql));
      this._chain = run.catch(() => {});
      return run;
    }
    async _query(sqlIn) {
      await this.init();
      const sql = stripDb(sqlIn).trim();
      if (!sql) throw new Error('کویری خالی است.');
      const refs = findRefs(sql),
        warnings = [],
        used = new Set(),
        loaded = [];
      const filters = refs.length === 1 ? srcFilters(sql) : [];
      const t0 = performance.now();
      const registered = [],
        keep = new Set();
      let total = 0;
      try {
        for (const raw of refs) {
          const r = resolveRef(raw);
          if (!r) continue; /* نام ناشناس → خطای خود AlaSQL */
          let list = [...this._src.values()].filter(s => s.family === r.family &&
            (r.y == null || String(s.year) === r.y) && (r.co == null || String(s.company) === r.co));
          if (filters.length) list = list.filter(s => filters.every(f => f(s.table)));
          list.sort((a, b) => a.table.localeCompare(b.table, undefined, {
            numeric: true
          }));
          if (!list.length) warnings.push('هیچ جدولی برای «' + raw + '» با این شرط پیدا نشد.');
          const parts = [];
          for (let i = 0; i < list.length; i++) {
            const s = list[i];
            const {
              rows,
              fresh
            } = await this._load(s, (i + 1) + '/' + list.length);
            keep.add(s.table);
            if (fresh) loaded.push(s.table);
            total += rows.length;
            if (total > this.queryMaxRows)
              throw new Error('این کویری بیش از ' + this.queryMaxRows.toLocaleString('en-US') + ' ردیف لازم دارد. ' +
                'با شرط روی _SrcTable (مثلاً LIKE \'Sanad_1399_%\') یا نام جدول مشخص‌تر، دامنه را کوچک کن.');
            parts.push(rows);
          }
          let data = parts.length === 1 ? parts[0] : [];
          if (parts.length > 1) parts.forEach(a => {
            for (let k = 0; k < a.length; k++) data.push(a[k]);
          });
          list.forEach(s => used.add(s.table));
          delete alasql.tables[raw];
          alasql('CREATE TABLE [' + raw + ']');
          alasql.tables[raw].data = data; /* بدون کپی */
          registered.push(raw);
        }
        const loadMs = Math.round(performance.now() - t0);
        this._emit('اجرای کویری…');
        await tick();
        const t1 = performance.now();
        let res = alasql(sql);
        if (res && res.length && Array.isArray(res[0])) res = res[res.length - 1];
        res = res || [];
        if (res.length && (typeof res[0] !== 'object' || res[0] === null)) res = res.map(v => ({
          Value: v
        }));
        this._warns.forEach(w => {
          if (warnings.indexOf(w) < 0) warnings.push(w);
        });
        return {
          rows: res,
          ms: Math.round(performance.now() - t1),
          loadMs,
          used: [...used],
          loaded,
          warnings,
          sql
        };
      } finally {
        registered.forEach(n => {
          delete alasql.tables[n];
        });
        this._evict(keep);
      }
    }
  }
  root.BinaLocalSql = BinaLocalSql;
  BinaLocalSql._internals = {
    srcFilters,
    stripDb,
    findRefs,
    resolveRef
  }; /* برای تست */
})(typeof window !== 'undefined' ? window : globalThis);