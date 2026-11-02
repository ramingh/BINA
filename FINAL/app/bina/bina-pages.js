/* ═══════════════════════════════════════════════════════════════════════
   bina-pages.js — ثبت توصیف‌گر (descriptor) هر منو
   هر برگ منو (pages/tab-NN.html) یک ورودی با کلید همان شناسه (مثلاً 'tab-13') دارد.
   فیلدها: BinaQueryView (bina -query-view.js) را ببین.
   اضافه کردن کویری برای یک منو: یک ورودی بساز و در pages/tab-NN.html بنویس  BinaPage.mount('tab-NN').
     P['tab-15'] = { id: 'tab-15', title: 'نمایش کلی اسناد', family: 'Sanad', params: ['company', 'year'],
       sql: "SELECT KOl_Code, COUNT(*) AS Tedad, SUM(Bedehkar) AS Bed, SUM(Bestankar) AS Bes FROM Sanad_{year}_{company} GROUP BY KOl_Code ORDER BY KOl_Code",
       captions: { KOl_Code: 'کد کل', Tedad: 'تعداد', Bed: 'بدهکار', Bes: 'بستانکار' } };
     // همهٔ شرکت‌ها در یک سال (۲۰٪ موارد):
     P['tab-xx'] = { id: 'tab-xx', family: 'Sanad', params: ['year'],
       sql: "SELECT _SrcTable, COUNT(*) AS n FROM Sanad_{year}_ALL GROUP BY _SrcTable ORDER BY _SrcTable" };
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';
/* عنوان فارسی ستون‌های Sanad — فرض ما؛ اگر در TK_Dic با متن دیگری ثبت شده، همین‌جا اصلاح کن */
const SANAD_CAPTIONS = {
  Id: 'شناسه', ShomarehSanad: 'شماره سند', Tarikh: 'تاریخ', KOl_Code: 'کد کل', Moien_Code: 'کد معین',
  Tafsil_Code: 'کد تفصیل', SharhSanad: 'شرح سند', Bedehkar: 'بدهکار', Bestankar: 'بستانکار'
};
const P = root.BinaPages = root.BinaPages || {};
/* ۱۳ — اسناد حسابداری: کمبوی شرکت + سال مالی، همهٔ ردیف‌های آن شرکت/سال، ۵۰۰ ردیف در هر صفحه */
P['tab-13'] = {
  id: 'tab-13', title: 'اسناد حسابداری', family: 'Sanad', params: ['company', 'year'],
  sql: null, captions: SANAD_CAPTIONS, hiddencolumns: ['_SrcTable']
};
/* ۰۱ — معرفی شرکت‌ها: فعلاً همان نمای «شرکت + سال مالی + گرید» (ردیف‌های Sanad).
   وقتی کویری مخصوص این منو مشخص شد، فقط sql (و params/captions) همین ورودی را عوض کن. id یکتاست (تنظیمات گرید جدا می‌ماند). */
P['tab-01'] = Object.assign({}, P['tab-13'], { id: 'tab-01', title: 'معرفی شرکتها' });
root.BinaCaptions = { Sanad: SANAD_CAPTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
