/* bina-shell.js — در صفحهٔ اصلی (shell) یک‌بار لود می‌شود: موتور مشترک بانک لوکال برای همهٔ تب‌ها.
   صفحه‌ها (iframe) آن را با parent.BinaBank می‌گیرند؛ بافر رم با جابه‌جایی تب‌ها از بین نمی‌رود. */
(function (root) {
'use strict';
if (typeof root.BinaLocalSql === 'undefined') { console.error('bina-shell: bina-local-sql.js لود نشده است.'); return; }
const engine = new root.BinaLocalSql();
const ready = engine.init();
ready.catch(e => console.error('❌ بانک لوکال:', e && e.message ? e.message : e));   /* بدون هشدار unhandled؛ صفحه‌ها خودشان await می‌کنند */
root.BinaBank = { engine, ready };
})(window);
