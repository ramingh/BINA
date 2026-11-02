# Bina Local Bank — کویری SQL، نمایش اسناد و اتصال به منوهای برنامه
کامپوننت‌های مرورگری برای خواندن «بانک لوکال» (IndexedDB با بلوک‌های gzip)، کویری SQL روی آن و نمایش در گرید،
و اتصال به shell برنامه (سایدبار + تب‌ها). بدون سرور و بدون build. جاوااسکریپت ساده.
وضعیت و تصمیم‌ها: `PROJECT_CONTEXT.md` (این را همراه zip به هر AI بده).
## ساختار پوشه
```
app/                       ← همان‌طور که هست روی پوشهٔ shell برنامه‌ات کپی شود (فایل‌های هم‌نام جایگزین می‌شوند)
  side_bar.html            (اصلاح‌شده)     app.js (اصلاح‌شده)     dic_sek.Js (اصلاح‌شده)
  bina/                    کتابخانه‌ها
    bina-local-sql.js      BinaLocalSql — موتور (بافر رم + کویری)
    bina-grid.js           BinaGrid v1.2.0
    b ina-query-view.js     BinaQueryView — پارامتر + کویری + گرید (هر منو)
    bina-pages.js          ثبت کویری هر منو (اینجا ویرایش می‌کنی)
    bina-page.js           چسب سمت صفحه (داخل iframe هر تب)
    bina-tabs.js           BinaTabFrames — یک iframe زنده برای هر تب
    bina-shell.js          موتور مشترک در shell (window.BinaBank)
    bina-doc-view.js       BinaDocView — نسخهٔ ساده‌تر قبلی (دو کمبو + گرید)
    alasql.min.js          ← خودت بگذار (فقط برای حالت آفلاین؛ وگرنه از CDN)
  pages/tab-13.html        صفحهٔ «اسناد حسابداری» (نمونهٔ کامل)    pages/_template.html  قالب بقیهٔ منوها
demos/                     bina-asnad.html (نمایش اسناد مستقل) · bina-local-test.html (کنسول SQL)
tests/ + package.json      npm i && npm test
```
در پوشهٔ shell شما باید `tabulator.min.js/.css` محلی (fallback آفلاین) کنار `side_bar.html` باشد، مثل قبل.
## نصب روی shell برنامه
۱. محتوای `app/` را روی پوشهٔ shell کپی کن. تغییرات فایل‌های خودت (diff واقعی): `app.js` +۸/−۶ خط، `side_bar.html` +۱۷/−۶ خط، `dic_sek.Js` +۱۷/−۰ خط.
۲. همه چیز باید روی **همان origin** بانک لوکال باز شود (IndexedDB مخصوص origin است؛ `file://` مشکل‌ساز است، از سرور محلی استفاده کن).
۳. برای هر منو: `pages/tab-NN.html` را از `_template.html` بساز و در `bina/bina-pages.js` ورودی `'tab-NN'` را تعریف کن.
## معماری و رفتار
- **موتور مشترک در shell:** `bina-shell.js` فقط کلیدها را می‌خواند (سریع) و `window.BinaBank.engine` را می‌سازد.
  هر تب (iframe) آن را با `parent.BinaBank` می‌گیرد؛ بافر رم با جابه‌جایی تب‌ها از بین نمی‌رود. صفحهٔ مستقل، موتور خودش را می‌سازد.
- **یک iframe زنده برای هر تب** (`BinaTabFrames`): تب غیرفعال فقط مخفی می‌شود؛ کمبوها، فیلتر، مرتب‌سازی، اسکرول و انتخاب دست‌نخورده می‌ماند.
  سقف `maxLive = 8` تب زنده: قدیمی‌ترین تب غیرفعال «منجمد» می‌شود (حالتش با `BinaPage.getState()` ذخیره و iframe حذف می‌شود) و با برگشتن بازسازی می‌شود
  (پارامترها، صفحهٔ جاری و اسکرول؛ فیلتر/مرتب‌سازی ستون‌ها را خود گرید در localStorage با `storagePrefix` یکتای هر منو نگه می‌دارد).
- **هر منو یک descriptor** در `bina-pages.js`: `{ id, family:'Sanad'|'Coding', params:['company','year'], sql, captions, hiddencolumns }`
  - `sql: null` → مسیر سریع: همهٔ ردیف‌های (شرکت، سال) مستقیم از رم/بانک (`rows()`).
  - `sql: "SELECT … FROM Sanad_{year}_{company} …"` → `query()` با جانشین `{company}` و `{year}`.
  - فقط `params:['year']` + `Sanad_{year}_ALL` → همهٔ شرکت‌ها در یک سال (۲۰٪ مورد).
  - فیلتر ستون روی **همهٔ** ردیف‌های نتیجه کار می‌کند؛ صفحه‌بندی ۵۰۰تایی فقط نمایش است.
- **مترجم و بانک `public`:** مترجم دیگر شماره‌ی نسخه‌ی دیتابیس را سخت‌کد نمی‌کند (`dbVersion = null` = هر نسخه‌ای که بانک دارد). نام دیتابیس و استور بدون حساسیت به حروف تطبیق داده می‌شود (`public`/`public`، `tk_dic`/`tk_dic`)،
  علت واقعی خطا چاپ می‌شود (مثلاً `VersionError`) و اتصال بعد از خواندن دیکشنری بسته می‌شود. موتور هم نام استورها را بدون حساسیت به حروف می‌شناسد (`Sanad`/`sanad`، `catalog`/`catalog`).
- **مترجم (`dic_sek.Js`):** هر چیزی داخل `translate="no"` یا `.notranslate` دست‌نخورده می‌ماند (پیمایش متن، attributeها و MutationObserver).
  گرید با `noTranslateBody` همین ویژگی را روی بدنهٔ سلول‌ها می‌گذارد؛ عنوان ستون‌ها و فوتر ترجمه‌پذیر می‌مانند. گزینهٔ `noTranslateSelector: ''` رفتار قبلی را برمی‌گرداند.
- **عنوان ستون‌ها:** `captions` در descriptor (فارسی). مترجم فقط متن فارسیِ **دقیقاً موجود در tk_dic** را ترجمه می‌کند.
  عنوان‌های پیش‌فرض Sanad در `bina-pages.js` (شماره سند، تاریخ، کد کل، … بدهکار، بستانکار) **حدس من‌اند**؛ اگر در دیکشنری به شکل دیگری ثبت شده‌اند، همان‌جا اصلاح کن.
## BinaLocalSql
`new BinaLocalSql({ onProgress, cacheMaxRows = 2e6, queryMaxRows = 4e6, codingcolumns })` ·
`await sources()` · `await rows('Sanad_1399_1200')` → `{rows, fresh}` (بافر؛ تغییرش نده) · `await query(sql)` → `{rows, ms, loadMs, used, loaded, warnings, sql}` · `status()` · `clear(name?)`.
جدول‌ها: `vw_All_Sanad` (= `Sanad`)، `Sanad_1399_ALL`، `Sanad_ALL_1200`، `Sanad_1399_1200`، `vw_All_Coding` (= `Coding`)، `Coding_1200`. ستون مجازی `_SrcTable` = `Sanad_سال_شرکت` (**فرض**).
کویری تک‌جدولی با شرط AND روی `_SrcTable` (LIKE/=) فقط بلوک‌های لازم را می‌خواند؛ با OR/JOIN/UNION/زیرکویری/NOT LIKE درست ولی بدون پیش‌فیلتر.
موتور SQL همان AlaSQL است (T-SQL کامل نیست؛ `=` روی لاتین حساس به حروف). فقط‌خواندنی. اجرا روی thread اصلی.
## ساختار بانک لوکال (فرض‌های کد)
هر شرکت یک دیتابیس (نام = کد شرکت) با `Sanad [سال, شرکت, بلوک]` و `Coding [شرکت, Id]`؛ مقدار = `Uint8Array` gzip‌شدهٔ `{ids, rows}` یا آرایهٔ ردیفی.
ردیف Sanad: `ShomarehSanad, Tarikh, KOl_Code, Moien_Code, Tafsil_Code, SharhSanad, Bedehkar, Bestankar` (Id از `ids`). ستون‌های Coding: `C0, C1, …` (یا `codingcolumns`).
دیتابیس‌های دارای استور `catalog` (public، Bina_Bank قدیمی) نادیده گرفته می‌شوند.
## BinaGrid v1.2.0 (تغییرات نسبت به v1.0 — همه اختیاری، پیش‌فرض‌ها دست‌نخورده)
- `setData(rows, name, { own:true })` بدون کپی ردیف‌ها (فقط برای خروجی تازهٔ کویری، نه برای بافر موتور؛ در حالت ناامن خودکار به کپی برمی‌گردد). `__id` عمداً قابل‌شمارش است (`Tabulator.getIndex` با deepClone فقط قابل‌شمارش‌ها را می‌بیند).
- `captions: {field:'عنوان'}` عنوان ستون؛ `noTranslateBody: true` → `translate="no"` روی بدنه.
## اندازه‌گیری‌های واقعی (گزارش کاربر)
۱٫۱۷M ردیف یک‌جا در گرید: بار اول ۳٫۳ث، بار دوم ۱۷ث؛ لود همهٔ بانک‌ها ≈ ۱۴ث و ≈ ۳٫۶GB heap. به همین دلیل گرید فقط یک (شرکت، سال) (~۱۰۰ هزار ردیف) می‌گیرد.
زمان «نمایش در گرید» برای یک (شرکت، سال) معمولی هنوز گزارش نشده؛ در خط وضعیت هر صفحه نمایش داده می‌شود.
## تست: `npm i && npm test` (۸ مجموعه، IndexedDB ساختگی + jsdom + Tabulator واقعی)
**آنچه تست نشده (فقط در مرورگر واقعی می‌شود):** `redraw` گرید هنگام نمایش دوبارهٔ iframe مخفی، بازگردانی اسکرول، اندازهٔ iframeها داخل CSS اصلی shell (`style.css` را ندیدم)،
بارگذاری واقعی `pages/*.html` در iframe، تعامل مترجم هر صفحه با مترجم shell، مصرف رم با چند تب بزرگ همزمان.
در jsdom خطای `Cannot set properties of undefined (setting 'color')` از `SmartText.cellFormatter` دیده می‌شود (با گرید اصلی هم رخ می‌دهد؛ در مرورگر گزارش نشده).
## عیب‌یابی
«هیچ جدول Sanad … پیدا نشد» = origin اشتباه یا ساختار متفاوت · «descriptor پیدا نشد» = ورودی `tab-NN` در `bina-pages.js` نیست ·
رم کم: `cacheMaxRows`/`queryMaxRows` و `maxLive` را کم کن · کلید `__binaState` فقط حالت پارامترها/صفحه/اسکرول است.
