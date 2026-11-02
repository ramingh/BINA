# BINA Professional Components — معماری پایگاه داده و SQL (نسخه 4.2 ـ TK FIRST + Persistent Storage)
این بسته **دو کامپوننت کاملاً جدا** دارد که از یک ساختار داده مشترک استفاده می‌کنند:
1. `manager/bina-db-manager.js`: کلاس‌های `webservice` و `Index_db` برای اتصال به سرویس، ساخت/بازکردن IndexedDB، راه‌اندازی اولیه، دریافت مرحله‌ای و GZIP بلوکی، گزارش پیشرفت، Catalog، Columns، TK، فهرست/حذف بانک‌ها و مدیریت متادیتا.
2. `sql/bina-query.js`: کلاس `BinaQuery`، موتور SQL خالص JavaScript، بدون SQLite/WASM/CDN/Python، صرفاً خواننده دیتابیس‌های اصلی.
صفحات UI مستقل‌اند: `manager/index.html` و `sql/index.html`. هر صفحه فایل JavaScript خودش را دارد؛ یکی به دیگری نیاز ندارد. `index.html` ریشه فقط راهنمای ورود است.
## اجرای صفحه‌ها و Origin
این پوشه را داخل پوشه‌ای قرار دهید که برنامه شما از همان سرویس وب **روی یک Origin واحد** ارائه می‌کند. مثلاً:
- `http://127.0.0.1:5500/BINA_Professional_Components/manager/index.html`
- `http://127.0.0.1:5500/BINA_Professional_Components/sql/index.html`
اگر داده‌های اصلی قبلاً روی **پورت 5520** ایجاد شده‌اند، باید صفحات را از **همان پورت 5520** اجرا کنید؛ IndexedDB بین پورت‌ها به‌طور مستقیم مشترک نیست.
صفحه Manager آدرس Web Service را جداگانه دریافت می‌کند؛ ممکن است سرور با `localhost` یا HTTPS اجرا شود. ارتباط Cross-Origin با Web Service نیازمند CORS یا Proxy است. فایل سرویس `FastDataHandler.ashx` در بسته وجود ندارد و باید مثل گذشته روی سرور شما برقرار باشد.
`IRANYekanX-Light.ttf` داخل ZIP قرار ندارد؛ از مسیر نسبی ریشه پروژه فراخوانی می‌شود، و اگر فونت موجود نباشد فونت جایگزین نمایش داده می‌شود.
## استاندارد نام‌ها و سازگاری
شناسه‌های **منطقی** جدول‌ها با حروف کوچک نگهداری می‌شوند: `coding_1000`، `sanad_1395_1000`، `tk_...`. نام واقعی SQL Server برای درخواست Web Service جداگانه نگهداری می‌شود.
برای دیتابیس تازه: `public` با استورهای `servertables`, `catalog`, `columns`, `tk_dic`, `tk_sherkat`؛ دیتابیس هر شرکت فقط کد شرکت، با استورهای `coding`, `sanad`. **بانک‌های قدیمی `Public`, `Coding`, `Sanad`, `tk_dic` همچنان با نام فیزیکی موجود باز می‌شوند** و خودکار حذف یا جابه‌جا نمی‌شوند؛ این تصمیم برای ایمنی صدها مگابایت اطلاعات موجود است. دیتابیس `Tajmi` قدیمی، اگر وجود داشته باشد، حذف نمی‌شود ولی در نسخه ارسالی `bina_db-v010.js` غیرفعال بوده و این بازنویسی هم بدون دستور شما داده داخل آن ایجاد نمی‌کند.
`Public/Columns` **فقط دو Schema مشترک** `coding` و `sanad` دارد. ترتیب و نوع فیلدهای هر خانواده مطابق تأیید شما کاملاً یکسان فرض شده است. اطلاعات متن و مقدار فیلدها (مانند عنوان تفصیل) تغییر داده نمی‌شود.
**نسخه IndexedDB** با `indexedDB.open(name)` بدون شماره ثابت خوانده می‌شود؛ در صورت نیاز به ساخت Object Store، فقط از `db.version+1` برای ارتقا استفاده می‌شود. عدد نسخه را کاربر تنظیم نمی‌کند.
## موتور Manager
```javascript
const ws = new webservice({endpoint:'http://localhost/grid/FastDataHandler.ashx'});
const manager = new Index_db({webservice:ws,batchSize:15000,blockSize:10000});
await manager.bootstrap();      // اول تمام tk_*، سپس فهرست سرور و فقط دو Schema مشترک
const tables=await manager.getTableList({companyCode:'1000'});
await manager.syncTables(['sanad_1395_1000','coding_1000']);
const sample=await manager.getRows({companyCode:'1000',family:'Sanad',year:1395,limit:25});
```
**متدها:** `requestPersistence()`, `initialize()`, `bootstrap()`, `refreshServerTables()`, `getServerTables()`, `getColumns(family)`, `getCatalog({companyCode})`, `getTableList({companyCode,family,status})`, `syncTables(names)`, `syncCompany(code)`, `syncAll()`, `syncTable(name,{replace})`, `getRows({companyCode,family,year,afterId,limit})`, `getTKdic()`, `getTKEsmSherkat()`, `compareServer({apply,companyCode})`, `getStorageStatus()`, `listLocalInventory()`, `normalizeMetadata({dryRun})`, `deleteLocalDatabases(names)`, `wipeAllLocal()`, `stop()`, `close()`.
**نکات ایمنی:**
- `normalizeMetadata({dryRun:true})` فقط گزارش می‌دهد؛ `{dryRun:false}` کلیدهای متادیتای بی‌تعارض را استاندارد می‌کند، رکوردهای متناقض را حذف نمی‌کند. قبل از اجرا پشتیبان بگیرید.
- `syncTable(name,{replace:true})` در موتور Web Service فعلی **بازنویسی تخریبی** دارد؛ برای اطلاعات ارزشمند بدون Backup استفاده نکنید. «Safe Replace» پیشرفته Import Studio در این فایل پایه وجود ندارد. در این نسخه، تغییر فرمت ذخیره‌سازی بدون اجازه خودکار داده قدیمی را حذف نمی‌کند.
- کاهش شمارش سرور به‌طور خودکار باعث حذف داده محلی نمی‌شود؛ نیازمند بازبینی و تصمیم صریح است.
- در GZIP، `blockSize=10000` تعداد ردیف بلوک فشرده است؛ `batchSize=15000` تعداد ردیف درخواست وب‌سرویس. Chunk=2000 مربوط به حالت ذخیره ردیفی سایر واردکننده‌هاست و در این مسیر بلوکی کاربرد مستقیم ندارد.
- ترتیب اجباری دریافت اطلاعات واقعی: اول mode=tables برای یافتن نام‌ها، سپس دریافت و راستی‌آزمایی همه `tk_*`؛ بعد از آن دریافت فهرست/Schema اصلی و امکان همگام‌سازی `coding`/`sanad`.
- دو TK ضروری `tk_dic_fieldname` و `tk_esmsherkatholding` حتی اگر در فهرست سرویس نباشند، با نام واقعی سازگار با سرویس قدیمی مستقیماً دریافت می‌شوند؛ نبود/خرابی آن‌ها عملیات را متوقف می‌کند.
- `tk_*`ها به‌صورت Batch در IndexedDB نوشته می‌شوند و شمارش نهایی با stats مقایسه می‌شود. برای دو جدول شناخته‌شده از `tk_dic` و `tk_sherkat` استفاده می‌شود؛ سایر TKها با نام lowercase در public ذخیره می‌شوند.
- `navigator.storage.persisted()` نتیجه ماندگاری را تأیید می‌کند؛ مرورگر می‌تواند درخواست `persist()` را رد کند. ماندگاری جایگزین Backup نیست.
- متد ماندگاری خودکار در این نسخه در هر نشست فقط یک بار درخواست می‌دهد؛ دکمه «درخواست ماندگاری» درخواست دستی جدید می‌فرستد.
- پرشدن `TK` و فهرست شرکت‌ها فقط بر اساس سرویس `tables` و `stats` و `data` است.
## موتور SQL
```javascript
const q = new BinaQuery({maxRowsPerTable:5000, maxTotalRows:100000, maxJoinRows:150000});
await q.ensureTablesForSQL({sql:'SELECT * FROM sanad_1395_1000 LIMIT 20',maxRows:5000,allowPartial:true});
const result=q.query({sql:'SELECT * FROM sanad_1395_1000 LIMIT 20',maxResultRows:100});
console.log(result.rows, result.note);
```
**متدها:** `listTables()`, `getSchema({table})`, `loadTable({table,maxRows,allowPartial})`, `ensureTablesForSQL({sql,maxRows,allowPartial})`, `query({sql,maxResultRows})`, `listLoaded()`, `unloadTable(name)`, `clear()`, `stop()`, `storageEstimate()`.
**مجموعه دستورات پیاده‌سازی و تست‌شده:**
- `SELECT`, `DISTINCT`, `WHERE`, `ORDER BY`, `LIMIT`, `OFFSET`, `INNER JOIN`, `LEFT JOIN`, `GROUP BY`, `HAVING`؛ اتصال برابری چندستونی به روش Hash JOIN.
- `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `COUNT(DISTINCT ...)`, `LIKE`, `IN`, `BETWEEN`, `IS NULL`, `COALESCE`, `ROUND`, `ABS`, `LOWER`, `UPPER`, `IIF`, `CASE WHEN ... THEN ... ELSE ... END`.
- `SUM(...) OVER (PARTITION BY ... ORDER BY ... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`.
- `UNION`, `UNION ALL` ساده، `DECLARE @x INT = 123`, `SET @x = 456` برای متغیرهای عددی/رشته ساده (در همان Session).
- `CREATE TABLE tmp_...`, `INSERT INTO tmp_... VALUES(...)`, `UPDATE tmp_... SET ... WHERE ...`, `DELETE FROM tmp_... WHERE ...`, `DROP TABLE tmp_...`: **صرفاً جداول موقت در حافظه**؛ داده‌های `coding` و `sanad` فقط خوانده می‌شوند.
**حدود مهم:** این مفسر، **تمام استاندارد SQL یا تمام امکانات T-SQL Server را پشتیبانی نمی‌کند**. `CTE`, `Subquery`, `RIGHT/FULL JOIN`, `MERGE`, `Stored Procedure`, `IF/ELSE` دستوری و Transactionهای SQL پشتیبانی نمی‌شوند؛ `IIF` و `CASE` برای شرط‌گذاری در SELECT قابل استفاده‌اند. دستورهای ویرایشی صرفاً برای جدول‌های `tmp_` هستند. `UNION`های دارای ORDER BY کلی یا تو در تو هنوز پشتیبانی کامل ندارند.
## محدودیت ۳۰ میلیون رکورد
**SQL Runner این نسخه روی یک نمونه محدود در RAM کار می‌کند** و به‌طور پیش‌فرض حداکثر ۵۰۰۰ ردیف هر جدول را بارگذاری می‌کند؛ در نتیجه `SUM`, `COUNT`, `JOIN` روی جدول ناقص معادل SQL روی کل ۳۰ میلیون ردیف نیست. سقف‌های حافظه/Join قابل تنظیم هستند، اما بالا بردن آن‌ها تا میلیون‌ها رکورد خطر کرش دارد. برای SQL کامل در مقیاس ۳۰ میلیون، طراحی جدید اجرای مرحله‌ای/ایندکس‌دار روی بلوک‌ها لازم است.
جدول‌های کمکی `tk_dic` و `tk_sherkat` نیز در SQL Runner به‌صورت خواندنی از استورهای مرکزی شناسایی می‌شوند؛ ساختار ستون‌های آن‌ها از یک رکورد نمونه در همان استور استخراج می‌شود و **Schema جدیدی در Columns ذخیره نمی‌شود**.
`listLocalInventory()` در بانک GZIP تعداد **بلوک‌های فیزیکی** را در Object Store می‌شمارد، نه تعداد اسناد داخل آن. تعداد منطقی ردیف‌ها در Catalog / `received` نگهداری می‌شود.
## آزمایش‌ها
اجرای `node tests/test-manager.cjs`, `node tests/test-composite-join.cjs`, `node tests/test-window.mjs`, `node tests/test-autoload.mjs`, `node tests/test-features.cjs` برای تست بخش قابل اجرا بدون مرورگر. فایل `tests/test-tk-first-persistent.cjs` نیز با Mock سازوکار تقدم TK، توقف دریافت سند در صورت خطای TK و ماندگاری را تست می‌کند.
**تست مرورگر واقعی:** فایل `tests/browser_integration.html` برای آزمایش با Chrome و یک سرویس شبیه‌سازی‌شده در بسته قرار دارد، اما در محیط این گفتگو اجرای خودکار مرورگر به‌دلیل محدودیت دسترسی محیط ممکن نبود؛ بنابراین موفقیت یکپارچه روی دیتابیس واقعی کاربر تأیید نشده است. قبل از استفاده عملی، روی یک Origin آزمایشی و با Backup امتحان شود.
