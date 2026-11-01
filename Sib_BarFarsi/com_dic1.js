class WebTranslator {
  constructor(dbName = 'public', storeName = 'tk', dbVersion = null) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbVersion = dbVersion;
    
    this.dictionaries = { en: {}, ar: {} }; 
    this.originalTexts = new Map();
    this.currentLanguage = 'fa'; // پیش‌فرض فارسی
    this.isLoaded = false;
  }

  /**
   * ۱. متد نرمال‌سازی متن (برای رفع مشکل نیم‌فاصله و حروف ک/ي)
   */
  normalize(str) {
    if (!str) return '';
    return String(str)
      .replace(/‌/g, '')     // حذف نیم‌فاصله
      .replace(/ك/g, 'ک')    // یکسان‌سازی کاف
      .replace(/ي/g, 'ی')    // یکسان‌سازی یاء
      .replace(/\s+/g, ' ')  // حذف فاصله‌های اضافی
      .trim();
  }

  /**
   * ۲. متد بارگذاری و ساخت دیکشنری از IndexedDB با استفاده از Cursor
   */
  async init() {
    if (this.isLoaded) return;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);

      req.onerror = () => reject(new Error("خطا در باز کردن دیتابیس."));

      req.onsuccess = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains(this.storeName)) {
          console.warn(`⚠️ استور ${this.storeName} در دیتابیس یافت نشد.`);
          return resolve(false);
        }

        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const key = cursor.key; // کلید رکورد، مثل ['tk_dic_FieldName', ID]

            // فیلتر دقیق رکوردهای جدول tk_dic_FieldName
            if (Array.isArray(key) && key[0] === 'tk_dic') {
              const row = cursor.value; // ساختار: [item0, item1, item2, item3]

              if (Array.isArray(row) && row.length >= 3) {
                const  originalText    = String(row[2] || '').trim(); // item0: ترجمه (English/Arabic)
                const countryCode = String(row[1] || '').trim();    // item1: کد زبان (1, 2, 3)
                const translatedText = String(row[3] || '').trim();  // item2: متن فارسی (کلید جستجو)

                console.log(row, '==========================',translatedText,countryCode,originalText);
                // AccountingDocuments 1 اسناد حسابداری
                if (originalText && translatedText) {
                  const normKey = this.normalize(originalText);

                  // کدهای ۱ و ۲ -> انگلیسی (en)
                  if (countryCode === '2') {
                    this.dictionaries.en[normKey] = translatedText;
                  } 
                  // کد ۳ -> عربی (ar)
                  else if (countryCode === '3') {
                    this.dictionaries.ar[normKey] = translatedText;
                  }
                }
              }
            }
            cursor.continue();
          } else {
            this.isLoaded = true;
            console.log(`✅ دیکشنری با موفقیت بارگذاری شد. (انگلیسی: ${Object.keys(this.dictionaries.en).length} | عربی: ${Object.keys(this.dictionaries.ar).length})`);
            resolve(true);
          }
        };

        cursorReq.onerror = () => reject(new Error("خطا در خواندن رکوردهای کورسور."));
      };
    });
  }

  /**
   * ۳. متد اعمال زبان روی صفحه
   */
  setLanguage(langCode) {
    if (!['fa', 'en', 'ar'].includes(langCode)) {
      console.error("❌ کد زبان نامعتبر است. از 'fa'، 'en' یا 'ar' استفاده کنید.");
      return;
    }

    this.currentLanguage = langCode;
    const activedict = this.dictionaries[langCode] || {};

    // تنظیم جهت صفحه (RTL برای فارسی و عربی، LTR برای انگلیسی)
    document.body.setAttribute('dir', langCode === 'en' ? 'ltr' : 'rtl');

// در فایل com_dic.js داخل متد setLanguage:
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
  acceptNode(node) {
    const parent = node.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;
    // نادیده گرفتن اسکریپت‌ها، استایل‌ها و آیکون‌های SVG
    if (["SCRIPT", "STYLE", "NOSCRIPT", "PRE", "CODE", "SVG", "PATH"].includes(parent.tagName)) {
      return NodeFilter.FILTER_REJECT;
    }
    return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  }
});

    let n;
    while ((n = walker.nextNode())) {
      // ذخیره متن اولیه فارسی برای امکان بازگشت بدون رفرش
      if (!this.originalTexts.has(n)) {
        this.originalTexts.set(n, n.nodeValue);
      }

      const rawText = this.originalTexts.get(n);
      const normText = this.normalize(rawText);

      if (langCode === 'fa') {
        n.nodeValue = rawText; // بازگشت به متن اصلی
      } else if (activedict[normText]) {
        const leadingSpace = rawText.match(/^\s*/)[0];
        const trailingSpace = rawText.match(/\s*$/)[0];
        n.nodeValue = leadingSpace + activedict[normText] + trailingSpace;
      }
    }

    console.log(`🔄 زبان صفحه به '${langCode}' تغییر یافت.`);
  }

  /**
   * ۴. متد دریافت زبان فعلی
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }
}