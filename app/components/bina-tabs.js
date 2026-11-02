/* ═══════════════════════════════════════════════════════════════════════
   bina-tabs.js — BinaTabFrames: یک iframe زنده برای هر تب (حالت صفحه حفظ می‌شود)
   • تب غیرفعال فقط مخفی می‌شود (کمبوها، فیلتر، مرتب‌سازی، اسکرول، انتخاب دست‌نخورده).
   • سقف maxLive تب زنده: قدیمی‌ترین تب غیرفعال «منجمد» می‌شود — حالتش با page.BinaPage.getState() ذخیره و iframe حذف؛
     با برگشتن، iframe تازه ساخته و حالت از طریق iframe.__binaState به BinaPage.mount داده می‌شود.
   • هنگام نمایش دوبارهٔ تب، BinaPage.onShow() (redraw گرید) صدا زده می‌شود.
   const frames = new BinaTabFrames(containerEl, { maxLive: 8 });
   frames.open(key, page) · activate(key|'') · close(key) · closeAll() · liveFrames() · isFrozen(key) · has(key)
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';
class BinaTabFrames {
  constructor(container, opts) {
    opts = opts || {};
    if (!container) throw new Error('BinaTabFrames: container لازم است.');
    this.container = container;
    this.maxLive = Math.max(1, opts.maxLive || 8);
    this.onLoad = typeof opts.onLoad === 'function' ? opts.onLoad : null;
    this._recs = new Map();
    this._active = '';
    this._clock = 0;
  }
  has(key) { return this._recs.has(key); }
  isFrozen(key) { const r = this._recs.get(key); return !!r && !r.frame; }
  liveFrames() { return [...this._recs.values()].filter(r => r.frame).map(r => r.frame); }
  open(key, page) {
    if (this._recs.has(key)) return;
    const rec = { key, page, frame: null, state: null, last: 0 };
    this._recs.set(key, rec);
    this._create(rec);
  }
  activate(key) {
    this._active = key || '';
    this._recs.forEach(rec => { if (rec.key !== this._active && rec.frame) this._setVisible(rec.frame, false); });
    const rec = this._recs.get(this._active);
    if (!rec) return;
    rec.last = ++this._clock;
    if (!rec.frame) this._create(rec);                 /* تب منجمد → بازسازی با حالت ذخیره‌شده */
    this._setVisible(rec.frame, true);
    this._enforceCap();
    const after = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : fn => setTimeout(fn, 0);
    after(() => this._notifyShow(rec));
  }
  close(key) {
    const rec = this._recs.get(key);
    if (!rec) return;
    if (rec.frame) rec.frame.remove();
    this._recs.delete(key);
    if (this._active === key) this._active = '';
  }
  closeAll() {
    this._recs.forEach(rec => { if (rec.frame) rec.frame.remove(); });
    this._recs.clear();
    this._active = '';
  }
  _create(rec) {
    const f = document.createElement('iframe');
    f.className = 'content-frame';
    f.title = rec.key;
    f.style.cssText = 'width:100%;height:100%;border:0';
    f.__binaState = rec.state || null;
    if (this.onLoad) f.addEventListener('load', () => { try { this.onLoad(f, rec); } catch (e) { /* noop */ } });
    this._setVisible(f, false);
    f.src = rec.page;
    this.container.append(f);
    rec.frame = f;
  }
  _setVisible(frame, on) {
    frame.hidden = !on;
    frame.style.display = on ? '' : 'none';          /* اگر CSS برنامه display را override کرد، hidden کافی نیست */
  }
  _freeze(rec) {
    try {
      const w = rec.frame.contentWindow;
      if (w && w.BinaPage && typeof w.BinaPage.getState === 'function') {
        const st = w.BinaPage.getState();
        if (st) rec.state = st;                       /* اگر هنوز mount نشده بود، حالت قبلی می‌ماند */
      }
    } catch (e) { /* noop */ }
    rec.frame.remove();
    rec.frame = null;
  }
  _enforceCap() {
    for (;;) {
      const live = [...this._recs.values()].filter(r => r.frame);
      if (live.length <= this.maxLive) return;
      const victim = live.filter(r => r.key !== this._active).sort((a, b) => a.last - b.last)[0];
      if (!victim) return;
      this._freeze(victim);
    }
  }
  _notifyShow(rec) {
    try {
      const w = rec.frame && rec.frame.contentWindow;
      if (w && w.BinaPage && typeof w.BinaPage.onShow === 'function') w.BinaPage.onShow();
    } catch (e) { /* noop */ }
  }
}
root.BinaTabFrames = BinaTabFrames;
})(typeof window !== 'undefined' ? window : globalThis);
