# 📄 سند مرجع معماری کلاینت بینا (BINA Master Architecture Document)
**نسخه:** 1.0.0 | **وضعیت:** منبع واحد حقیقت (Single Source of Truth)  
**تاریخ:** 2026-11-06

---

## ۱. هدف و فلسفه اصلی (Core Philosophy)
هدف، مدیریت و اجرای کوئری SQL روی مجموعه‌داده‌ای تا سقف **۳۰ میلیون رکورد** در سمت کلاینت (مرورگر) است، **بدون** ایجاد کندی یا کرش (Crash) ناشی از پر شدن حافظه (RAM).

### قوانین طلایی:
- **قانون طلایی حافظه:** بارگذاری کل داده‌ها یا کل یک استور در حافظه **ممنوع** است.
- **اصل بارگذاری انتخابی:** در هر لحظه، فقط داده‌های مربوط به **یک کد شرکت خاص** + **یک سال مالی خاص** (حداکثر حدود ۲۰۰,۰۰۰ رکورد) باید از حالت فشرده خارج شده و در حافظه موقت قرار گیرد.

---

## ۲. ساختار پایگاه داده (IndexedDB Schema)

### مشخصات دیتابیس:
- **نام دیتابیس:** `BinaLocalDB` (یا نام پیکربندی‌شده)
- **تعداد Object Storeها:** حدود ۳۰ استور مجزا
- **نام‌گذاری استورها:** دقیقاً برابر با `CompanyCode` (مثال: `"1100"`, `"1200"`, ..., `"3000"`)

### ساختار داخلی هر استور:
هر استور حاوی رکوردهای فشرده‌شده‌ای است که به دو دسته منطقی تقسیم می‌شوند:

1. **`Coding`**: داده‌های کدینگ (فاقد سال مالی در کلید اصلی)
2. **`Sanad`**: داده‌های اسناد (کلید اصلی یا ایندکس حتماً شامل `FiscalYear` و `CompanyCode` است)

---

## ۳. فرمت ذخیره‌سازی و فشرده‌سازی (Data Format)

### ساختار بلوکی:
داده‌ها به صورت ردیفی (Row-by-Row) ذخیره **نمی‌شوند**. آن‌ها به صورت **بلوکی و فشرده** ذخیره شده‌اند:

- **نوع داده در IndexedDB:** `Uint8Array`
- **الگوریتم فشرده‌سازی:** GZIP (با استفاده از کتابخانه `pako`)

### ساختار داخلی پس از باز کردن فشرده:
یک شیء JSON شامل دو آرایه:

```json
{
  "ids": [101, 102, 103],
  "rows": [
    ["مقدار1_ردیف1", "مقدار2_ردیف1", ...],
    ["مقدار1_ردیف2", "مقدار2_ردیف2", ...]
  ]
}
📦 کامپوننت الف: BinaDBManager (مدیریت IndexedDB)
مسئولیت: اتصال به دیتابیس و استخراج فقط بلوک‌های فشرده‌ی مورد نیاز.
متدها:
class BinaDBManager {
  /**
   * باز کردن یا ساخت IndexedDB و اطمینان از وجود استورهای شرکت‌ها
   * @param {string} dbName - نام دیتابیس
   * @returns {Promise<IDBDatabase>}
   */
  async init(dbName) {}

  /**
   * استخراج فقط بلوک‌های فشرده مربوط به یک سال مالی و نوع جدول خاص
   * @param {string} storeName - نام استور (کد شرکت، مثلاً "1100")
   * @param {number} fiscalYear - سال مالی (مثلاً 1402)
   * @param {string} tableType - نوع جدول ('Sanad' یا 'Coding')
   * @returns {Promise<Uint8Array[]>} آرایه‌ای از بلوک‌های فشرده
   * 
   * ⚠️ محدودیت حیاتی: این متد هرگز نباید store.getAll() را برای کل استور فراخوانی کند.
   * باید از IDBKeyRange یا فیلتر روی FiscalYear استفاده کند.
   */
  async getCompressedBlocks(storeName, fiscalYear, tableType) {}

  /**
   * دریافت تمام بلوک‌های یک استور (فقط برای موارد خاص مثل آمارگیری)
   * @param {string} storeName - نام استور
   * @returns {Promise<Uint8Array[]>}
   */
  async getAllBlocks(storeName) {}

  /**
   * بستن اتصال به دیتابیس
   */
  close() {}
}
📦 کامپوننت ب: DataDecompressor (بازگشایی داده‌ها)
مسئولیت: تبدیل داده‌های فشرده به فرمت قابل فهم برای AlaSQL.
متدها:
class DataDecompressor {
  /**
   * باز کردن فشرده بلوک‌ها و تبدیل به آرایه تخت از اشیاء
   * @param {Uint8Array[]} compressedBlocks - آرایه‌ای از بلوک‌های فشرده
   * @param {string[]} columnNames - آرایه نام ستون‌ها (از ids استخراج شده)
   * @returns {Promise<Object[]>} آرایه‌ای از اشیاء (Flat Array)
   * 
   * مثال خروجی:
   * [
   *   {id: 101, col1: 'val1', col2: 'val2'},
   *   {id: 102, col1: 'val3', col2: 'val4'}
   * ]
   */
  async inflateBlocks(compressedBlocks, columnNames) {
    // استفاده از pako.inflate برای هر بلوک
    // تبدیل به رشته با TextDecoder
    // JSON.parse
    // ترکیب ids و rows به آرایه اشیاء
  }

  /**
   * باز کردن یک بلوک تکی
   * @param {Uint8Array} compressedBlock - یک بلوک فشرده
   * @returns {Promise<Object>} شیء شامل ids و rows
   */
  async inflateSingleBlock(compressedBlock) {}
}

📦 کامپوننت ج: BinaAlaSQLEngine (موتور کوئری)
مسئولیت: ثبت داده‌های باز شده در حافظه موقت، اجرای کوئری و پاکسازی.
متدها:
class BinaAlaSQLEngine {
  constructor() {
    this.tables = new Map(); // نگهداری جداول موقت
  }

  /**
   * ثبت آرایه داده به عنوان جدول موقت در alaSQL
   * @param {string} tableName - نام جدول موقت (مثلاً "TempSanad")
   * @param {Object[]} dataArray - آرایه اشیاء از DataDecompressor
   */
  registerTempTable(tableName, dataArray) {
    // alasql(tableName, dataArray)
    // ذخیره در this.tables برای ردیابی
  }

  /**
   * اجرای کوئری SQL روی جداول موقت ثبت‌شده
   * @param {string} sqlString - رشته کوئری SQL
   * @returns {Promise<any>} نتیجه کوئری
   */
  async executeQuery(sqlString) {
    // alasql.promise(sqlString)
  }

  /**
   * حذف جدول موقت از حافظه alaSQL
   * ⚠️ الزامی: باید بلافاصله پس از دریافت نتیجه یا تغییر تب فراخوانی شود
   * @param {string} tableName - نام جدول موقت
   */
  dropTempTable(tableName) {
    // alasql('DROP TABLE ' + tableName)
    // حذف از this.tables
  }

  /**
   * حذف تمام جداول موقت (برای پاکسازی کامل حافظه)
   */
  dropAllTempTables() {
    // حذف تمام جداول از this.tables
  }
}
۵. جریان کار استاندارد (Standard Workflow)
هرگاه کاربر درخواست مشاهده داده‌ای را دارد (مثلاً کلیک روی یک تب)، این مراحل باید دقیقاً به این ترتیب اجرا شوند:
async function loadAndQueryData(companyCode, fiscalYear, tableType, sqlQuery) {
  // مرحله ۱: مقداردهی اولیه (فقط یک بار در شروع برنامه)
  const dbManager = new BinaDBManager();
  await dbManager.init('BinaLocalDB');
  
  const decompressor = new DataDecompressor();
  const sqlEngine = new BinaAlaSQLEngine();

  try {
    // مرحله ۲: استخراج هدفمند بلوک‌های فشرده
    const compressedBlocks = await dbManager.getCompressedBlocks(
      companyCode,    // مثلاً "1100"
      fiscalYear,     // مثلاً 1402
      tableType       // مثلاً "Sanad"
    );

    // مرحله ۳: بازگشایی فشرده و تبدیل به آرایه اشیاء
    const columnNames = ['id', 'column1', 'column2', ...]; // از Schema
    const dataArray = await decompressor.inflateBlocks(compressedBlocks, columnNames);

    // مرحله ۴: ثبت در موتور SQL به عنوان جدول موقت
    const tempTableName = `Temp_${tableType}_${companyCode}_${fiscalYear}`;
    sqlEngine.registerTempTable(tempTableName, dataArray);

    // مرحله ۵: اجرای کوئری
    const result = await sqlEngine.executeQuery(sqlQuery);

    // مرحله ۶: نمایش نتیجه در UI
    displayInGrid(result);

    // مرحله ۷: پاکسازی (حیاتی - جلوگیری از نشت حافظه)
    sqlEngine.dropTempTable(tempTableName);
    
    // آزادسازی متغیرهای موقت
    compressedBlocks = null;
    dataArray = null;

  } catch (error) {
    console.error('Error in data loading workflow:', error);
    throw error;
  }
}










async function loadAndQueryData(companyCode, fiscalYear, tableType, sqlQuery) {
  // مرحله ۱: مقداردهی اولیه (فقط یک بار در شروع برنامه)
  const dbManager = new BinaDBManager();
  await dbManager.init('BinaLocalDB');
  
  const decompressor = new DataDecompressor();
  const sqlEngine = new BinaAlaSQLEngine();

  try {
    // مرحله ۲: استخراج هدفمند بلوک‌های فشرده
    const compressedBlocks = await dbManager.getCompressedBlocks(
      companyCode,    // مثلاً "1100"
      fiscalYear,     // مثلاً 1402
      tableType       // مثلاً "Sanad"
    );

    // مرحله ۳: بازگشایی فشرده و تبدیل به آرایه اشیاء
    const columnNames = ['id', 'column1', 'column2', ...]; // از Schema
    const dataArray = await decompressor.inflateBlocks(compressedBlocks, columnNames);

    // مرحله ۴: ثبت در موتور SQL به عنوان جدول موقت
    const tempTableName = `Temp_${tableType}_${companyCode}_${fiscalYear}`;
    sqlEngine.registerTempTable(tempTableName, dataArray);

    // مرحله ۵: اجرای کوئری
    const result = await sqlEngine.executeQuery(sqlQuery);

    // مرحله ۶: نمایش نتیجه در UI
    displayInGrid(result);

    // مرحله ۷: پاکسازی (حیاتی - جلوگیری از نشت حافظه)
    sqlEngine.dropTempTable(tempTableName);
    
    // آزادسازی متغیرهای موقت
    compressedBlocks = null;
    dataArray = null;

  } catch (error) {
    console.error('Error in data loading workflow:', error);
    throw error;
  }
}

## منبع متادیتا

اطلاعات متادیتا در دیتابیس/استور `public` نگهداری می‌شود:

- `Catalog`
  - فهرست جداول
  - تعداد منطقی رکوردها
  - اطلاعات وضعیت دریافت/همگام‌سازی

- `Columns`
  - نام فیلدها
  - نوع فیلدها
  - ترتیب ستون‌ها

قانون:
`DataDecompressor` حق ندارد خودش `Catalog` یا `Columns` را بخواند.
خواندن این اطلاعات وظیفه `BinaDBManager` است و باید نتیجه به شکل آرایه ستون‌ها به `DataDecompressor` ارسال شود.