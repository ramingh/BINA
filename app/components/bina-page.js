/* ═══════════════════════════════════════════════════════════════════════
   bina-page.js — چسب سمت صفحه (داخل iframe هر تب)
   در pages/tab-NN.html:   BinaPage.mount('tab-NN');
   • موتور مشترک را از shell می‌گیرد (parent.BinaBank)؛ اگر صفحه تنها باز شد موتور خودش را می‌سازد.
   • حالت ذخیره‌شدهٔ قبلی تب (از iframe.__binaState) را اعمال می‌کند.
   • API برای shell:  BinaPage.getState() · setState(s) · onShow() · whenReady()
   • مترجم صفحه (اگر WebTranslator لود شده باشد) را می‌سازد و زبان فعلی shell را اعمال می‌کند.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';
function parentBank() {
  try { return root.parent && root.parent !== root && root.parent.BinaBank ? root.parent.BinaBank : null; }
  catch (e) { return null; }            /* parent از origin دیگر */
}
function parentLang() {
  try { return root.parent && root.parent !== root ? root.parent.document.documentElement.lang : ''; } catch (e) { return ''; }
}
const BinaPage = {
  view: null, engine: null, id: null,
  async mount(id, opts) {
    opts = opts || {};
    const target = typeof opts.target === 'string' || !opts.target ? document.querySelector(opts.target || '#view') : opts.target;
    const desc = (root.BinaPages || {})[id];
    if (!desc) {
      const known = Object.keys(root.BinaPages || {});
      const hint = known.length
        ? 'تعریف‌شده‌ها: ' + known.join('، ') + ' — اگر «' + id + '» باید باشد، bina-pages.js پروژه قدیمی است (جایگزینش کن و Ctrl+F5 بزن).'
        : 'هیچ descriptor ای لود نشده — bina-pages.js لود نشده یا خطا دارد (مسیر ../bina/bina-pages.js را در تب Network ببین).';
      if (target) target.textContent = 'برای «' + id + '» کویری تعریف نشده است. ' + hint;
      throw new Error('BinaPage: descriptor «' + id + '» پیدا نشد. ' + hint);
    }
    this.id = id;
    const bank = parentBank();
    this.engine = opts.engine || (bank ? bank.engine : new root.BinaLocalSql());
    if (bank) await bank.ready;
    const frameEl = root.frameElement;
    const saved = frameEl && frameEl.__binaState ? frameEl.__binaState : null;
    this.view = new root.BinaQueryView(target, desc, { engine: this.engine });
    this._ready = this.view.init(saved);
    this._setupTranslator();
    return this._ready.then(() => this.view);
  },
  _setupTranslator() {
    if (typeof root.WebTranslator === 'undefined' || root.translator) return;
    try {
      root.translator = new root.WebTranslator();
      root.translator.init().then(() => {
        const lang = parentLang();
        if (lang && lang !== 'fa') root.translator.setLanguage(lang);
      }).catch(() => { /* مترجم اختیاری است */ });
    } catch (e) { /* noop */ }
  },
  whenReady() { return this._ready || Promise.resolve(); },
  getState() { return this.view ? this.view.getState() : null; },
  setState(s) { return this.view ? this.view.setState(s) : Promise.resolve(); },
  onShow() { if (this.view) this.view.onShow(); }
};
root.BinaPage = BinaPage;
})(typeof window !== 'undefined' ? window : globalThis);
