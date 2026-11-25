/* BINA — share sidebar palette/direction/theme with ordinary tab forms.
   Presentation-only. Does not change data, events or grid preferences. */
(function () {
  'use strict';
  const html = document.documentElement;
  const allowed = /^#[0-9a-f]{6}$/i;
  function saved(name) { try { return localStorage.getItem(name); } catch (_) { return null; } }
  function parentRoot() {
    try { return window.parent !== window ? window.parent.document.documentElement : null; }
    catch (_) { return null; }
  }
  function apply() {
    const host = parentRoot();
    const lang = (host && host.lang) || saved('sidebarLanguage') || 'fa';
    html.lang = ['fa','en','ar'].includes(lang) ? lang : 'fa';
    html.dir = html.lang === 'en' ? 'ltr' : 'rtl';
    html.dataset.theme = ((host && host.dataset.theme) || saved('sidebarTheme')) === 'dark' ? 'dark' : 'light';
    const palette = (host && host.style.getPropertyValue('--palette-color').trim()) || saved('sidebarPaletteColor');
    if (palette && allowed.test(palette)) html.style.setProperty('--palette-color',palette);
  }
  apply();
  const host = parentRoot();
  if (host && window.MutationObserver) {
    const watcher = new MutationObserver(apply);
    watcher.observe(host,{attributes:true,attributeFilter:['lang','dir','data-theme','style']});
    window.addEventListener('pagehide',() => watcher.disconnect(),{once:true});
  }
  window.addEventListener('storage',apply);
  window.addEventListener('pageshow',apply);
})();
