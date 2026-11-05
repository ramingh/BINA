/* ═══════════════════════════════════════════════════════════════════════
bina-query-view.js — BinaQueryView v2.1 (بر اساس engine داینامیک)
══════════════════════════════════════════════════════════════════════

الگوریتم:
- نام ستون‌ها، نوع و captions همگی از engine (BinaLocalSql) می‌آیند
- SQL با نام واقعی ستون‌ها (lowercase): WHERE kol_code = 11
- هیچ C0/C1 یا [FieldName] در کد نیست
- {company}, {year}, {inputKey} در SQL جایگزین می‌شوند

descriptor:
  P['tab-NN'] = {
    family:'Coding', params:['company'],
    textParams:[{key:'kOlCode',label:'کد کل'}],
    sql:"SELECT * FROM Coding_{company} WHERE kol_code={kOlCode}",
    // یا queries:[{id:'q1',sql:...,output:'grid'}, ...]
    hiddenColumns:['_SrcTable']
  };
══════════════════════════════════════════════════════════════════════ */

(function (root) {
'use strict';

const CSS = [
'.bqv{font-family:IRANYekanX,Tahoma,system-ui,sans-serif;font-size:14px;line-height:1.8;color:#1c2b3a;height:100%;display:flex;flex-direction:column}',
'.bqv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:8px 16px;margin-bottom:10px;flex:0 0 auto}',
'.bqv-bar label{display:flex;align-items:center;gap:8px;font-size:13px;color:#12395e}',
'.bqv-bar select,.bqv-bar input[type="text"]{font:inherit;font-size:13px;padding:5px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;min-width:100px}',
'.bqv-bar input[type="text"]{width:110px}',
'.bqv-search{font:inherit;font-size:13px;padding:6px 18px;border:none;border-radius:9px;background:#285F92;color:#fff;cursor:pointer;font-weight:600}',
'.bqv-search:hover{background:#1e4a7a}',
'.bqv-info{font-size:13px;color:#64748b}',
'.bqv-err{background:#fdeceb;color:#b42318;border:1px solid #f4c5c1;border-radius:10px;padding:8px 14px;margin:0 0 10px;white-space:pre-wrap}',
'.bqv-outputs{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}',
'.bqv-output{display:flex;align-items:center;gap:6px}',
'.bqv-output label{font-size:13px;color:#12395e}',
'.bqv-output input{font:inherit;font-size:13px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;min-width:120px}',
'.bqv-grid{flex:1 1 auto;min-height:200px}'
].join('\n');

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const numCmp = (a,b) => String(a).localeCompare(String(b),undefined,{numeric:true});

class BinaQueryView {
  constructor(selector, descriptor, options = {}) {
    this.root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!this.root) throw new Error('BinaQueryView: root پیدا نشد: ' + selector);
    if (!document.getElementById('bqv-css')) {
      const st = document.createElement('style'); st.id = 'bqv-css'; st.textContent = CSS; document.head.append(st);
    }
    this.desc = descriptor || {};
    this.engine = options.engine || (root.BinaBank && root.BinaBank.engine);
    if (!this.engine) throw new Error('BinaQueryView: engine داده نشد.');
    this.useCompany = (this.desc.params || []).includes('company');
    this.useYear = (this.desc.params || []).includes('year');
    this.textParams = this.desc.textParams || [];
    this.hasTextParams = this.textParams.length > 0;
    this.hasQueries = Array.isArray(this.desc.queries) && this.desc.queries.length > 0;
    this._queryResults = {};
    this._on = {};
    this.labels = Object.assign({
      company:'شرکت', year:'سال مالی', loading:'…بارگذاری', fromDb:'از بانک', fromRam:'از رم',
      query:'کویری', grid:'گرید', rows:'ردیف', noData:'داده‌ای یافت نشد.', search:'جستجو', fillFields:'لطفاً همه فیلدها را پر کنید.'
    }, this.desc.labels || {});
    this.gridOptions = Object.assign({ noTranslateBody:true, pageSize:500 }, this.desc.gridOptions || {});
    this._build();
  }

  _build() {
    this.root.classList.add('bqv');
    let bar = '<div class="bqv-bar">';
    if (this.useCompany) bar += '<label>'+esc(this.labels.company)+' <select class="bqv-co"></select></label>';
    if (this.useYear) bar += '<label>'+esc(this.labels.year)+' <select class="bqv-yr"></select></label>';
    this.textEls = {};
    for (const tp of this.textParams)
      bar += '<label>'+esc(tp.label)+' <input type="text" class="bqv-text-'+esc(tp.key)+'" placeholder="'+esc(tp.placeholder||'')+'"></label>';
    if (this.hasTextParams) bar += '<button class="bqv-search">'+esc(this.labels.search)+'</button>';
    bar += '<span class="bqv-info"></span></div>';

    let outHtml = '';
    if (this.hasQueries) {
      outHtml = '<div class="bqv-outputs">';
      for (const q of this.desc.queries) {
        if (typeof q.output === 'string' && q.output.startsWith('textbox:')) {
          const elId = q.output.split(':')[1];
          outHtml += '<div class="bqv-output"><label>'+esc(q.outputLabel||elId)+' <input type="text" id="'+esc(elId)+'" class="bqv-out-'+esc(elId)+'" readonly></label></div>';
        }
      }
      outHtml += '</div>';
    }
    this.root.innerHTML = bar + outHtml + '<div class="bqv-err"></div><div class="bqv-grid"></div>';
    this.coEl = this.root.querySelector('.bqv-co');
    this.yrEl = this.root.querySelector('.bqv-yr');
    this.infoEl = this.root.querySelector('.bqv-info');
    this.errEl = this.root.querySelector('.bqv-err');
    this.searchBtn = this.root.querySelector('.bqv-search');
    this.errEl.style.display = 'none';
    for (const tp of this.textParams) this.textEls[tp.key] = this.root.querySelector('.bqv-text-'+tp.key);
    const gc = this.root.querySelector('.bqv-grid'); if (gc) gc.setAttribute('translate','no');
    this.grid = new root.BinaGrid(this.root.querySelector('.bqv-grid'), this.gridOptions);
    this._gridBuilt = new Promise(res => { this.grid.on('tableBuilt',()=>res()); setTimeout(res,3000); });
    this._onCo = () => { this._fillYears(); if (!this.hasTextParams) this._show(); };
    this._onYr = () => this._show();
    if (this.coEl) this.coEl.addEventListener('change', this._onCo);
    if (this.yrEl) this.yrEl.addEventListener('change', this._onYr);
    if (this.searchBtn) this.searchBtn.addEventListener('click', () => this._show());
    for (const tp of this.textParams) {
      const el = this.textEls[tp.key];
      if (el) el.addEventListener('keydown', e => { if (e.key==='Enter') this._show(); });
    }
  }

  _info(m) { if (this.infoEl) this.infoEl.textContent = m || ''; }
  _error(e) { this._info(''); this.errEl.textContent = String((e&&e.message)||e); this.errEl.style.display=''; this._emit('error',{error:e}); }
  _fill(sel,vals) { sel.innerHTML = vals.map(v => '<option value="'+esc(v)+'">'+esc(v)+'</option>').join(''); }
  _yearsFor(co) { return this.useCompany ? (this._byCompany.get(co)||[]) : this._allYears; }
  _fillYears() {
    if (!this.yrEl) return;
    const yrs = this._yearsFor(this.coEl?this.coEl.value:null);
    this._fill(this.yrEl, yrs);
    if (yrs.length) this.yrEl.value = this.desc.defaultYear==='last' ? yrs[yrs.length-1] : yrs[0];
  }
  on(n,fn) { (this._on[n]=this._on[n]||[]).push(fn); return this; }
  _emit(n,d) { (this._on[n]||[]).forEach(fn=>{try{fn(d)}catch(e){}}); }

  /* ═══ جایگزینی {company}, {year}, {inputKey}, {qId.field} در SQL ═══ */
  _resolveSql(sql) {
    let r = String(sql)
      .replace(/\{company\}/g, this.company || '')
      .replace(/\{year\}/g, this.year || '');
    for (const tp of this.textParams) {
      const v = this.textEls[tp.key] ? this.textEls[tp.key].value.trim() : '';
      r = r.replace(new RegExp('\\{' + tp.key + '\\}', 'g'), v);
    }
    r = r.replace(/\{(\w+)\.(\w+)\}/g, (m, qId, fld) => {
      const prev = this._queryResults[qId];
      if (!prev || !prev.length) throw new Error('نتیجه‌ی کویری "' + qId + '" موجود نیست');
      return prev[0][fld];
    });
    return r;
  }

  _validate() {
    if (!this.hasTextParams) return true;
    if (this.useCompany && !this.company) { this._info(this.labels.fillFields); return false; }
    for (const tp of this.textParams) {
      const v = this.textEls[tp.key] ? this.textEls[tp.key].value.trim() : '';
      if (!v) { this._info(this.labels.fillFields); return false; }
    }
    return true;
  }

  /* ═══ چند کویری (queries array) ═══ */
  async _runQueries() {
    this._queryResults = {};
    for (const q of this.desc.queries) {
      const sql = this._resolveSql(q.sql);
      console.log('[BQV] query "' + q.id + '":', sql);
      const r = await this.engine.query(sql);
      this._queryResults[q.id] = r.rows;
      console.log('[BQV] query "' + q.id + '": count=' + r.rows.length, r.rows[0] || '(empty)');
      if (q.output === 'grid') {
        try { this.grid.options.captions = Object.assign({}, this.engine.captions(), (this.desc.gridOptions||{}).captions || {}); } catch(e) {}
        await this.grid.clearData();
        await this.grid.setData(r.rows, this.desc.id, { own: true });
      } else if (typeof q.output === 'string' && q.output.startsWith('textbox:')) {
        const elId = q.output.split(':')[1];
        const el = this.root.querySelector('#' + elId) || this.root.querySelector('.bqv-out-' + elId);
        if (el) el.value = r.rows.length ? (q.extractField ? r.rows[0][q.extractField] : JSON.stringify(r.rows[0])) : '';
      }
    }
    const gridQ = this.desc.queries.find(q => q.output === 'grid');
    if (gridQ) {
      const n = (this._queryResults[gridQ.id] || []).length;
      this._info(n.toLocaleString('fa-IR') + ' ' + this.labels.rows);
    }
  }

  /* ═══ main: _show ═══ */
  async _show() {
    if (this._busy) return;
    if (this.hasTextParams && !this._validate()) return;
    this._busy = true;
    [this.coEl, this.yrEl].forEach(e => { if (e) e.disabled = true; });
    for (const tp of this.textParams) { if (this.textEls[tp.key]) this.textEls[tp.key].disabled = true; }
    if (this.searchBtn) this.searchBtn.disabled = true;
    this.errEl.style.display = 'none';
    this._info(this.labels.loading);
    try {
      await this._gridBuilt;
      const d = this.desc, t0 = performance.now();
      let rows = [], fromDb = false, extra = '';

      if (this.hasQueries) {
        console.log('[BQV] _show: multi-query (' + d.queries.length + ' queries)');
        await this._runQueries();
        const gridQ = d.queries.find(q => q.output === 'grid');
        if (gridQ) {
          rows = this._queryResults[gridQ.id] || [];
          fromDb = true;
          extra = ' · ' + this.labels.query + ' ' + Math.round(performance.now() - t0) + ' ms';
        }
      } else if (d.sql) {
        console.log('[BQV] _show: sql path');
        const sql = this._resolveSql(d.sql);
        console.log('[BQV] SQL:', sql);
        const r = await this.engine.query(sql);
        rows = r.rows; fromDb = r.loaded.length > 0;
        extra = ' · ' + this.labels.query + ' ' + r.ms + ' ms';
        console.log('[BQV] result: count=' + rows.length, rows[0] || '(empty)');
        /* captions از engine + descriptor */
        try { this.grid.options.captions = Object.assign({}, this.engine.captions(), (d.gridOptions||{}).captions || {}); } catch(e) {}
        await this.grid.clearData();
        await this.grid.setData(rows, d.id, { own: true });
      } else {
        /* fast path: rows مستقیم */
        const tbl = d.family === 'Sanad' ? 'Sanad_' + this.year + '_' + this.company : d.family + '_' + this.company;
        console.log('[BQV] _show: fast path, table=' + tbl);
        const r = await this.engine.rows(tbl);
        rows = r.rows; fromDb = r.fresh;
        try { this.grid.options.captions = Object.assign({}, this.engine.captions(), (d.gridOptions||{}).captions || {}); } catch(e) {}
        await this.grid.clearData();
        await this.grid.setData(rows, d.id);
      }

      /* hidden columns */
      try {
        const order = this.grid.getColumnOrder();
        (d.hiddenColumns || []).forEach(f => {
          const c = order.find(x => x.field === f);
          if (c && c.visible) this.grid.togglecolumn(f);
        });
      } catch(e) {}

      const loadMs = Math.round(performance.now() - t0);
      this._info(rows.length.toLocaleString('fa-IR') + ' ' + this.labels.rows + ' — ' +
        (fromDb ? this.labels.fromDb + ' ' + loadMs + ' ms' : this.labels.fromRam) + extra);
      this._emit('loaded', { params: { company: this.company, year: this.year }, rows: rows.length, fromDb, loadMs });
    } catch(e) { this._error(e); }
    [this.coEl, this.yrEl].forEach(e => { if (e) e.disabled = false; });
    for (const tp of this.textParams) { if (this.textEls[tp.key]) this.textEls[tp.key].disabled = false; }
    if (this.searchBtn) this.searchBtn.disabled = false;
    this._busy = false;
  }

  async init(state) {
    try {
      const fam = this.desc.family;
      const list = (await this.engine.sources()).filter(s => s.family === fam);
      if (!list.length) throw new Error(this.labels.noData);
      this._byCompany = new Map();
      const years = new Set();
      list.forEach(s => {
        const c = String(s.company);
        if (!this._byCompany.has(c)) this._byCompany.set(c, []);
        if (s.year != null) { this._byCompany.get(c).push(String(s.year)); years.add(String(s.year)); }
      });
      this._byCompany.forEach(y => y.sort(numCmp));
      this._allYears = [...years].sort(numCmp);
      if (this.coEl) this._fill(this.coEl, [...this._byCompany.keys()].sort(numCmp));
      this._fillYears();
      if (state && state.params) {
        const p = state.params;
        if (this.coEl && p.company != null && this._byCompany.has(String(p.company))) { this.coEl.value = String(p.company); this._fillYears(); }
        if (this.yrEl && p.year != null && this._yearsFor(this.coEl ? this.coEl.value : null).includes(String(p.year))) this.yrEl.value = String(p.year);
      }
      if (!this.hasTextParams) await this._show();
    } catch(e) { this._error(e); }
  }

  getState() {
    const st = { params: {}, page: 1, scrollTop: 0 };
    if (this.coEl) st.params.company = this.coEl.value;
    if (this.yrEl) st.params.year = this.yrEl.value;
    for (const tp of this.textParams) if (this.textEls[tp.key]) st.params[tp.key] = this.textEls[tp.key].value;
    try { st.page = this.grid.table.getPage() || 1; const h = this.root.querySelector('.tabulator-tableholder'); st.scrollTop = h ? h.scrollTop : 0; } catch(e) {}
    return st;
  }
  async setState(state) {
    if (!state || !state.params) return;
    const p = state.params;
    if (this.coEl && p.company != null) { this.coEl.value = String(p.company); this._fillYears(); }
    if (this.yrEl && p.year != null) this.yrEl.value = String(p.year);
    for (const tp of this.textParams) if (this.textEls[tp.key] && p[tp.key] != null) this.textEls[tp.key].value = p[tp.key];
    await this._show();
  }
  onShow() { try { this.grid.table.redraw(true); } catch(e) {} }
  get company() { return this.coEl ? this.coEl.value : null; }
  get year() { return this.yrEl ? this.yrEl.value : null; }
  getGrid() { return this.grid; }
  destroy() {
    if (this.coEl) this.coEl.removeEventListener('change', this._onCo);
    if (this.yrEl) this.yrEl.removeEventListener('change', this._onYr);
    try { this.grid.destroy(); } catch(e) {}
    this.root.innerHTML = ''; this.root.classList.remove('bqv');
  }
  static get version() { return '2.1.0'; }
}
root.BinaQueryView = BinaQueryView;
})(typeof window !== 'undefined' ? window : globalThis);
