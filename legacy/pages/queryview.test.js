/* BinaQueryView + BinaPage: مسیر سریع، کویری با پارامتر، چندشرکتی (فقط سال)، Coding، عنوان فارسی، translate="no"، حالت ذخیره/بازگردانی */
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
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div><div id="view"></div></body></html>', {
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
['bina-grid.js', 'bina-local-sql.js', 'bi na-query-view.js', 'bina-pages.js', 'bina-page.js'].forEach(f => load(path.join(__dirname, '..', 'app', 'bina', f)));
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
const mkOpts = () => ({
  height: '300px',
  pageSize: 100
});
(async () => {
  const plan = {
    '1200': {
      1399: 600,
      1398: 300
    },
    '1100': {
      1399: 200,
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
    await put(db, 'Coding', [co, 1], gz({
      ids: [1, 2, 3],
      rows: [
        ['a' + co, 'x'],
        ['b', 'y'],
        ['c', 'z']
      ]
    }));
    db.close();
  }
  const pub = await open('public', ['Catalog']);
  pub.close();
  const engine = new w.BinaLocalSql();
  /* ── ۱) مسیر سریع + captions + translate=no ── */
  const D = w.BinaPages['tab-13'];
  const v1 = new w.BinaQueryView('#a', D, {
    engine,
    gridOptions: mkOpts()
  });
  await v1.init();
  await sleep(100);
  ok(v1.company === '1100' && v1.year === '1399', 'پیش‌فرض: اولین شرکت و سال → ' + v1.company + '/' + v1.year);
  ok(v1.getGrid().table.getRows().length === 200, 'مسیر سریع: 200 ردیف');
  const titles = v1.getGrid().table.getColumns().map(c => c.getDefinition().title);
  ok(titles.includes('بدهکار') && titles.includes('شماره سند') && !titles.includes('Bedehkar'), 'عنوان فارسی ستون‌ها: ' + titles.join('،'));
  ok(v1.getGrid().table.getColumns().map(c => c.getField()).includes('Bedehkar'), 'نام فیلد (کلید داده) دست‌نخورده');
  const h = v1.root.querySelector('.tabulator-tableholder');
  ok(h && h.getAttribute('translate') === 'no' && !v1.root.querySelector('.tabulator-header').closest('[translate="no"]'), 'بدنه translate=no؛ هدر ترجمه‌پذیر');
  const sc = v1.getGrid().getColumnOrder().find(x => x.field === '_SrcTable');
  ok(!sc || !sc.visible, '_SrcTable پنهان');
  /* ── ۲) کویری با پارامتر ── */
  const v2 = new w.BinaQueryView('#b', {
    id: 'q-bed',
    family: 'Sanad',
    params: ['company', 'year'],
    sql: 'SELECT Id, Bedehkar FROM Sanad_{year}_{company} WHERE Bedehkar > 0',
    captions: {
      Bedehkar: 'بدهکار'
    }
  }, {
    engine,
    gridOptions: mkOpts()
  });
  await v2.init();
  await sleep(60);
  v2.coEl.value = '1200';
  v2.coEl.dispatchEvent(new w.Event('change'));
  await sleep(300);
  ok(v2.year === '1398' && v2.getGrid().table.getRows().length === 150, 'sql با {company}/{year}: 1200/1398 → 150 ردیف (نیمی بدهکار>0)');
  /* ── ۳) فقط سال: همهٔ شرکت‌ها ── */
  const v3 = new w.BinaQueryView('#c', {
    id: 'q-year',
    family: 'Sanad',
    params: ['year'],
    sql: 'SELECT _SrcTable, COUNT(*) AS n FROM Sanad_{year}_ALL GROUP BY _SrcTable ORDER BY _SrcTable'
  }, {
    engine,
    gridOptions: mkOpts()
  });
  await v3.init();
  await sleep(60);
  const yrs = [...v3.yrEl.options].map(o => o.value).join();
  ok(yrs === '1398,1399,1400', 'فقط سال: سال‌های یکتای همهٔ شرکت‌ها مرتب: ' + yrs);
  v3.yrEl.value = '1399';
  v3.yrEl.dispatchEvent(new w.Event('change'));
  await sleep(300);
  const rows3 = v3.getGrid().table.getData();
  ok(rows3.length === 2 && rows3[0]._SrcTable === 'Sanad_1399_1100' && rows3[0].n === 200 && rows3[1].n === 600, 'همهٔ شرکت‌ها در ۱۳۹۹: ' + JSON.stringify(rows3.map(r => r._SrcTable + ':' + r.n)));
  ok(!v3.coEl, 'کمبوی شرکت ساخته نشد');
  /* ── ۴) Coding مسیر سریع ── */
  const v4 = new w.BinaQueryView('#d', {
    id: 'coding',
    family: 'Coding',
    params: ['company'],
    sql: null
  }, {
    engine,
    gridOptions: mkOpts()
  });
  await v4.init();
  await sleep(60);
  ok(v4.getGrid().table.getRows().length === 3 && !v4.yrEl, 'Coding/company: 3 ردیف، بدون کمبوی سال');
  /* ── ۵) حالت ذخیره/بازگردانی ── */
  v1.coEl.value = '1200';
  v1.coEl.dispatchEvent(new w.Event('change'));
  await sleep(300);
  v1.yrEl.value = '1399';
  v1.yrEl.dispatchEvent(new w.Event('change'));
  await sleep(300);
  await v1.getGrid().table.setPage(3);
  const st = v1.getState();
  ok(st.params.company === '1200' && st.params.year === '1399' && st.page === 3, 'getState: ' + JSON.stringify(st));
  w.document.body.insertAdjacentHTML('beforeend', '<div id="e"></div>');
  const v5 = new w.BinaQueryView('#e', D, {
    engine,
    gridOptions: mkOpts()
  });
  await v5.init(st);
  await sleep(150);
  ok(v5.company === '1200' && v5.year === '1399' && v5.getGrid().table.getPage() === 3, 'init(state): شرکت/سال/صفحه بازگردانده شد');
  let bad = null;
  try {
    await v5.setState({
      params: {
        company: '9999'
      }
    });
  } catch (e) {
    bad = e;
  }
  ok(bad && /وجود ندارد/.test(bad.message), 'setState شرکت ناموجود → خطا');
  await v5.init({
    params: {
      company: '9999',
      year: '1'
    }
  });
  await sleep(100);
  ok(v5.company === '1100', 'state نامعتبر نادیده گرفته شد (پیش‌فرض)');
  /* ── ۶) توصیف‌گر نامعتبر ── */
  const thr = d => {
    try {
      new w.BinaQueryView('#a', d, {
        engine
      });
      return null;
    } catch (e) {
      return e.message;
    }
  };
  ok(/id/.test(thr({})), 'بدون id → خطا');
  ok(/مسیر سریع/.test(thr({
    id: 'x',
    family: 'Sanad',
    params: ['year'],
    sql: null
  })), 'sql=null بدون company+year → خطا');
  ok(/sql/.test(thr({
    id: 'x',
    params: [],
    sql: null
  })), 'بدون پارامتر و sql → خطا');
  /* ── ۷) BinaPage.mount مستقل (بدون shell) ── */
  w.document.getElementById('view').innerHTML = '';
  const view = await w.BinaPage.mount('tab-13', {
    target: '#view',
    engine
  });
  await sleep(150);
  ok(view && w.BinaPage.getState().params.company === '1100', 'BinaPage.mount: view ساخته شد، getState کار می‌کند');
  w.BinaPage.onShow();
  const d01 = w.BinaPages['tab-01'];
  ok(d01 && d01.id === 'tab-01' && d01.params.join() === 'company,year' && d01.sql === null && d01.captions.Bedehkar === 'بدهکار' && w.BinaPages['tab-13'].id === 'tab-13', 'descriptor منوی «معرفی شرکتها» (tab-01): id یکتا، شرکت+سال، بدون دست‌زدن به tab-13');
  w.document.getElementById('view').innerHTML = '';
  const v01 = await w.BinaPage.mount('tab-01', {
    target: '#view',
    engine
  });
  await sleep(150);
  ok(v01 && v01.desc.id === 'tab-01' && v01.getGrid().table.getRows().length === 200 && v01.getGrid().options.storagePrefix === 'BinaQV.tab-01', 'mount(tab-01): کمبوها و گرید ساخته شد، تنظیمات گرید جدا از tab-13');
  let nf = null;
  try {
    await w.BinaPage.mount('tab-999', {
      target: '#view',
      engine
    });
  } catch (e) {
    nf = e;
  }
  ok(nf && /پیدا نشد/.test(nf.message) && /تعریف نشده/.test(w.document.getElementById('view').textContent), 'descriptor ناموجود: پیام در صفحه + خطا');
  console.log('done');
  process.exit(process.exitCode || 0);
})().catch(e => {
  console.error('CRASH', e);
  process.exit(1);
});