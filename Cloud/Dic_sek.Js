/* ============================================================
   WebTranslator — نسخه‌ی کامل
   بانک: Public
   استور: Tk_dic
   ============================================================ */

class WebTranslator {
  /* dbVersion = null → دیتابیس موجود با هر نسخه‌ای که دارد باز می‌شود (ساختار بانک مال برنامه است، مترجم نسخه‌اش را تعیین نمی‌کند).
     نام دیتابیس و استور بدون حساسیت به حروف تطبیق داده می‌شوند (Public/public ، tk_dic/tk_dic). */
  constructor(dbName = 'public', storeName = 'tk_dic', dbVersion = null, options = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbVersion = dbVersion;

    // نگاشت countryCode به کد زبان
    this.countryCodeMap = { '1': 'en', '2': 'ar', '3': 'fa' };
    this.dictionaries = { en: {}, ar: {}, fa: {} };
    this.originalTexts = new Map();
    this.originalAttrs = new WeakMap();
    this.currentLanguage = 'fa';
    this.isLoaded = false;

    this.options = {
      cacheEnabled: true,
      cacheKey: 'WebTranslator_cache_v1',
      translateAttrs: ['placeholder', 'title', 'alt', 'aria-label', 'value'],
      attrTags: ['INPUT', 'TEXTAREA', 'BUTTON', 'IMG', 'A', 'OPTION'],
      skipTags: ['SCRIPT','STYLE','NOSCRIPT','PRE','CODE','KBD','SAMP','SVG','PATH'],
      minPersianChars: 1,
      /* هر چیزی داخل این سلکتورها دست‌نخورده می‌ماند (مثلاً بدنهٔ سلول‌های گرید). ویژگی استاندارد translate="no" */
      noTranslateSelector: '[translate="no"], .notranslate',
      /* رکوردهای آبجکتی ({FieldName, Caption, CountryCode}): کد کشور → زبان. 2 و 3 از داده‌ی واقعی بانک؛ 1 فرض است */
      countryCodeMapObject: { '1': 'fa', '2': 'en', '3': 'ar' },
      ...options
    };

    this._observer = null;
    this._iframeObserver = null;
    this._observedRoots = new WeakSet();
    this._stats = { translated: 0, untranslated: 0, skipped: 0 };
    this._cache = this._loadCache();
  }

  /* ============================================================
     کش
     ============================================================ */
  _loadCache() {
    if (!this.options.cacheEnabled) return {};
    try {
      return JSON.parse(localStorage.getItem(this.options.cacheKey) || '{}');
    } catch (_) { return {}; }
  }

  _saveCache() {
    if (!this.options.cacheEnabled) return;
    try {
      localStorage.setItem(this.options.cacheKey, JSON.stringify(this._cache));
    } catch (_) { /* quota */ }
  }

  _clearCache() {
    this._cache = {};
    if (this.options.cacheEnabled) localStorage.removeItem(this.options.cacheKey);
  }

  /* ============================================================
     نواحی «بدون ترجمه» — گره یا هر یک از والدهایش با noTranslateSelector بخواند
     ============================================================ */
  _isNoTranslate(node) {
    const sel = this.options.noTranslateSelector;
    if (!sel || !node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    try { return !!(el && el.closest && el.closest(sel)); } catch (_) { return false; }
  }

  /* ============================================================
     نرمال‌سازی
     ============================================================ */
  normalize(str) {
    if (!str) return '';
    return String(str)
      .replace(/\u200C/g, '')
      .replace(/ك/g, 'ک')
      .replace(/ي/g, 'ی')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ============================================================
     بارگذاری دیکشنری از IndexedDB
     بانک: Public
     استور: Tk_dic
     ساختار Value: [EnglishName, countryCode, PersianText, position]
     ============================================================ */
  /* نام واقعی دیتابیس (بدون حساسیت به حروف) — اگر indexedDB.databases() نبود همان نام داده‌شده */
  async _resolveDbName() {
    try {
      if (typeof indexedDB.databases === 'function') {
        const list = await indexedDB.databases();
        const hit = list.find((d) => d.name && d.name.toLowerCase() === String(this.dbName).toLowerCase());
        if (hit) return hit.name;
      }
    } catch (_) { /* به نام داده‌شده برمی‌گردیم */ }
    return this.dbName;
  }

  /* نام واقعی استور داخل دیتابیس باز (بدون حساسیت به حروف) */
  _resolveStoreName(db) {
    const names = Array.from(db.objectStoreNames);
    return names.find((n) => n === this.storeName) ||
           names.find((n) => n.toLowerCase() === String(this.storeName).toLowerCase()) || null;
  }

  async init() {
    if (this.isLoaded) return true;

    const dbName = await this._resolveDbName();
    return new Promise((resolve, reject) => {
      const req = this.dbVersion ? indexedDB.open(dbName, this.dbVersion) : indexedDB.open(dbName);

      req.onerror = () => {
        const why = req.error && req.error.name ? req.error.name : 'نامشخص';
        reject(new Error('خطا در باز کردن دیتابیس ' + dbName + ' (' + why + ')' +
          (why === 'VersionError' ? ' — نسخهٔ دیتابیس بالاتر از dbVersion است؛ dbVersion را null بگذار.' : '')));
      };
      req.onblocked = () => console.warn('⚠️ باز کردن دیتابیس ' + dbName + ' توسط اتصال دیگری بلوکه شده است.');

      req.onupgradeneeded = (e) => {
        // اگر دیتابیس وجود نداشت، استور را بساز
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      req.onsuccess = (e) => {
        const db = e.target.result;
        const storeName = this._resolveStoreName(db);

        if (!storeName) {
          console.warn(`⚠️ استور ${this.storeName} در دیتابیس ${dbName} یافت نشد.`);
          db.close();
          return resolve(false);
        }

        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const cursorReq = store.openCursor();

        let totalRecords = 0;
        let matchedRecords = 0;
        let rejectedSample = null;           // اولین رکوردی که پذیرفته نشد (برای تشخیص)

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            totalRecords++;
            const key = cursor.key;
            const row = cursor.value;

            // بررسی اینکه کلید با 'tk_dic_FieldName' شروع می‌شود
            // (یا هر فرمت دیگر که داشته باشید)
            const k0 = Array.isArray(key) ? String(key[0]).toLowerCase() : '';
            const isValidKey = Array.isArray(key)
              ? k0 === 'tk_dic_fieldname' || k0 === 'tk_dic'
              : true; // اگر کلید رشته‌ای بود، آن را بپذیر (حروف کوچک/بزرگ فرقی ندارد)

            // دو شکل رکورد پشتیبانی می‌شود:
            //  ۱) آرایه‌ای (قدیمی): [translatedText, countryCode, originalText, position]
            //     نگاشت countryCodeMap: 1=en, 2=ar, 3=fa
            //  ۲) آبجکتی (بانک بازسازی‌شده): { FieldName: متن فارسی, Caption: ترجمه, CountryCode, Id, ... }
            //     نگاشت options.countryCodeMapObject: 2=en, 3=ar (از داده‌ی واقعی)، 1=fa (فرض)
            let translatedText = '', countryCode = '', originalText = '', codeMap = this.countryCodeMap, parsed = false;
            if (isValidKey && Array.isArray(row) && row.length >= 3) {
              translatedText = String(row[0] || '').trim();
              countryCode    = String(row[1] || '').trim();
              originalText   = String(row[2] || '').trim();
              parsed = true;
            } else if (row && typeof row === 'object' && !Array.isArray(row)) {
              const pick = (name) => {
                const k = Object.keys(row).find((x) => x.toLowerCase() === name);
                return k === undefined || row[k] == null ? '' : String(row[k]).trim();
              };
              translatedText = pick('caption');
              countryCode    = pick('countrycode');
              originalText   = pick('fieldname');
              codeMap = this.options.countryCodeMapObject;
              parsed = true;
            } 

            if (parsed) {
              if (originalText && translatedText && countryCode) {
                const normKey = this.normalize(originalText);
                const langCode = codeMap[countryCode];

                if (langCode && this.dictionaries[langCode] && normKey) {
                  this.dictionaries[langCode][normKey] = translatedText;
                  matchedRecords++;
                } else if (!rejectedSample) rejectedSample = { key, row, why: 'countryCode ناشناخته یا متن خالی' };
              } else if (!rejectedSample) rejectedSample = { key, row, why: 'FieldName/Caption/CountryCode (یا ستون‌های آرایه‌ای) خالی' };
            } else if (!rejectedSample) rejectedSample = { key, row, why: 'شکل رکورد نامعتبر (آرایه [EnglishName, countryCode, PersianText, position] یا آبجکت {FieldName, Caption, CountryCode})' };

            cursor.continue();
          } else {
            this.isLoaded = true;
            db.close();                       /* اتصال باز نماند تا ارتقای بعدی بانک بلوکه نشود */
            console.log(
              `✅ دیکشنری از بانک '${dbName}' استور '${storeName}' بارگذاری شد.\n` +
              `📊 کل رکوردها: ${totalRecords} | ترجمه‌های معتبر: ${matchedRecords}\n` +
              `📖 (en: ${Object.keys(this.dictionaries.en).length} | ` +
              `ar: ${Object.keys(this.dictionaries.ar).length} | ` +
              `fa: ${Object.keys(this.dictionaries.fa).length})`
            );
            if (totalRecords === 0) {
              console.warn(`⚠️ استور '${storeName}' در بانک '${dbName}' خالی است؛ چیزی برای ترجمه نیست.`);
            } else if (matchedRecords === 0) {
              console.warn(`⚠️ ${totalRecords} رکورد خوانده شد ولی هیچ‌کدام معتبر نبود. اولین رکورد ردشده:`,
                JSON.stringify(rejectedSample));
            }
            resolve(true);
          }
        };

        cursorReq.onerror = () => { db.close(); reject(new Error('خطا در کورسور.')); };
      };
    });
  }

  /* ============================================================
     انتظار برای load شدن iframeهای در حال بارگذاری
     ============================================================ */
  async _waitForIframes(root) {
    const iframes = root.querySelectorAll?.('iframe') ?? [];
    const waits = [];
    for (const iframe of iframes) {
      let doc = null;
      try { doc = iframe.contentDocument; } catch (_) { doc = null; }
      if (!doc) continue;
      if (doc.readyState === 'complete') continue;

      waits.push(new Promise((res) => {
        const onLoad = () => { iframe.removeEventListener('load', onLoad); res(); };
        iframe.addEventListener('load', onLoad);
        setTimeout(res, 2000);
      }));
    }
    if (waits.length) await Promise.all(waits);
  }

  /* ============================================================
     ترجمه‌ی attributeهای یک عنصر
     ============================================================ */
  _translateAttrs(el, langCode, activedict) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (!this.options.attrTags.includes(el.tagName)) return;
    if (this._isNoTranslate(el)) return;

    const attrs = this.options.translateAttrs;
    const original = this.originalAttrs.get(el) || {};

    for (const attr of attrs) {
      if (!el.hasAttribute(attr)) continue;
      if (!(attr in original)) original[attr] = el.getAttribute(attr);
      const rawText = original[attr];
      const normText = this.normalize(rawText);

      if (langCode === 'fa') {
        if (el.getAttribute(attr) !== rawText) el.setAttribute(attr, rawText);
      } else if (activedict[normText]) {
        el.setAttribute(attr, activedict[normText]);
        this._stats.translated++;
      }
    }
    this.originalAttrs.set(el, original);
  }

  /* ============================================================
     پیمایش یک ریشه (Document یا ShadowRoot)
     ============================================================ */
  _translateRoot(root, langCode, activedict, visited) {
    if (!root || visited.has(root)) return;
    visited.add(root);

    const walkRoot = root.body || root;

    // --- گره‌های متنی ---
    try {
      const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (this.options.skipTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (this._isNoTranslate(parent)) return NodeFilter.FILTER_REJECT;
          return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });

      let n;
      while ((n = walker.nextNode())) {
        if (!this.originalTexts.has(n)) this.originalTexts.set(n, n.nodeValue);
        const rawText = this.originalTexts.get(n);
        const normText = this.normalize(rawText);

        if (langCode === 'fa') {
          if (n.nodeValue !== rawText) n.nodeValue = rawText;
        } else if (activedict[normText]) {
          const lead = rawText.match(/^\s*/)[0];
          const trail = rawText.match(/\s*$/)[0];
          n.nodeValue = lead + activedict[normText] + trail;
          this._stats.translated++;
        } else {
          this._stats.untranslated++;
        }
      }
    } catch (_) { /* ignore */ }

    // --- attributeها ---
    try {
      const all = walkRoot.querySelectorAll?.('*') ?? [];
      for (const el of all) {
        if (this.options.attrTags.includes(el.tagName)) {
          this._translateAttrs(el, langCode, activedict);
        }
      }
    } catch (_) { /* ignore */ }

    // --- iframeهای هم‌مبدأ ---
    try {
      const iframes = walkRoot.querySelectorAll?.('iframe') ?? [];
      for (const iframe of iframes) {
        let childDoc = null;
        try { childDoc = iframe.contentDocument || null; } catch (_) { childDoc = null; }
        if (!childDoc) continue;
        if (childDoc.readyState && childDoc.readyState !== 'complete') continue;

        if (childDoc.body) {
          childDoc.body.setAttribute('dir', langCode === 'en' ? 'ltr' : 'rtl');
        }
        this._translateRoot(childDoc, langCode, activedict, visited);
      }
    } catch (_) { /* ignore */ }

    // --- Shadow DOM باز ---
    try {
      const all = walkRoot.querySelectorAll?.('*') ?? [];
      for (const el of all) {
        const sr = el.shadowRoot;
        if (sr) this._translateRoot(sr, langCode, activedict, visited);
      }
    } catch (_) { /* ignore */ }
  }

  /* ============================================================
     اعمال زبان
     ============================================================ */
  async setLanguage(langCode) {
    if (!['fa', 'en', 'ar'].includes(langCode)) {
      console.error("❌ کد زبان نامعتبر. (fa, en, ar)");
      return;
    }

    this.currentLanguage = langCode;
    const activedict = this.dictionaries[langCode] || {};
    if (langCode !== 'fa' && !Object.keys(activedict).length) {
      console.warn(`⚠️ دیکشنری '${langCode}' خالی است` +
        (this.isLoaded ? ' — رکوردی با countryCode این زبان در استور نیست.' : ' — init() هنوز تمام نشده یا ناموفق بوده است.'));
    }

    document.body.setAttribute('dir', langCode === 'en' ? 'ltr' : 'rtl');

    await this._waitForIframes(document);

    this._stats = { translated: 0, untranslated: 0, skipped: 0 };
    const visited = new Set();
    this._translateRoot(document, langCode, activedict, visited);

    this._saveCache();

    if (langCode !== 'fa') this._startObserver();
    else this._stopObserver();

    console.log(
      `🔄 زبان: '${langCode}' | ترجمه‌شده: ${this._stats.translated} | ترجمه‌نشده: ${this._stats.untranslated}`
    );
    return this.getStats();
  }

  /* ============================================================
     Observer برای محتوای داینامیک
     ============================================================ */
  _startObserver() {
    if (this._observer) return;

    const processNode = (node) => {
      const activedict = this.dictionaries[this.currentLanguage] || {};
      const visited = new Set();

      if (this._isNoTranslate(node)) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'IFRAME') this._attachIframeObserver(node);
        this._translateRoot(node, this.currentLanguage, activedict, visited);
        const innerIframes = node.querySelectorAll?.('iframe') ?? [];
        for (const f of innerIframes) this._attachIframeObserver(f);
      } else if (node.nodeType === Node.TEXT_NODE) {
        if (!this.originalTexts.has(node)) this.originalTexts.set(node, node.nodeValue);
        const rawText = this.originalTexts.get(node);
        const normText = this.normalize(rawText);
        if (activedict[normText]) {
          const lead = rawText.match(/^\s*/)[0];
          const trail = rawText.match(/\s*$/)[0];
          node.nodeValue = lead + activedict[normText] + trail;
        }
      }
    };

    this._observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) processNode(node);
        if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
          const t = m.target;
          if (this._isNoTranslate(t)) continue;
          if (!this.originalTexts.has(t)) {
            this.originalTexts.set(t, t.nodeValue);
            const activedict = this.dictionaries[this.currentLanguage] || {};
            const rawText = t.nodeValue;
            const normText = this.normalize(rawText);
            if (activedict[normText]) {
              const lead = rawText.match(/^\s*/)[0];
              const trail = rawText.match(/\s*$/)[0];
              t.nodeValue = lead + activedict[normText] + trail;
            }
          }
        }
      }
    });

    this._observer.observe(document.body, {
      childList: true, subtree: true, characterData: true
    });

    this._observeAllIframes(document.body);
  }

  _attachIframeObserver(iframe) {
    let doc = null;
    try { doc = iframe.contentDocument; } catch (_) { doc = null; }
    if (!doc || !doc.body || this._observedRoots.has(doc.body)) return;
    this._observedRoots.add(doc.body);

    const obs = new MutationObserver((mutations) => {
      const activedict = this.dictionaries[this.currentLanguage] || {};
      const visited = new Set();
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (this._isNoTranslate(node)) continue;
          if (node.nodeType === Node.ELEMENT_NODE) {
            this._translateRoot(node, this.currentLanguage, activedict, visited);
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (!this.originalTexts.has(node)) this.originalTexts.set(node, node.nodeValue);
            const rawText = this.originalTexts.get(node);
            const normText = this.normalize(rawText);
            if (activedict[normText]) node.nodeValue = activedict[normText];
          }
        }
      }
    });
    obs.observe(doc.body, { childList: true, subtree: true, characterData: true });
  }

  _observeAllIframes(root) {
    try {
      const iframes = root.querySelectorAll?.('iframe') ?? [];
      for (const f of iframes) {
        this._attachIframeObserver(f);
        let d = null;
        try { d = f.contentDocument; } catch (_) { d = null; }
        if (d && d.body) this._observeAllIframes(d.body);
      }
    } catch (_) { /* ignore */ }
  }

  _stopObserver() {
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
  }

  /* ============================================================
     گزارش و ابزارها
     ============================================================ */
  getStats() {
    return { ...this._stats };
  }

  getdictionarySize(langCode) {
    return Object.keys(this.dictionaries[langCode] || {}).length;
  }

  clearCache() { this._clearCache(); }

  getCurrentLanguage() { return this.currentLanguage; }





   async requestPersistentStorage() {
  // ۱. بررسی پشتیبانی مرورگر
  if (!navigator.storage || !navigator.storage.persist) {
    console.warn('⚠️ مرورگر از Persistent Storage پشتیبانی نمی‌کند.');
    return false;
  }

  // ۲. بررسی اینکه آیا قبلاً ماندگار شده یا نه
  if (await navigator.storage.persisted()) {
    console.log('✅ ذخیره‌سازی از قبل ماندگار است.');
    return true;
  }

  // ۳. درخواست ماندگاری
  const isGranted = await navigator.storage.persist();
  
  if (isGranted) {
    console.log('✅ ذخیره‌سازی ماندگار شد. داده‌ها پاک نخواهند شد.');
  } else {
    console.warn('⚠️ مرورگر درخواست ماندگاری را رد کرد.');
    
    // راه‌حل جایگزین: نمایش راهنما به کاربر
    console.log('💡 برای ماندگاری، کاربر باید با سایت تعامل داشته باشد (کلیک، اسکرول و ...)');
  }
  
  return isGranted;
}

// بررسی میزان فضای استفاده شده و باقیمانده
  async  checkStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const usedMB = (estimate.usage / 1024 / 1024).toFixed(2);
    const quotaMB = (estimate.quota / 1024 / 1024).toFixed(2);
    const percent = ((estimate.usage / estimate.quota) * 100).toFixed(1);
    
    console.log(
      `💾 فضای ذخیره‌سازی:\n` +
      `   استفاده شده: ${usedMB} مگابایت\n` +
      `   سهم کل: ${quotaMB} مگابایت\n` +
      `   درصد استفاده: ${percent}%`
    );
    
    return estimate;
  }
  return null;
}
async   requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    console.warn('StorageManager.persist() پشتیبانی نمی‌شود.');
    return false;
  }

  const alreadyPersisted = await navigator.storage.persisted();
  if (alreadyPersisted) {
    console.log('✅ Storage از قبل persistent است.');
    return true;
  }

  const granted = await navigator.storage.persist();
  if (granted) {
    console.log('✅ Storage اکنون persistent است. داده‌ها به‌صورت خودکار پاک نمی‌شوند.');
  } else {
    console.log('⚠️ Storage همچنان best-effort است. مرورگر ممکن است زیر فشار فضا داده را حذف کند.');
  }
  return granted;
}

 
}