/* تست یکپارچه: BinaLocalSql + BinaGrid + BinaDocView روی IndexedDB ساختگی (بلوک‌های gzip) داخل jsdom */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  JSDOM
} = require('jsdom');
const {
  indexedDB,
  IDBKeyRange
} = require('fake-indexeddb');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="box"></div></body></html>', {
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
Object.assign(w, {
  indexedDB,
  IDBKeyRange,
  DecompressionStream,
  Blob,
  Response,
  TextDecoder
});
w.alasql = require('alasql');
const load = f => w.eval(fs.readFileSync(f, 'utf8'));
load(require.resolve('tabulator-tables/dist/js/tabulator.js'));
['bina-grid.js', 'bina-local-sql.js', 'bina-doc-view.js'].forEach(f => load(path.join(__dirname, '..', f)));
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) process.exitCode = 1;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gz = o => new Uint8Array(zlib.gzipSync(JSON.stringify(o)));
const open = (name, stores) => new Promise((res, rej) => {
  const q = indexedDB.open(name, 1);
  q.onupgradeneeded = () => stores.forEach(s => q.result.createObjectStore(s));
  q.onsuccess = () => res(q.result);
  q.onerror = () => rej(q.error);
});
const put = (db, store, key, val) => new Promise((res, rej) => {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(val, key);
  tx.oncomplete = res;
  tx.onerror = () => rej(tx.error);
});
const rowsOf = (n, tag) => Array.from({
  length: n
}, (_, i) => [String(i + 1), '1399/01/01', 13, 1322, 132145, tag + i, i % 2 ? 0 : 1000, i % 2 ? 500 : 0]);
(async () => {
  /* شرکت 1200: سال‌های 1399 و 1398 (به‌عمد نامرتب ساخته می‌شوند) ؛ شرکت 1100: فقط 1400 */
  const plan = {
    '1200': {
      1399: 600,
      1398: 300
    },
    '1100': {
      1400: 150
    }
  };
  for (const co of Object.keys(plan)) {
    const db = await open(co, ['Coding', 'Sanad']);
    for (const y of Object.keys(plan[co])) {
      const n = plan[co][y],
        per = 100;
      for (let b = 0; b * per < n; b++) {
        const cnt = Math.min(per, n - b * per);
        await put(db, 'Sanad', [Number(y), co, b], gz({
          ids: Array.from({
            length: cnt
          }, (_, i) => b * per + i + 1),
          rows: rowsOf(cnt, co + y + '_')
        }));
      }
    }
    db.close();
  }
  const pub = await open('public', ['catalog']);
  pub.close();
  const view = new w.BinaDocView('#box', {
    gridOptions: {
      height: '300px',
      pageSize: 100
    }
  });
  const events = [];
  view.on('loaded', e => events.push(e));
  await view.init();
  await sleep(100);
  const opts = sel => [...sel.options].map(o => o.value).join(',');
  ok(opts(view.coEl) === '1100,1200', 'کمبوی شرکت مرتب: ' + opts(view.coEl));
  ok(view.company === '1100' && view.year === '1400', 'پیش‌فرض: اولین شرکت و اولین سال');
  ok(events.length === 1 && events[0].rows === 150 && events[0].fromDb === true, 'اولین نمایش: 150 ردیف از بانک');
  ok(view.getGrid().table.getRows().length === 150, 'گرید 150 ردیف دارد');
  await view.select('1200', '1398');
  ok(opts(view.yrEl) === '1398,1399', 'کمبوی سال فقط سال‌های همان شرکت و مرتب: ' + opts(view.yrEl));
  ok(view.getGrid().table.getRows().length === 300, 'select(1200,1398): 300 ردیف');
  /* تغییر کمبو توسط کاربر */
  view.coEl.value = '1200';
  view.coEl.dispatchEvent(new w.Event('change'));
  await sleep(300);
  ok(view.year === '1398' && view.getGrid().table.getRows().length === 300, 'change شرکت → اولین سال همان شرکت');
  view.yrEl.value = '1399';
  view.yrEl.dispatchEvent(new w.Event('change'));
  await sleep(300);
  const g = view.getGrid();
  ok(g.table.getRows().length === 600, 'change سال → 600 ردیف');
  /* فیلتر ستون روی همهٔ ردیف‌های همان شرکت/سال، نه فقط صفحهٔ جاری */
  g.table.setHeaderFilterValue('SharhSanad', '12001399_99');
  await sleep(60);
  ok(g.table.getDataCount('active') === 6, 'فیلتر ستون در همهٔ ۶۰۰ ردیف (۶ صفحه) می‌گردد، نه فقط صفحهٔ جاری: ' + g.table.getDataCount('active'));
  g.table.clearHeaderFilter();
  const cols = g.table.getcolumns().map(c => c.getField());
  ok(cols.includes('Bedehkar') && !cols.includes('__id'), 'ستون‌ها: ' + cols.join(','));
  const sc = g.getcolumnOrder().find(x => x.field === '_SrcTable');
  ok(!sc || sc.visible === false, '_SrcTable پنهان است');
  /* دوباره همان انتخاب → از رم */
  events.length = 0;
  await view.select('1200', '1399');
  ok(events.length === 1 && events[0].fromDb === false, 'بار دوم از رم');
  /* بافر موتور آلوده نشده */
  const rows = (await view.engine.rows('Sanad_1399_1200')).rows;
  ok(!('__id' in rows[0]) && Object.keys(rows[0]).join() === 'Id,ShomarehSanad,Tarikh,KOl_Code,Moien_Code,Tafsil_Code,SharhSanad,Bedehkar,Bestankar,_SrcTable', 'ردیف‌های بافر دست‌نخورده');
  /* خطا */
  let err = null;
  try {
    await view.select('9999', '1');
  } catch (e) {
    err = e;
  }
  ok(err && /وجود ندارد/.test(err.message), 'شرکت ناموجود خطا داد');
  view.destroy();
  ok(w.document.getElementById('box').innerHTML === '', 'destroy تمیز کرد');
  console.log('done');
})().catch(e => {
  console.error('CRASH', e);
  process.exit(1);
});