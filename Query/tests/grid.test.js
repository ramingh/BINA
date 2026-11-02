const {
  JSDOM
} = require('jsdom');
const fs = require('fs');
const path = require('path');
const dom = new JSDOM('<!doctype html><html><body><div id="g"></div></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/'
});
const w = dom.window;
w.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
w.eval(fs.readFileSync(require.resolve('tabulator-tables/dist/js/tabulator.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(__dirname, '../bina-grid.js'), 'utf8'));
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) process.exitCode = 1;
};
const mk = n => Array.from({
  length: n
}, (_, i) => ({
  Id: i + 1,
  Name: 'n' + i,
  Bed: i * 10
}));
(async () => {
  const grid = new w.BinaGrid('#g', {
    height: '300px',
    pageSize: 100,
    storagePrefix: 'T'
  });
  await new Promise(r => setTimeout(r, 300));
  // ۱) پیش‌فرض = دقیقاً v1.0: کپی و ورودی دست‌نخورده
  const a = mk(2000);
  await grid.setData(a, 'T1');
  ok(grid.table.getRows().length === 2000, 'پیش‌فرض: ۲۰۰۰ ردیف');
  ok(!('__id' in a[0]) && Object.keys(a[0]).join() === 'Id,Name,Bed', 'پیش‌فرض: ورودی دست‌نخورده');
  ok(grid.selection.rowKey(grid.table.getRows()[3]) === '4', 'پیش‌فرض: rowKey = 4');
  // ۲) own:true بدون کپی
  const b = mk(2000);
  await grid.setData(b, 'T2', {
    own: true
  });
  const R = grid.table.getRows();
  ok(R.length === 2000 && R[0].getData() === b[0], 'own: همان آبجکت‌ها داخل Tabulator');
  ok(b[5].__id === 6 && R[5].getIndex() === 6, 'own: index=__id');
  ok(grid.selection.rowKey(R[3]) === '4', 'own: rowKey = 4 (انتخاب کار می‌کند)');
  ok(grid.table.options.columns.map(c => c.field).join() === 'Id,Name,Bed', 'ستون‌ها بدون __id');
  grid.table.setHeaderFilterValue('Name', 'n1999');
  await new Promise(r => setTimeout(r, 50));
  ok(grid.table.getDataCount('active') === 1, 'فیلتر روی کل داده');
  grid.table.clearHeaderFilter();
  // ۳) انتخاب واقعی: سلول → کلید → دادهٔ ردیف
  grid.selection.rows.add('4');
  ok(grid.getSelectedData().length === 1 && grid.getSelectedData()[0].Id === 4, 'getSelectedData درست');
  grid.selection.clear();
  // ۴) idempotent: همان آرایه دوباره
  await grid.setData(b, 'T2', {
    own: true
  });
  ok(grid.table.getRows()[0].getData() === b[0], 'own دوباره با همان آرایه: بدون کپی');
  // ۵) آبجکت‌های مشترک با ترتیب دیگر → کپی امن، شناسه‌های صاحب دست‌نخورده
  const g2 = new w.BinaGrid('#g', {
    height: '300px',
    pageSize: 100,
    storagePrefix: 'T2'
  });
  await new Promise(r => setTimeout(r, 300));
  const rev = b.slice().reverse();
  await g2.setData(rev, 'T3', {
    own: true
  });
  ok(g2.table.getRows()[0].getData() !== rev[0] && g2.table.getRows()[0].getData().__id === 1, 'ترتیب متفاوت → کپی');
  ok(b[5].__id === 6, 'شناسه‌ی گرید اول خراب نشد');
  // ۶) frozen / null → کپی
  const fr = mk(3).map(Object.freeze);
  await g2.setData(fr, 'T4', {
    own: true
  });
  ok(g2.table.getRows().length === 3 && g2.table.getRows()[0].getData().__id === 1, 'frozen → کپی');
  // ۷) خالی
  await g2.setData([], 'T5', {
    own: true
  });
  ok(g2.table.getRows().length === 0, 'خالی');
  await grid.clearData();
  ok(grid.table.getRows().length === 0, 'clearData');
  console.log('done');
})().catch(e => {
  console.error('CRASH', e);
  process.exit(1);
});