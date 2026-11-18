/* ═══════════════════════════════════════════════════════════════════════
bina-pages.js — توصیف‌گر (descriptor) هر منو
هر برگ منو (pages/tab-NN.html) یک ورودی با کلید همان شناسه دارد.

═══ تغییرات این نسخه ═══
  - نام ستون‌ها و عنوان فارسی دیگر در کد نیست: BinaLocalSql آن‌ها را از بانک public
    (استور columns و tk_dic) می‌خواند؛ SANAD_CAPTIONS / CODING_CAPTIONS و captions حذف شد.
  - نام فیلدها همان حروف کوچک متادیتاست: id، kol_code، moien_code، shomarehsanad، …
    پس در SQL هم با حروف کوچک بنویس (AlaSQL به حروف حساس است).
  - ردیف‌ها بدون C0… ساخته می‌شوند؛ kol_code و moien_code عدد هستند (نوع int در متادیتا).
══════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  const P = root.BinaPages = root.BinaPages || {};

  /* ۱۳ — اسناد حسابداری: کمبوی شرکت + سال، مسیر سریع (sql=null) */
  P['tab-13'] = {
    id: 'tab-13',
    title: 'اسناد حسابداری',
    family: 'Sanad',
    params: ['company', 'year'],
    sql: null,
    hiddenColumns: ['_SrcTable']
  };

  /* ۰۱ — معرفی شرکت‌ها: فعلاً همان نمای اسناد */
  P['tab-01'] = Object.assign({}, P['tab-13'], {
    id: 'tab-01',
    title: 'معرفی شرکتها'
  });

  /* ۰۲ — کدینگ شرکتها: کمبوی شرکت + دو متن‌باکس + کویری SQL
     SELECT * → ستون‌ها همیشه از متادیتا می‌آیند (بدون فهرست ثابت).
     kol_code و moien_code عددند، پس مقایسهٔ مستقیم با مقدار متن‌باکس درست کار می‌کند. */
  P['tab-02'] = {
    id: 'tab-02',
    title: 'کدینگ شرکتها',
    family: 'Coding',
    params: ['company'],
    textParams: [{
        key: 'kOlCode',
        label: 'کد کل',
        placeholder: 'مثلاً 11'
      },
      {
        key: 'mOienCode',
        label: 'کد معین',
        placeholder: 'مثلاً 1103'
      }
    ],
    sql: "SELECT * FROM Coding_{company} WHERE kol_code = {kOlCode} AND moien_code = {mOienCode}",
    hiddenColumns: ['_SrcTable']
  };
})(typeof window !== 'undefined' ? window : globalThis);