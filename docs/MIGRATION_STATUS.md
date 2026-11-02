# وضعیت جابجایی فایل‌ها
## انجام‌شده
- [x] ساخت `docs/` و انتقال مستندات اصلی
- [x] ساخت اسکلت کامل `admin/`، `app/` (با زیرپوشه‌ها) و `legacy/`
- [x] کپی READMEهای مهم به مسیرهای جدید
- [x] آماده‌سازی ساختار استاندارد
## مرحله بعدی (آماده اجرا)
چون فایل‌های اصلی (به خصوص bina-grid.js حدود ۹۰KB و فایل‌های مدیر) حجیم هستند، پیشنهاد می‌کنم یکی از دو روش زیر را انجام دهیم:
### روش پیشنهادی (سریع و ایمن):
تو به صورت لوکال این دستورات را اجرا کن (چون بک‌آپ داری):
```bash
# انتقال admin
mkdir -p admin/manager admin/sql admin/tests
cp -r BINA_admin/manager/* admin/manager/
cp -r BINA_admin/sql/* admin/sql/
cp -r BINA_admin/tests/* admin/tests/
# انتقال هسته app
mkdir -p app/core app/components app/shell app/pages app/assets
cp Cloud/app/bina/bina-local-sql.js app/core/
cp Cloud/app/bina/bina-grid.js app/components/
cp Cloud/app/bina/bina-query-view.js app/components/
cp Cloud/app/bina/bina-pages.js app/components/
cp Cloud/app/bina/bina-page.js app/components/
cp Cloud/app/bina/bina-tabs.js app/components/
cp Cloud/app/bina/bina-shell.js app/shell/
cp Cloud/app/side_bar.html app/shell/
cp Cloud/app/app.js app/shell/
cp Cloud/app/Dic_sek.Js app/shell/
cp Cloud/app/pages/* app/pages/
# انتقال فایل‌های قدیمی
mkdir -p legacy
mv Cloud_Bak legacy/ 2>/dev/null || true
mv bina_db-v01.js bina_db-v010.js legacy/ 2>/dev/null || true
```
بعد از اجرای این دستورات، بگو تا من مسیرها را در کدها و READMEها به‌روزرسانی کنم.
### یا
اگر می‌خواهی من ادامه دهم، بگو تا فایل‌های کلیدی را یکی‌یکی از طریق API منتقل کنم (زمان‌برتر است).
## قوانین
- هیچ فایل اصلی را حذف نمی‌کنیم تا وقتی که جابجایی کامل و تست شده باشد.
- مسیرهای قدیمی فعلاً باقی می‌مانند.
