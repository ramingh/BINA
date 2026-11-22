# ساختار استاندارد BINA

نام‌گذاری صفحات مطابق کد منوی سایدبار (Excel / data-menu-code):

```
FINAL/pages/{code}/index.html   # صفحه
FINAL/pages/{code}/page.js      # منطق اختصاصی همان صفحه (در صورت وجود)
```

مثال:
- `11-5-1` → `FINAL/pages/11-5-1/index.html` + `page.js`
- لینک سایدبار: `pages/11-5-1/index.html`

## پوشه‌های مشترک
- `FINAL/css/` استایل‌ها
- `FINAL/app/bina/` هسته مشترک (grid, tabulator, page-theme, …)
- `admin/manager/` مدیریت IndexedDB و webservice
- `admin/sql/` کوئری‌ساز

## قاعده
1. کد منو = نام پوشه صفحه
2. پسوند فقط `.html` و `.js` (حروف کوچک)
3. فایل بلااستفاده → `_archive/` (فهرست در UNUSED_FILES.md)
