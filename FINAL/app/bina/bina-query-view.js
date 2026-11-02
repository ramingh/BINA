/* ═══════════════════════════════════════════════════════════════════════
   bina-query-view.js — BinaQueryView v1.0.0
   نمای عمومی «پارامتر + کویری + گرید» برای هر منو. تعمیم BinaDocView.
   وابستگی: Tabulator · AlaSQL · bina-grid.js (≥1.2) · bina-local-sql.js
   const view = new BinaQueryView('#view', descriptor, { engine });
   await view.init(state?);            // state اختیاری (از getState قبلی)
   view.getState() / view.setState(s) / view.onShow() / view.getGrid() / view.on('loaded'|'error', fn)
   descriptor = {
     id: 'tab-13',                      // کلید تنظیمات گرید (storagePrefix) — برای هر منو یکتا
     family: 'Sanad',                   // 'Sanad' | 'Coding'
     params: ['company', 'year'],       // هر زیرمجموعه‌ای از company/year (Coding فقط company)
     sql: null,                         // null = مسیر سریع: rows() مستقیم (فقط Sanad با company+year، یا Coding با company)
                                        // رشته = کویری با جانشین {company} و {year}، مثل
                                        //   "SELECT Id, Tarikh, Bedehkar FROM Sanad_{year}_{company} WHERE Bedehkar > 0"
                                        //   "SELECT _SrcTable, COUNT(*) AS n FROM Sanad_{year}_ALL GROUP BY _SrcTable"
     captions: { Bedehkar: 'بدهکار' },  // عنوان ستون‌ها (اختیاری)
     hiddencolumns: ['_SrcTable'],
     defaultYear: 'first',              // 'first' | 'last'
     labels: {...}, gridOptions: {...}
   }
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';
const CSS = [
  '.bqv{font-family:IRANYekanX,Tahoma,system-ui,sans-serif;font-size:14px;line-height:1.8;color:#1c2b3a;height:100%;display:flex;flex-direction:column}',
  '.bqv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:8px 16px;margin-bottom:10px;flex:0 0 auto}',
  '.bqv-bar label{display:flex;align-items:center;gap:8px;font-size:13px;color:#12395e}',
  '.bqv-bar select{font:inherit;font-size:13px;padding:5px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;min-width:120px}',
  '.bqv-bar select:disabled{opacity:.5;cursor:wait}',
  '.bqv-info{font-size:13px;color:#64748b}',
  '.bqv-err{background:#fdeceb;color:#b42318;border:1px solid #f4c5c1;border-radius:10px;padding:8px 14px;margin:0 0 10px;white-space:pre-wrap}'
].join('\n');
function injectCss() {
  if (document.getElementById('bqv-css')) return;
  const st = document.createElement('style');
  st.id = 'bqv-css';
  st.textContent = CSS;
  document.head.append(st);
}
const numCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const SAFE = /^[\w\-]+$/;          /* مقدار پارامتر داخل کویری می‌نشیند؛ فقط حروف/عدد/_/- */
class BinaQueryView {
  constructor(target, descriptor, opts) {
    opts = opts || {};
    this.root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.root) throw new Error('BinaQueryView: container پیدا نشد.');
    if (typeof root.BinaGrid === 'undefined') throw new Error('BinaQueryView: bina-grid.js لود نشده است.');
    const d = this.desc = Object.assign({ family: 'Sanad', params: ['company', 'year'], sql: null,
      captions: null, hiddencolumns: ['_SrcTable'], defaultYear: 'first' }, descriptor);
    if (!d.id) throw new Error('BinaQueryView: descriptor.id لازم است.');
    this.useYear = d.family === 'Sanad' && d.params.includes('year');
    this.useCompany = d.params.includes('company');
    if (!this.useYear && !this.useCompany && !d.sql) throw new Error('BinaQueryView: بدون پارامتر باید sql داده شود.');
    if (!d.sql && !(d.family === 'Sanad' ? (this.useYear && this.useCompany) : this.useCompany))
      throw new Error('BinaQueryView: مسیر سریع (sql=null) فقط برای Sanad با company+year یا Coding با company ممکن است.');
    this.engine = opts.engine || new root.BinaLocalSql(opts.engineOptions);
    this.labels = Object.assign({
      company: 'شرکت', year: 'سال مالی', loading: 'در حال بارگذاری…', rows: 'ردیف',
      fromDb: 'خواندن از بانک', fromRam: 'از رم', query: 'کویری', grid: 'نمایش در گرید',
      noData: 'هیچ داده‌ای در بانک‌های لوکال این origin پیدا نشد.'
    }, d.labels);
    this.gridOptions = Object.assign({ height: '100%', pageSize: 500, pageSizeOptions: [100, 500, 1000],
      storagePrefix: 'BinaQV.' + d.id, captions: d.captions, noTranslateBody: true }, d.gridOptions, opts.gridOptions);
    this._byCompany = new Map();
    this._allYears = [];
    this._on = {};
    this._busy = false;
    this._build();
  }
  _build() {
    injectCss();
    this.root.classList.add('bqv');
    this.root.innerHTML =
      '<div class="bqv-bar">' +
      (this.useCompany ? '<label>' + esc(this.labels.company) + ' <select class="bqv-co"></select></label>' : '') +
      (this.useYear ? '<label>' + esc(this.labels.year) + ' <select class="bqv-yr"></select></label>' : '') +
      '<span class="bqv-info"></span></div><div class="bqv-err"></div><div class="bqv-grid" style="flex:1 1 auto;min-height:0"></div>';
    this.coEl = this.root.querySelector('.bqv-co');
    this.yrEl = this.root.querySelector('.bqv-yr');
    this.infoEl = this.root.querySelector('.bqv-info');
    this.errEl = this.root.querySelector('.bqv-err');
    this.errEl.style.display = 'none';
    this.grid = new root.BinaGrid(this.root.querySelector('.bqv-grid'), this.gridOptions);
    this._gridBuilt = new Promise(res => { this.grid.on('tableBuilt', () => res()); setTimeout(res, 3000); });
    this._onCo = () => { this._fillYears(); this._show(); };
    this._onYr = () => this._show();
    if (this.coEl) this.coEl.addEventListener('change', this._onCo);
    if (this.yrEl) this.yrEl.addEventListener('change', this._onYr);
  }
  _info(m) { if (this.infoEl) this.infoEl.textContent = m || ''; }
  _error(e) {
    this._info('');
    this.errEl.textContent = String((e && e.message) || e);
    this.errEl.style.display = '';
    this._emit('error', { error: e });
  }
  _fill(sel, values) { sel.innerHTML = values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join(''); }
  _yearsFor(company) { return this.useCompany ? (this._byCompany.get(company) || []) : this._allYears; }
  _fillYears() {
    if (!this.yrEl) return;
    const years = this._yearsFor(this.coEl ? this.coEl.value : null);
    this._fill(this.yrEl, years);
    if (years.length) this.yrEl.value = this.desc.defaultYear === 'last' ? years[years.length - 1] : years[0];
  }
  on(name, fn) { (this._on[name] = this._on[name] || []).push(fn); return this; }
  _emit(name, data) { (this._on[name] || []).forEach(fn => { try { fn(data); } catch (e) { /* noop */ } }); }
  /** کمبوها را از بانک پر می‌کند؛ state اختیاری (از getState) را اعمال و اولین نمایش را انجام می‌دهد */
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
      if (state && state.params) {              /* بازگردانی حالت قبلی (اگر هنوز معتبر باشد) */
        const p = state.params;
        if (this.coEl && p.company != null && this._byCompany.has(String(p.company))) { this.coEl.value = String(p.company); this._fillYears(); }
        if (this.yrEl && p.year != null && this._yearsFor(this.coEl ? this.coEl.value : null).includes(String(p.year))) this.yrEl.value = String(p.year);
      }
      await this._show(state);
    } catch (e) { this._error(e); }
  }
  /** حالت قابل ذخیره: پارامترها + صفحهٔ جاری + اسکرول (فیلتر/مرتب‌سازی ستون‌ها را خود گرید در localStorage نگه می‌دارد) */
  getState() {
    const st = { params: {}, page: 1, scrollTop: 0 };
    if (this.coEl) st.params.company = this.coEl.value;
    if (this.yrEl) st.params.year = this.yrEl.value;
    try {
      st.page = this.grid.table.getPage() || 1;
      const h = this.root.querySelector('.tabulator-tableholder');
      st.scrollTop = h ? h.scrollTop : 0;
    } catch (e) { /* noop */ }
    return st;
  }
  async setState(state) {
    if (!state || !state.params) return;
    const p = state.params;
    if (this.coEl && p.company != null) {
      if (!this._byCompany.has(String(p.company))) throw new Error('شرکت «' + p.company + '» وجود ندارد.');
      this.coEl.value = String(p.company);
      this._fillYears();
    }
    if (this.yrEl && p.year != null) {
      if (!this._yearsFor(this.coEl ? this.coEl.value : null).includes(String(p.year))) throw new Error('سال «' + p.year + '» وجود ندارد.');
      this.yrEl.value = String(p.year);
    }
    await this._show(state);
  }
  /** بعد از دوباره‌دیده‌شدن (مخفی بودن iframe) — Tabulator اندازه‌ها را از نو حساب کند */
  onShow() { try { this.grid.table.redraw(true); } catch (e) { /* noop */ } }
  get company() { return this.coEl ? this.coEl.value : null; }
  get year() { return this.yrEl ? this.yrEl.value : null; }
  getGrid() { return this.grid; }
  _template(sql) {
    const sub = (name, val) => {
      if (val == null) return;
      if (!SAFE.test(String(val))) throw new Error('مقدار پارامتر ' + name + ' نامعتبر است.');
    };
    sub('company', this.company); sub('year', this.year);
    return sql.replace(/\{company\}/g, this.company == null ? '' : this.company)
              .replace(/\{year\}/g, this.year == null ? '' : this.year);
  }
  async _show(restore) {
    if (this._busy) return;
    this._busy = true;
    [this.coEl, this.yrEl].forEach(e => { if (e) e.disabled = true; });
    this.errEl.style.display = 'none';
    this._info(this.labels.loading);
    try {
      await this._gridBuilt;
      const d = this.desc, t0 = performance.now();
      let rows, fromDb, own = false, extra = '';
      if (!d.sql) {
        const table = d.family === 'Sanad' ? 'Sanad_' + this.year + '_' + this.company : 'Coding_' + this.company;
        const r = await this.engine.rows(table);
        rows = r.rows; fromDb = r.fresh;
      } else {
        const r = await this.engine.query(this._template(d.sql));
        rows = r.rows; fromDb = r.loaded.length > 0; own = true;      /* خروجی تازهٔ کویری مال گرید است */
        extra = ' · ' + this.labels.query + ' ' + r.ms + ' ms';
        if (r.warnings.length) extra += ' · ' + r.warnings.join(' | ');
      }
      const loadMs = Math.round(performance.now() - t0);
      await this.grid.clearData();
      const t1 = performance.now();
      await this.grid.setData(rows, d.id, own ? { own: true } : undefined);
      const gridMs = Math.round(performance.now() - t1);
      try {
        const order = this.grid.getcolumnOrder();
        (d.hiddencolumns || []).forEach(f => {
          const c = order.find(x => x.field === f);
          if (c && c.visible) this.grid.togglecolumn(f);
        });
      } catch (e) { /* noop */ }
      if (restore && restore.page > 1) { try { await this.grid.table.setPage(restore.page); } catch (e) { /* noop */ } }
      if (restore && restore.scrollTop) {
        const h = this.root.querySelector('.tabulator-tableholder');
        if (h) h.scrollTop = restore.scrollTop;
      }
      this._info(rows.length.toLocaleString('fa-IR') + ' ' + this.labels.rows + ' — ' +
        (fromDb ? this.labels.fromDb + ' ' + loadMs + ' ms' : this.labels.fromRam) + extra +
        ' · ' + this.labels.grid + ' ' + gridMs + ' ms');
      this._emit('loaded', { params: { company: this.company, year: this.year }, rows: rows.length, fromDb, loadMs, gridMs });
    } catch (e) { this._error(e); }
    [this.coEl, this.yrEl].forEach(e => { if (e) e.disabled = false; });
    this._busy = false;
  }
  destroy() {
    if (this.coEl) this.coEl.removeEventListener('change', this._onCo);
    if (this.yrEl) this.yrEl.removeEventListener('change', this._onYr);
    try { this.grid.destroy(); } catch (e) { /* noop */ }
    this.root.innerHTML = '';
    this.root.classList.remove('bqv');
  }
  static get version() { return '1.0.0'; }
}
root.BinaQueryView = BinaQueryView;
})(typeof window !== 'undefined' ? window : globalThis);
