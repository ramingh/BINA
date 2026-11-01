# Bina Local Bank — کویری SQL و نمایش اسناد روی بانک لوکال (IndexedDB)

کامپوننت‌های مرورگری برای خواندن «بانک لوکال» برنامه (IndexedDB با بلوک‌های gzip)، اجرای کویری SQL روی آن
و نمایش اسناد به‌صورت «کمبوی شرکت + کمبوی سال مالی + گرید». بدون سرور، بدون build. جاوااسکریپت ساده.

## فایل‌ها

| فایل | نقش |
|---|---|
| `bina-local-sql.js` | **BinaLocalSql** — موتور: کشف منبع‌ها، بافر در رم، کویری SQL (AlaSQL). بدون UI |
| `bina-doc-view.js` | **BinaDocView** — «نمایش اسناد»: دو کمبو + BinaGrid، با موتور بالا |
| `bina-grid.js` | **BinaGrid v1.1.0** — گرید (روی Tabulator 5.6.1). تغییر نسبت به v1.0: بخش «BinaGrid» پایین |
| `bina-asnad.html` | نمونهٔ کامل «نمایش اسناد» (۱۰ خط) |
| `bina-local-test.html` | کنسول SQL: textbox کویری + گرید + وضعیت رم |
| `tests/` + `package.json` | تست خودکار (`npm i && npm test`) |

## شروع سریع

همهٔ فایل‌ها در **یک پوشه** و روی **همان origin** که بانک لوکال دارد (IndexedDB مخصوص origin است) باز شوند.
ترتیب اسکریپت‌ها: Tabulator 5.6.1 → ExcelJS (اختیاری، برای خروجی Excel گرید) → AlaSQL → `bina-grid.js` →
`bina-local-sql.js` → `bina-doc-view.js`. نمونهٔ کامل: `bina-asnad.html`.

```html
<div id="docs"></div>
<script>
  const view = new BinaDocView('#docs');
  view.init();
</script>
```

کویری مستقیم (بدون UI):

```js
const sql = new BinaLocalSql({ onProgress: m => console.log(m) });
const r = await sql.query("SELECT TOP 100 * FROM [Bina].[dbo].[vw_All_Sanad] WHERE [_SrcTable] LIKE '%1200%'");
// r = { rows, ms, loadMs, used, loaded, warnings, sql }
```

## ساختار دادهٔ بانک لوکال (فرض‌های کد)

- هر شرکت یک دیتابیس IndexedDB (نام = کد شرکت، مثل `1100`)، با دو استور:
  `Sanad` با کلید `[سال, شرکت, شمارهٔ بلوک]` و `Coding` با کلید `[شرکت, Id]`.
- مقدار هر رکورد: `Uint8Array` = gzip‌شدهٔ JSON `{ ids: [...], rows: [[...], ...] }`، **یا** یک آرایهٔ ردیفی (بدون Id؛ Id از آخرین مؤلفهٔ کلید).
- هر ردیف Sanad آرایه‌ای با این ترتیب است: `ShomarehSanad, Tarikh, KOl_Code, Moien_Code, Tafsil_Code, SharhSanad, Bedehkar, Bestankar`
  (مقادیر عددیِ `ShomarehSanad, KOl_Code, Moien_Code, Tafsil_Code, Bedehkar, Bestankar` به number تبدیل می‌شوند). `Id` از `ids`.
- ستون‌های Coding شناخته‌شده نیستند → `C0, C1, …`؛ با `new BinaLocalSql({ codingcolumns: ['...'] })` نام بده.
- دیتابیس‌هایی که استور `catalog` دارند (public و Bina_Bank قدیمی) نادیده گرفته می‌شوند.

## BinaLocalSql

| API | توضیح |
|---|---|
| `new BinaLocalSql({ onProgress, cacheMaxRows = 2e6, queryMaxRows = 4e6, codingcolumns })` | |
| `await sources()` | فهرست `{table, family, year, company, blocks, loaded}`؛ فقط از روی کلیدها، بلوکی باز نمی‌شود |
| `await rows('Sanad_1399_1200')` | یک منبع مستقیم (بدون AlaSQL، بدون کپی) → `{rows, fresh}`. آرایه را تغییر نده (همان بافر است) |
| `await query(sql)` | اجرای کویری → `{rows, ms, loadMs, used, loaded, warnings, sql}` |
| `status()` | `{tables:[{table, rows}], totalRows}` — چه چیزی الان در رم است |
| `clear(name?)` | آزاد کردن یک منبع یا همه |

**جدول‌ها:** `vw_All_Sanad` (= `Sanad`)، `Sanad_1399_ALL`، `Sanad_ALL_1200`، `Sanad_1399_1200`، `vw_All_Coding` (= `Coding`)، `Coding_1200`.
ستون مجازی `_SrcTable` = `Sanad_سال_شرکت` (**فرض ما**، با بانک واقعی تأیید شود). پیشوند `[Bina].[dbo].` حذف می‌شود.

**سرعت:** منبع‌ها فقط وقتی لازم شوند بار می‌شوند و در رم می‌مانند (LRU تا `cacheMaxRows` ردیف).
کویری تک‌جدولی با شرط **AND** روی `_SrcTable` (`LIKE '…'` یا `= '…'`) فقط بلوک‌های منبع‌های مطابق را می‌خواند؛
نتیجه با اجرای کامل یکی است. با `OR`، `JOIN`، `UNION`، زیرکویری یا `NOT LIKE` پیش‌فیلتر خاموش است (درست ولی کندتر).
اگر کویری بیش از `queryMaxRows` ردیف لازم داشته باشد، خطای واضح می‌دهد.

**محدودیت‌ها:** موتور SQL همان AlaSQL است، نه SQL Server. مثلاً `=` روی متن لاتین حساس به حروف بزرگ/کوچک است. فقط‌خواندنی (بدون INSERT/UPDATE/DELETE).
اجرا روی thread اصلی است؛ کویری‌های بسیار سنگین صفحه را موقتاً قفل می‌کنند (راه پایدار: Web Worker، پیاده نشده).

## BinaDocView

```js
const view = new BinaDocView('#docs', {
  engine: new BinaLocalSql(),          // اختیاری
  defaultYear: 'first',                // 'first' | 'last'
  gridOptions: { height: '72vh', pageSize: 500, pageSizeOptions: [100, 500, 1000] },
  hiddencolumns: ['_SrcTable'],
  labels: { company: 'شرکت', year: 'سال مالی' }
});
await view.init();                      // کمبوها (مرتب؛ پیش‌فرض اولین) + نمایش
view.on('loaded', e => {});             // {company, year, rows, fromDb, loadMs, gridMs}
await view.select('1200', '1399');
view.company; view.year; view.getGrid(); view.destroy();
```

همهٔ ردیف‌های «همان شرکت و سال» به گرید داده می‌شود و گرید صفحه‌بندی محلی ۵۰۰تایی دارد؛ پس فیلتر و مرتب‌سازی ستون روی **همهٔ** ردیف‌های آن شرکت/سال کار می‌کند، نه فقط صفحهٔ جاری.
نام شرکت‌ها فعلاً کد شرکت است (نام از جایی خوانده نمی‌شود).

## BinaGrid v1.1.0 — تغییر

`setData(rows, tableName, opts?)`. **پیش‌فرض دقیقاً مثل v1.0** (هر ردیف کپی می‌شود، ورودی دست‌نخورده).
`opts.own === true` یعنی «این آرایه مال گرید است» → کپی حذف می‌شود و فقط `__id` روی همان آبجکت‌ها نوشته می‌شود.
فقط برای خروجی تازهٔ کویری استفاده کن (`bina-local-test.html` همین کار را می‌کند)، **نه** برای بافر موتور.
اگر امن نبود (ردیف null/frozen، یا `__id` قبلی با جای ردیف نمی‌خواند)، خودکار مثل v1.0 کپی می‌کند.
`__id` عمداً قابل‌شمارش است: `Tabulator.getIndex()` با `deepClone` فقط ویژگی‌های قابل‌شمارش را می‌بیند و انتخاب سلول/ردیف به آن وابسته است.

## اندازه‌گیری‌ها (گزارش‌شده از بانک واقعی)

- بارگذاری همهٔ جدول‌ها یک‌جا: حدود ۱۴٫۴ ثانیه و حدود ۳٫۶ گیگابایت افزایش heap → برای رم کم مناسب نیست؛ طراحی بر بارگذاری بر حسب نیاز است.
- کویری شرکت ۱۲۰۰ (۱٬۱۷۳٬۸۷۰ ردیف روی ۱۱ سال): بار اول خواندن ۳۳۸۲ ms، کویری ۱۷۳ ms، نمایش در گرید ۳۲۸۰ ms؛ بار دوم از رم ۳۲ ms، کویری ۱۵۲ ms، **نمایش در گرید ۱۷۳۶۱ ms**. یعنی گلوگاه گرید است؛ به همین دلیل نمایش اسناد فقط یک (شرکت، سال) را به گرید می‌دهد.
- اندازه‌گیری «نمایش در گرید» برای یک (شرکت، سال) معمولی (~۱۰۰ هزار ردیف) هنوز گزارش نشده؛ `BinaDocView` آن را در خط وضعیت و رویداد `loaded` (`gridMs`) نشان می‌دهد.

## تست

`npm i && npm test` — موتور (IndexedDB ساختگی با بلوک‌های gzip)، گرید (jsdom + Tabulator واقعی)، و تست یکپارچهٔ BinaDocView.
در jsdom خطای `Cannot set properties of undefined (setting 'color')` از `SmartText.cellFormatter` گاهی دیده می‌شود؛
با گرید اصلی v1.0 هم همان‌طور رخ می‌دهد (تغییر v1.1 علتش نیست) و روی نتیجهٔ تست‌ها اثر ندارد. در مرورگر واقعی گزارش نشده؛ اگر دیدی، گزارش بده.

## عیب‌یابی

- «هیچ جدول Sanad … پیدا نشد»: صفحه روی origin دیگری از بانک باز شده، یا دیتابیس‌ها نام/ساختار متفاوت دارند.
- `indexedDB.databases()` در مرورگرهای خیلی قدیمی نیست → موتور خطای واضح می‌دهد.
- رم کم: `cacheMaxRows` و `queryMaxRows` را کم کن؛ `status()` را ببین.
