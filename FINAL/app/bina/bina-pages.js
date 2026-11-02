/* ═══════════════════════════════════════════════════════════════════════
bina-pages.js — توصیف‌گر (descriptor) هر منو
هر برگ منو (pages/tab-NN.html) یک ورودی با کلید همان شناسه دارد.

═══ تغییرات این نسخه ═══
تاریخ: 2026-11-02
اضافه شدن tab-02 (کدینگ شرکت‌ها) با:
  - params: ['company'] (فقط کمبو شرکت، بدون سال)
  - textParams: دو متن‌باکس برای KOl_Code و MOien_Code
  - sql: کویری روی Coding_{company}
══════════════════════════════════════════════════════════════════════ */

(function (root) {
'use strict';

/* عنوان فارسی ستون‌های Sanad — فرض ما */
const SANAD_CAPTIONS = {
Id: 'شناسه', ShomarehSanad: 'شماره سند', Tarikh: 'تاریخ', KOl_Code: 'کد کل', Moien_Code: 'کد معین',
Tafsil_Code: 'کد تفصیل', SharhSanad: 'شرح سند', Bedehkar: 'بدهکار', Bestankar: 'بستانکار'
};

/* عنوان فارسی ستون‌های Coding */
const CODING_CAPTIONS = {
Id: 'شناسه',
Coding_Goroh_Asli: 'گروه اصلی',
Coding_Goroh_Gozaresh: 'گروه گزارش',
KOl_Code: 'کد کل',
KOl_Onvan: 'عنوان کل',
MOien_Code: 'کد معین',
MOien_Onvan: 'عنوان معین',
Tafsil_Code: 'کد تفصیل',
Tafsil_Onvan: 'عنوان تفصیل',
Kol_Code_Standard: 'کد کل استاندارد',
Kol_Onvan_Standard: 'عنوان کل استاندارد',
Moien_Code_Standard: 'کد معین استاندارد',
Moien_Onvan_Standard: 'عنوان معین استاندارد',
Tafsil_Code_Standard: 'کد تفصیل استاندارد',
Tafsil_Onvan_Standard: 'عنوان تفصیل استاندارد',
Tafsil_Code1_Standard: 'کد تفصیل ۱ استاندارد',
Tafsil_Onvan1_Standard: 'عنوان تفصیل ۱ استاندارد',
Tafsil_Code2_Standard: 'کد تفصیل ۲ استاندارد',
Tafsil_Onvan2_Standard: 'عنوان تفصیل ۲ استاندارد',
CodeKarbar: 'کد کاربر'
};

const P = root.BinaPages = root.BinaPages || {};

/* ۱۳ — اسناد حسابداری: کمبوی شرکت + سال، مسیر سریع (sql=null) */
P['tab-13'] = {
id: 'tab-13', title: 'اسناد حسابداری', family: 'Sanad', params: ['company', 'year'],
sql: null, captions: SANAD_CAPTIONS, hiddenColumns: ['_SrcTable']
};

/* ۰۱ — معرفی شرکت‌ها: فعلاً همان نمای اسناد */
P['tab-01'] = Object.assign({}, P['tab-13'], { id: 'tab-01', title: 'معرفی شرکتها' });

/* ═══ ۰۲ — کدینگ شرکتها: کمبوی شرکت + دو متن‌باکس + کویری SQL ═══ */
P['tab-02'] = {
id: 'tab-02',
title: 'کدینگ شرکتها',
family: 'Coding',                    /* خانواده Coding (بدون سال) */
params: ['company'],                 /* فقط کمبوی شرکت */
textParams: [                        /* متن‌باکس‌های فیلتر */
  { key: 'kOlCode', label: 'کد کل', placeholder: 'مثلاً 1101' },
  { key: 'mOienCode', label: 'کد معین', placeholder: 'مثلاً 01' }
],
sql: "SELECT [Id],[Coding_Goroh_Asli],[Coding_Goroh_Gozaresh],[KOl_Code],[KOl_Onvan],[MOien_Code],[MOien_Onvan],[Tafsil_Code],[Tafsil_Onvan],[Kol_Code_Standard],[Kol_Onvan_Standard],[Moien_Code_Standard],[Moien_Onvan_Standard],[Tafsil_Code_Standard],[Tafsil_Onvan_Standard],[Tafsil_Code1_Standard],[Tafsil_Onvan1_Standard],[Tafsil_Code2_Standard],[Tafsil_Onvan2_Standard],[CodeKarbar] FROM Coding_{company} WHERE [KOl_Code] = {kOlCode} AND [MOien_Code] = {mOienCode}",
captions: CODING_CAPTIONS,
hiddenColumns: []
};

root.BinaCaptions = { Sanad: SANAD_CAPTIONS, Coding: CODING_CAPTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
