/* ═══════════════════════════════════════════════════════════════════════
bina-query-view.js — BinaQueryView v1.1.0 (PATCHED)
نمای عمومی «پارامتر + کویری + گرید» برای هر منو.

═══ تغییرات این نسخه ═══
تاریخ: 2026-11-02
۱. noTranslateBody: true + translate="no" روی گرید (ترمیم سرعت)
۲. پشتیبانی از textParams: متن‌باکس‌های فیلتر (نه فقط کمبو)
۳. دکمه «جستجو» وقتی textParams وجود دارد
۴. Enter در متن‌باکس → اجرای کویری
۵. اعتبارسنجی: اگر متن‌باکس خالی باشد، پیام نشان بده
══════════════════════════════════════════════════════════════════════ */

(function (root) {
'use strict';
const CSS = [
'.bqv{font-family:IRANYekanX,Tahoma,system-ui,sans-serif;font-size:14px;line-height:1.8;color:#1c2b3a;height:100%;display:flex;flex-direction:column}',
'.bqv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:8px 16px;margin-bottom:10px;flex:0 0 auto}',
'.bqv-bar label{display:flex;align-items:center;gap:8px;font-size:13px;color:#12395e}',
'.bqv-bar select,.bqv-bar input[type="text"]{font:inherit;font-size:13px;padding:5px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;min-width:100px}',
'.bqv-bar select:disabled,.bqv-bar input[type="text"]:disabled{opacity:.5;cursor:wait}',
'.bqv-bar input[type="text"]{width:110px}',
'.bqv-search{font:inherit;font-size:13px;padding:6px 18px;border:none;border-radius:9px;background:#285F92;color:#fff;cursor:pointer;font-weight:600}',
'.bqv-search:hover{background:#1e4a7a}',
'.bqv-search:disabled{opacity:.5;cursor:wait}',
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
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const SAFE = /^[\w.\- ]+$/;

class BinaQueryView {
constructor(selector, descriptor, options = {}) {
this.root = typeof selector === 'string' ? document.querySelector(selector) : selector;
if (!this.root) throw new Error('BinaQueryView: عنصر root پیدا نشد: ' + selector);
injectCss();
this.desc = descriptor || {};
this.engine = (options && options.engine) || (root.BinaBank && root.BinaBank.engine);
if (!this.engine) throw new Error('BinaQueryView: engine داده نشد.');
this.useCompany = (this.desc.params || []).includes('company');
this.useYear = (this.desc.params || []).includes('year');
this.textParams = this.desc.textParams || [];
this.hasTextParams = this.textParams.length > 0;
this.labels = Object.assign({
company: 'شرکت', year: 'سال مالی', loading: '…بارگذاری',
fromDb: 'از بانک', fromRam: 'از رم', query: 'کویری',
grid: 'گرید', rows: 'ردیف', noData: 'داده‌ای یافت نشد.',
search: 'جستجو', fillFields: 'لطفاً همه فیلدها را پر کنید.'
}, this.desc.labels || {});

/* FIX: noTranslateBody برای سرعت گرید */
this.gridOptions = Object.assign(
{ noTranslateBody: true, pageSize: 500 },
this.desc.gridOptions || {}
);

this._on = {};
this._build();
}
_build() {
this.root.classList.add('bqv');
let bar = '<div class="bqv-bar">';
if (this.useCompany) bar += '<label>' + esc(this.labels.company) + ' <select class="bqv-co"></select></label>';
if (this.useYear) bar += '<label>' + esc(this.labels.year) + ' <select class="bqv-yr"></select></label>';

/* NEW: متن‌باکس‌های textParams */
this.textEls = {};
for (const tp of this.textParams) {
bar += '<label>' + esc(tp.label) + ' <input type="text" class="bqv-text-' + esc(tp.key) + '" placeholder="' + esc(tp.placeholder || '') + '"></label>';
}

/* NEW: دکمه جستجو فقط اگر textParams وجود دارد */
if (this.hasTextParams) bar += '<button class="bqv-search">' + esc(this.labels.search) + '</button>';
bar += '<span class="bqv-info"></span></div>';

this.root.innerHTML = bar + '<div class="bqv-err"></div><div class="bqv-grid"></div>';
this.coEl = this.root.querySelector('.bqv-co');
this.yrEl = this.root.querySelector('.bqv-yr');
this.infoEl = this.root.querySelector('.bqv-info');
this.errEl = this.root.querySelector('.bqv-err');
this.searchBtn = this.root.querySelector('.bqv-search');
this.errEl.style.display = 'none';

/* NEW: ذخیره ref به متن‌باکس‌ها */
for (const tp of this.textParams) {
this.textEls[tp.key] = this.root.querySelector('.bqv-text-' + tp.key);
}

/* FIX: translate="no" روی کانتینر گرید */
const __gridContainer = this.root.querySelector('.bqv-grid');
if (__gridContainer) __gridContainer.setAttribute('translate', 'no');

this.grid = new root.BinaGrid(this.root.querySelector('.bqv-grid'), this.gridOptions);
this._gridBuilt = new Promise(res => { this.grid.on('tableBuilt', () => res()); setTimeout(res, 3000); });

/* رفتار combo ها: اگر textParams هست، بعد از تغییر شرکت کویری نزن (منتظر دکمه بمان) */
this._onCo = () => { this._fillYears(); if (!this.hasTextParams) this._show(); };
this._onYr = () => this._show();
if (this.coEl) this.coEl.addEventListener('change', this._onCo);
if (this.yrEl) this.yrEl.addEventListener('change', this._onYr);

/* NEW: دکمه جستجو */
if (this.searchBtn) this.searchBtn.addEventListener('click', () => this._show());

/* NEW: Enter در متن‌باکس‌ها → جستجو */
for (const tp of this.textParams) {
const el = this.textEls[tp.key];
if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._show(); });
}
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
_emit(name, data) { (this._on[name] || []).forEach(fn => { try { fn(data); } catch (e) {} }); }
async init(state) {
try {
const fam = this.desc.family;
console.log('[BQV] init: descriptor=', this.desc);
console.log('[BQV] init: family=' + fam + ', useCompany=' + this.useCompany + ', useYear=' + this.useYear + ', hasTextParams=' + this.hasTextParams);
const list = (await this.engine.sources()).filter(s => s.family === fam);
console.log('[BQV] init: sources for family "' + fam + '" =', list.length, list);
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
/* اگر textParams هست، اولین نمایش نزن — منتظر دکمه جستجو بمان */
if (!this.hasTextParams) await this._show(state);
} catch (e) { this._error(e); }
}
getState() {
const st = { params: {}, page: 1, scrollTop: 0 };
if (this.coEl) st.params.company = this.coEl.value;
if (this.yrEl) st.params.year = this.yrEl.value;
for (const tp of this.textParams) {
if (this.textEls[tp.key]) st.params[tp.key] = this.textEls[tp.key].value;
}
try {
st.page = this.grid.table.getPage() || 1;
const h = this.root.querySelector('.tabulator-tableholder');
st.scrollTop = h ? h.scrollTop : 0;
} catch (e) {}
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
for (const tp of this.textParams) {
if (this.textEls[tp.key] && p[tp.key] != null) this.textEls[tp.key].value = p[tp.key];
}
await this._show(state);
}
onShow() { try { this.grid.table.redraw(true); } catch (e) {} }
get company() { return this.coEl ? this.coEl.value : null; }
get year() { return this.yrEl ? this.yrEl.value : null; }
getGrid() { return this.grid; }

/* NEW: قالب‌سازی SQL با جانشین {company}, {year}, و {textParam} */
_template(sql) {
console.log('[BQV] _template: input SQL=', sql);
console.log('[BQV] _template: company=' + this.company + ', year=' + this.year);
const sub = (name, val) => {
if (val == null || val === '') return;
if (!SAFE.test(String(val))) throw new Error('مقدار پارامتر ' + name + ' نامعتبر است.');
};
sub('company', this.company);
if (this.useYear) sub('year', this.year);
let result = sql.replace(/\{company\}/g, this.company == null ? '' : this.company)
.replace(/\{year\}/g, this.year == null ? '' : this.year);
/* NEW: جانشین textParams */
for (const tp of this.textParams) {
const val = this.textEls[tp.key] ? this.textEls[tp.key].value : '';
console.log('[BQV] _template: textParam ' + tp.key + '="' + val + '"');
if (!val) throw new Error(this.labels.fillFields);
sub(tp.key, val);
result = result.replace(new RegExp('\\{' + tp.key + '\\}', 'g'), val);
}
console.log('[BQV] _template: final SQL=', result);
return result;
}

/* NEW: اعتبارسنجی قبل از اجرای کویری */
_validateTextParams() {
if (!this.hasTextParams) return true;
if (!this.company) { this._info(this.labels.fillFields); return false; }
for (const tp of this.textParams) {
const val = this.textEls[tp.key] ? this.textEls[tp.key].value.trim() : '';
if (!val) { this._info(this.labels.fillFields); return false; }
}
return true;
}

async _show(restore) {
if (this._busy) return;
if (this.hasTextParams && !this._validateTextParams()) return;
this._busy = true;
[this.coEl, this.yrEl].forEach(e => { if (e) e.disabled = true; });
for (const tp of this.textParams) { if (this.textEls[tp.key]) this.textEls[tp.key].disabled = true; }
if (this.searchBtn) this.searchBtn.disabled = true;
this.errEl.style.display = 'none';
this._info(this.labels.loading);
try {
await this._gridBuilt;
const d = this.desc, t0 = performance.now();
console.log('[BQV] _show: desc.id=' + d.id + ', family=' + d.family + ', sql=' + (d.sql ? 'has SQL' : 'null (fast path)'));
let rows, fromDb, own = false, extra = '';
if (!d.sql) {
const table = d.family === 'Sanad' ? 'Sanad_' + this.year + '_' + this.company : 'Coding_' + this.company;
console.log('[BQV] _show: fast path, table=' + table);
const r = await this.engine.rows(table);
rows = r.rows; fromDb = r.fresh;
console.log('[BQV] _show: rows() result: count=' + rows.length + ', fresh=' + fromDb);
if (rows.length) console.log('[BQV] _show: first row=', rows[0]);
} else {
console.log('[BQV] _show: query path, running SQL...');
const r = await this.engine.query(this._template(d.sql));
rows = r.rows; fromDb = r.loaded.length > 0; own = true;
extra = ' · ' + this.labels.query + ' ' + r.ms + ' ms';
console.log('[BQV] _show: query result: count=' + rows.length + ', ms=' + r.ms + ', fromDb=' + fromDb);
console.log('[BQV] _show: warnings=', r.warnings);
console.log('[BQV] _show: loaded sources=', r.loaded);
if (rows.length) console.log('[BQV] _show: first row=', rows[0]);
else console.log('[BQV] ⚠️ NO ROWS RETURNED — check SQL and column names');
if (r.warnings.length) extra += ' · ' + r.warnings.join(' | ');
}
const loadMs = Math.round(performance.now() - t0);
console.log('[BQV] _show: loadMs=' + loadMs + ', rows.length=' + rows.length);
await this.grid.clearData();
const t1 = performance.now();
console.log('[BQV] _show: calling grid.setData with ' + rows.length + ' rows...');
await this.grid.setData(rows, d.id, own ? { own: true } : undefined);
const gridMs = Math.round(performance.now() - t1);
console.log('[BQV] _show: gridMs=' + gridMs);
try {
const order = this.grid.getcolumnOrder();
(d.hiddenColumns || []).forEach(f => {
const c = order.find(x => x.field === f);
if (c && c.visible) this.grid.togglecolumn(f);
});
} catch (e) {}
if (restore && restore.page > 1) { try { await this.grid.table.setPage(restore.page); } catch (e) {} }
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
for (const tp of this.textParams) { if (this.textEls[tp.key]) this.textEls[tp.key].disabled = false; }
if (this.searchBtn) this.searchBtn.disabled = false;
this._busy = false;
}
destroy() {
if (this.coEl) this.coEl.removeEventListener('change', this._onCo);
if (this.yrEl) this.yrEl.removeEventListener('change', this._onYr);
try { this.grid.destroy(); } catch (e) {}
this.root.innerHTML = '';
this.root.classList.remove('bqv');
}
static get version() { return '1.1.0-patched'; }
}
root.BinaQueryView = BinaQueryView;
})(typeof window !== 'undefined' ? window : globalThis);
