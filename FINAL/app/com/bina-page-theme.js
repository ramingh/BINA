/* bina-page-theme.js — همگام‌سازی زبان، جهت، تم (روشن/تیره) و رنگ پالت سایدبار با صفحات inside iframe
   استفاده: در هر صفحه پیش از اسکریپت خود صفحه، Dic_sek.Js و این فایل را لود کن. */
(function (root) {
  'use strict';
  var LANGS = ['fa', 'en', 'ar'];
  var DEFAULT_PALETTE = '#285f92';
  var host = null;
  try {
    host = root.parent !== root && root.parent.document ? root.parent.document.documentElement : null;
  } catch (e) { host = null; }

  function stored(key) { try { return root.localStorage.getItem(key); } catch (e) { return null; } }
  function hostAttr(name) { try { return host ? host.getAttribute(name) : null; } catch (e) { return null; } }
  function hostStyle(name) { try { return host ? host.style.getPropertyValue(name).trim() : ''; } catch (e) { return ''; } }

  function readPrefs() {
    var lang = hostAttr('lang') || stored('sidebarLanguage') || 'fa';
    if (LANGS.indexOf(lang) < 0) lang = 'fa';
    var palette = hostStyle('--palette-color') || stored('sidebarPaletteColor') || DEFAULT_PALETTE;
    if (!/^#[0-9a-f]{6}$/i.test(palette)) palette = DEFAULT_PALETTE;
    var theme = hostAttr('data-theme') || stored('sidebarTheme') || 'light';
    return {
      lang: lang,
      dir: lang === 'en' ? 'ltr' : 'rtl',
      theme: theme === 'dark' ? 'dark' : 'light',
      palette: palette
    };
  }

  /* در پوستهٔ سایدبار همان مترجم والد استفاده می‌شود تا متن اصلی هر گره یک‌بار ثبت شود. */
  function translator() {
    var shared = null;
    try { if (root.parent !== root) shared = root.parent.translator || null; } catch (e) { shared = null; }
    if (shared) { root.translator = shared; return shared; }
    if (!root.translator && root.WebTranslator) {
      try { root.translator = new root.WebTranslator(); } catch (e) { root.translator = null; }
    }
    return root.translator || null;
  }

  /* مترجم والد ممکن است همین لحظه در حال init باشد؛ برای همین چند صدم ثانیه صبر می‌کنیم و init دوباره نمی‌سازیم. */
  function whenLoaded(t) {
    if (t.isLoaded) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var waited = 0;
      var timer = root.setInterval(function () {
        waited += 100;
        if (!t.isLoaded && waited < 2000) return;
        root.clearInterval(timer);
        if (t.isLoaded) return resolve(true);
        Promise.resolve(t.init()).then(function () { resolve(true); }, function () { resolve(false); });
      }, 100);
    });
  }

  var running = false;
  var queued = null;
  function translate(lang) {
    var t = translator();
    if (!t) return Promise.resolve();
    if (running) { queued = lang; return Promise.resolve(); }
    running = true;
    return whenLoaded(t)
      .then(function (ready) { return ready ? t.setLanguage(lang) : null; })
      .catch(function (error) { console.warn('[bina-page-theme] ترجمه انجام نشد:', error); })
      .then(function () {
        running = false;
        if (queued && queued !== lang) {
          var next = queued;
          queued = null;
          return translate(next);
        }
        queued = null;
      });
  }

  var state = { lang: null, dir: null, theme: null, palette: null };

  function apply() {
    var prefs = readPrefs();
    var html = root.document.documentElement;
    var langChanged = state.lang !== prefs.lang;
    html.lang = prefs.lang;
    html.dir = prefs.dir;
    html.dataset.theme = prefs.theme;
    html.style.setProperty('--palette-color', prefs.palette);
    state = prefs;
    if (langChanged) translate(prefs.lang);
  }

  function boot() {
    apply();
    if (root.MutationObserver && host) {
      new root.MutationObserver(apply).observe(host, {
        attributes: true,
        attributeFilter: ['lang', 'dir', 'data-theme', 'style']
      });
    }
    root.addEventListener('storage', function (event) {
      if (!event.key || ['sidebarLanguage', 'sidebarTheme', 'sidebarPaletteColor'].indexOf(event.key) >= 0) apply();
    });
    /* گرید و مودال بعد از init ساخته می‌شوند؛ چند بار کوتاه دوباره ترجمه می‌کنیم. */
    [250, 1200, 2600].forEach(function (delay) {
      root.setTimeout(function () { if (state.lang && state.lang !== 'fa') translate(state.lang); }, delay);
    });
  }

  root.binaPageTheme = {
    refresh: apply,
    translate: function () { return translate(state.lang || 'fa'); },
    getState: function () { return state; }
  };

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
