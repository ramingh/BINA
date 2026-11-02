/* ═══════════════════════════════════════════════════════════════════════
bina-doc-view.js — BinaDocView v1.0.0 (PATCHED — ترمیم سرعت گرید)
«نمایش اسناد»: دو کمبو (شرکت، سال مالی) + BinaGrid؛ داده از BinaLocalSql.
وابستگی‌ها (به همین ترتیب لود شوند):
Tabulator 5.6.1 · AlaSQL · bina-grid.js · bina-local-sql. js · bina-doc-view.js

═══ تغییرات این نسخه (PATCH) ═══
تاریخ: 2026-11-02
علت: مترجم (Dic_sek.Js) روی هر سلول گرید اجرا می‌شد → کندی شدید
تغییرات:
  1. اضافه شدن noTranslateBody: true به gridOptions (پیش‌فرض)
  2. اضافه شدن translate="no" به عنصر .bdv-grid بعد از ساخت
نتیجه مورد انتظار: جلوگیری از اجرای مترجم روی سلول‌های گرید
══════════════════════════════════════════════════════════════════════ */

(function (root) {
'use strict';
const CSS = [
'.bdv{font-family:IRANYekanX,Tahoma,system-ui,sans-serif;font-size:14px;line-height:1.8;color:#1c2b3a}',
'.bdv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px 16px;margin-bottom:14px}',
'.bdv-bar label{display:flex;align-items:center;gap:8px;font-size:13px;color:#12395e}',
'.bdv-bar select{font:inherit;font-size:13px;padding:5px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;min-width:120px}',
'.bdv-bar select:disabled{opacity:.5;cursor:wait}',
'.bdv-info{font-size:13px;color:#64748b}',
'.bdv-err{background:#fdeceb;color:#b42318;border:1px solid #f4c5c1;border-radius:10px;padding:8px 14px;margin:0 0 14px;white-space:pre-wrap}'
].join('\n');
function injectCss() {
if (document.getElementById('bdv-css')) return;
const st = document.createElement('style');
st.id = 'bdv-css';
st.textContent = CSS;
document.head.append(st);
}
const numCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

class BinaDocView {
constructor(selector, opts) {
opts = opts || {};
this.root = typeof selector === 'string' ? document.querySelector(selector) : selector;
if (!this.root) throw new Error('BinaDocView: عنصر root پیدا نشد: ' + selector);
injectCss();
this.engine = opts.engine || new root.BinaLocalSql({ onProgress: m => this._info(m) }, opts.engineOptions);
this.defaultYear = opts.defaultYear === 'last' ? 'last' : 'first';
this.hiddencolumns = opts.hiddencolumns || ['_SrcTable'];
this.labels = Object.assign({
company: 'شرکت', year: 'سال مالی', loading: 'در حال بارگذاری…', rows: 'ردیف',
fromDb: 'خواندن از بانک', fromRam: 'از رم', grid: 'نمایش در گرید',
noData: 'هیچ جدول Sanad در بانک‌های لوکال این origin پیدا نشد.'
}, opts.labels);

/* ═══ FIX APPLIED — خط اضافه‌شده ═══
   noTranslateBody: true → جلوگیری از ترجمه سلول‌های گرید */
this.gridOptions = Object.assign(
{ height: '72vh', pageSize: 500, pageSizeOptions: [100, 500, 1000], storagePrefix: 'BinaDocView', noTranslateBody: true },
opts.gridOptions);
/* ═══ پایان FIX ═══ */

this._byCompany = new Map();
this._on = {};
this._busy = false;
this._build();
}
_build() {
injectCss();
this.root.classList.add('bdv');
this.root.innerHTML =
'<div class="bdv-bar">' +
'<label>' + esc(this.labels.company) + ' <select class="bdv-co"></select></label>' +
'<label>' + esc(this.labels.year) + ' <select class="bdv-yr"></select></label>' +
'<span class="bdv-info"></span>' +
'</div>' +
'<div class="bdv-err"></div>' +
'<div class="bdv-grid"></div>';
this.coEl = this.root.querySelector('.bdv-co');
this.yrEl = this.root.querySelector('.bdv-yr');
this.infoEl = this.root.querySelector('.bdv-info');
this.errEl = this.root.querySelector('.bdv-err');
this.errEl.style.display = 'none';

/* ═══ FIX APPLIED — ۲ خط اضافه‌شده ═══
   translate="no" روی کانتینر گرید → مترجم کل درخت گرید را رد می‌کند */
const __gridContainer = this.root.querySelector('.bdv-grid');
if (__gridContainer) __gridContainer.setAttribute('translate', 'no');
/* ═══ پایان FIX ═══ */

this.grid = new root.BinaGrid(this.root.querySelector('.bdv-grid'), this.gridOptions);
this._gridBuilt = new Promise(res => { this.grid.on('tableBuilt', () => res()); setTimeout(res, 3000); });
this._onCo = () => { this._fillYears(); this._show(); };
this._onYr = () => this._show();
this.coEl.addEventListener('change', this._onCo);
this.yrEl.addEventListener('change', this._onYr);
}
_info(m) { if (this.infoEl) this.infoEl.textContent = m || ''; }
_error(e) {
this._info('');
this.errEl.textContent = String((e && e.message) || e);
this.errEl.style.display = '';
this._emit('error', { error: e });
}
_fill(sel, values) {
sel.innerHTML = values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
}
_fillYears() {
const years = this._byCompany.get(this.coEl.value) || [];
this._fill(this.yrEl, years);
if (years.length) this.yrEl.value = this.defaultYear === 'last' ? years[years.length - 1] : years[0];
}
on(name, fn) { (this._on[name] = this._on[name] || []).push(fn); return this; }
_emit(name, data) { (this._on[name] || []).forEach(fn => { try { fn(data); } catch (e) { /* noop */ } }); }
async init() {
try {
const list = (await this.engine.sources()).filter(s => s.family === 'Sanad');
if (!list.length) throw new Error(this.labels.noData);
this._byCompany = new Map();
list.forEach(s => {
const c = String(s.company);
if (!this._byCompany.has(c)) this._byCompany.set(c, []);
this._byCompany.get(c).push(String(s.year));
});
this._byCompany.forEach(y => y.sort(numCmp));
this._fill(this.coEl, [...this._byCompany.keys()].sort(numCmp));
this._fillYears();
await this._show();
} catch (e) { this._error(e); }
}
async select(company, year) {
company = String(company); year = String(year);
if (!this._byCompany.has(company)) throw new Error('شرکت «' + company + '» وجود ندارد.');
this.coEl.value = company;
this._fillYears();
if (!this._byCompany.get(company).includes(year)) throw new Error('سال «' + year + '» برای شرکت ' + company + ' وجود ندارد.');
this.yrEl.value = year;
await this._show();
}
get company() { return this.coEl.value; }
get year() { return this.yrEl.value; }
getGrid() { return this.grid; }
async _show() {
const company = this.coEl.value, year = this.yrEl.value;
if (!company || !year || this._busy) return;
this._busy = true;
this.coEl.disabled = this.yrEl.disabled = true;
this.errEl.style.display = 'none';
this._info(this.labels.loading);
try {
await this._gridBuilt;
const t0 = performance.now();
const r = await this.engine.rows('Sanad_' + year + '_' + company);
const loadMs = Math.round(performance.now() - t0);
await this.grid.clearData();
const t1 = performance.now();
await this.grid.setData(r.rows, 'Sanad');
const gridMs = Math.round(performance.now() - t1);
try {
const order = this.grid.getcolumnOrder();
this.hiddencolumns.forEach(f => {
const c = order.find(x => x.field === f);
if (c && c.visible) this.grid.togglecolumn(f);
});
} catch (e) { /* noop */ }
this._info(r.rows.length.toLocaleString('fa-IR') + ' ' + this.labels.rows + ' — ' +
(r.fresh ? this.labels.fromDb + ' ' + loadMs + ' ms' : this.labels.fromRam) +
' · ' + this.labels.grid + ' ' + gridMs + ' ms');
this._emit('loaded', { company, year, rows: r.rows.length, fromDb: r.fresh, loadMs, gridMs });
} catch (e) { this._error(e); }
this.coEl.disabled = this.yrEl.disabled = false;
this._busy = false;
}
destroy() {
this.coEl.removeEventListener('change', this._onCo);
this.yrEl.removeEventListener('change', this._onYr);
try { this.grid.destroy(); } catch (e) { /* noop */ }
this.root.innerHTML = '';
this.root.classList.remove('bdv');
}
static get version() { return '1.0.0-patched'; }
}
root.BinaDocView = BinaDocView;
})(typeof window !== 'undefined' ? window : globalThis);
