# بازیابی side_bar

در یک کامیت آزمایشی `FINAL/side_bar.html` موقتاً خراب شد.
نسخهٔ صحیح با لینک‌های استاندارد:

```bash
# از ریشهٔ کلون ریپو روی همین شاخه:
curl -sL https://raw.githubusercontent.com/ramingh/BINA/fe36a5e3219aaef2f7993491d786b698920dceb2/FINAL/side_bar.html \
| sed -E 's|href="pages/tab-([0-9]+(-[0-9]+)*)\.html?"|href="pages/\1/index.html"|g' \
> FINAL/side_bar.html
git add FINAL/side_bar.html
git commit -m "fix: side_bar links pages/{code}/index.html"
```

الگوی لینک جدید: `pages/11-5-1/index.html` (مطابق کد منوی Excel).
