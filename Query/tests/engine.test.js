require('fake-indexeddb/auto');
const zlib = require('zlib');
global.alasql = require('alasql');
require('../bina-local-sql.js');

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
const mkRows = (n, base) => Array.from({
  length: n
}, (_, i) => [String(i + 1), '1399/01/01', 13, 1322, 132145, 'شرح ' + (base + i), i % 2 ? 0 : 1000, i % 2 ? 500 : 0]);

(async () => {
  const pub = await open('public', ['catalog', 'columns']); // باید نادیده گرفته شود
  await put(pub, 'catalog', 'x', {
    table: 'x'
  });
  for (const co of ['1100', '1200']) {
    const db = await open(co, ['Coding', 'Sanad']);
    for (const y of [1398, 1399]) {
      for (let b = 0; b < 3; b++) {
        const n = 100;
        await put(db, 'Sanad', [y, co, b], gz({
          ids: Array.from({
            length: n
          }, (_, i) => b * 1000 + i + 1),
          rows: mkRows(n, y * 10 + b)
        }));
      }
    }
    await put(db, 'Sanad', [1400, co, 0], mkRows(1, 7)[0]); // رکورد ردیفی (بدون Id → از کلید)
    await put(db, 'Sanad', [1400, co, 5], mkRows(1, 8)[0]);
    await put(db, 'Coding', [co, 1], gz({
      ids: [1, 2],
      rows: [
        ['a', 'b'],
        ['c', 'd']
      ]
    }));
  }

  const log = [];
  const s = new BinaLocalSql({
    onProgress: m => log.push(m),
    cacheMaxRows: 500
  });
  const ok = (c, m) => {
    console.log((c ? 'PASS ' : 'FAIL ') + m);
    if (!c) process.exitCode = 1;
  };

  const srcs = await s.sources();
  ok(srcs.filter(x => x.family === 'Sanad').length === 6, 'کشف منبع‌ها: ' + srcs.length + ' (public نادیده گرفته شد)');

  // ۱) کویری خود کاربر
  let r = await s.query("SELECT  [Id],[ShomarehSanad],[Tarikh],[KOl_Code],[Moien_Code],[Tafsil_Code],[SharhSanad],[Bedehkar],[Bestankar],[_SrcTable]  FROM [Bina].[dbo].[vw_All_Sanad]  where [_SrcTable] like '%1200%'");
  ok(r.rows.length === 2 * 300 + 2, 'کویری کاربر: ' + r.rows.length + ' ردیف (انتظار 602)');
  ok(r.rows.every(x => x._SrcTable.includes('1200')), 'فقط شرکت 1200');
  ok(r.used.every(x => x.includes('1200')) && r.used.length === 3, 'فقط ۳ منبع 1200 خوانده شد: ' + r.used.join(','));
  ok(!s.status().tables.some(t => t.table.includes('1100')), '1100 اصلاً در رم نیامد');
  ok(typeof r.rows[0].ShomarehSanad === 'number' && r.rows[0].Id === 1 || r.rows[0].Id != null, 'Id و نوع عددی: ' + JSON.stringify(r.rows[0]));

  // ۲) تمام شرکت‌ها در یک سال
  r = await s.query("SELECT _SrcTable, COUNT(*) AS n, SUM(Bedehkar) AS bed FROM vw_All_Sanad WHERE _SrcTable LIKE 'Sanad_1399_%' GROUP BY _SrcTable ORDER BY _SrcTable");
  ok(r.rows.length === 2 && r.rows[0].n === 300, 'سال 1399 همه شرکت‌ها: ' + JSON.stringify(r.rows));

  // ۳) = و AND با شرط دیگر
  r = await s.query("SELECT COUNT(*) AS n FROM Sanad WHERE _SrcTable = 'Sanad_1398_1100' AND Bedehkar > 0");
  ok(r.rows[0].n === 150 && r.used.length === 1, '= و AND: n=' + r.rows[0].n + ' used=' + r.used);

  // ۴) OR → پیش‌فیلتر نباید بزند (همه منبع‌ها)
  r = await s.query("SELECT COUNT(*) AS n FROM Sanad WHERE _SrcTable LIKE '%1100%' OR _SrcTable LIKE '%1200%'");
  ok(r.rows[0].n === 1204 && r.used.length === 6, 'OR درست و کامل: n=' + r.rows[0].n);

  // ۵) JOIN → بدون پیش‌فیلتر، ولی درست
  r = await s.query("SELECT COUNT(*) AS n FROM Sanad a JOIN Coding c ON a.Id = c.Id WHERE a._SrcTable LIKE 'Sanad_1399_1100'");
  ok(r.rows.length === 1, 'JOIN اجرا شد: ' + JSON.stringify(r.rows));

  // ۶) Coding
  r = await s.query('SELECT * FROM Coding_1200');
  ok(r.rows.length === 2 && r.rows[0].C0 === 'a', 'Coding: ' + JSON.stringify(r.rows[0]));

  // ۷) نام اشتباه و شرط بی‌نتیجه
  r = await s.query("SELECT * FROM vw_All_Sanad WHERE _SrcTable LIKE '%9999%'");
  ok(r.rows.length === 0 && r.warnings.length === 1, 'بی‌نتیجه: ' + r.warnings);
  try {
    await s.query('SELECT * FROM Nope');
    ok(false, 'جدول ناشناس باید خطا بدهد');
  } catch (e) {
    ok(true, 'جدول ناشناس خطا داد: ' + e.message.slice(0, 60));
  }

  // ۸) سقف رم
  ok(s.status().totalRows <= 500 + 302, 'LRU: رم=' + s.status().totalRows + ' ردیف');
  // ۹) سقف کویری
  const t = new BinaLocalSql({
    queryMaxRows: 100
  });
  try {
    await t.query('SELECT * FROM Sanad');
    ok(false, 'باید خطای سقف بدهد');
  } catch (e) {
    ok(/ردیف لازم/.test(e.message), 'سقف کویری: ' + e.message.slice(0, 50));
  }
  // ۱۰) دوباره کوئری 1200 → از رم
  const s2 = new BinaLocalSql();
  await s2.query("SELECT TOP 5 * FROM vw_All_Sanad WHERE _SrcTable LIKE '%1200%'");
  r = await s2.query("SELECT TOP 5 * FROM vw_All_Sanad WHERE _SrcTable LIKE '%1200%'");
  ok(r.loaded.length === 0 && r.rows.length === 5, 'بار دوم از رم، loaded=0');


  // rows(): مستقیم از رم بدون کپی
  const s3 = new BinaLocalSql();
  let a = await s3.rows('Sanad_1399_1200');
  let b = await s3.rows('Sanad_1399_1200');
  ok(a.fresh === true && b.fresh === false && a.rows === b.rows && a.rows.length === 300, 'rows(): بار اول fresh، بار دوم همان آرایهٔ رم');
  try {
    await s3.rows('Sanad_1111_9999');
    ok(false, 'باید خطا بدهد');
  } catch (e) {
    ok(/وجود ندارد/.test(e.message), 'rows() منبع ناموجود خطا داد');
  }

  // واحد: فیلترها
  const I = BinaLocalSql._internals;
  ok(I.srcFilters("SELECT * FROM Sanad WHERE Id > 1 AND (_SrcTable LIKE 'a' OR 1=1)").length === 0, 'پرانتز با OR → بدون پیش‌فیلتر');
  ok(I.srcFilters("SELECT * FROM Sanad WHERE SharhSanad = 'x or y' AND _SrcTable LIKE '%1200%' ORDER BY Id").length === 1, 'or داخل رشته نادیده شد');
  ok(I.srcFilters("SELECT * FROM Sanad WHERE _SrcTable NOT LIKE '%1200%'").length === 0, 'NOT LIKE → بدون پیش‌فیلتر');
})().catch(e => {
  console.error('CRASH', e);
  process.exit(1);
});