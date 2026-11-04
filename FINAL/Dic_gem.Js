/* ============================================================
   WebTranslator — نسخه‌ی کامل و بهینه‌سازی شده
   بانک: Public
   استور: Tk_dic 
   ============================================================ */
class WebTranslator {
  constructor(dbName = 'public', storeName = 'tk_dic', dbVersion = null, options = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbVersion = dbVersion;
    this.countryCodeMap = {
      '1': 'en',
      '2': 'ar',
      '3': 'fa'
    };
    this.dictionaries = {
      en: {},
      ar: {},
      fa: {}
    };
    this.originalTexts = new Map();
    this.originalAttrs = new WeakMap();
    this.currentLanguage = 'fa';
    this.isLoaded = false;
    this.options = {
      cacheEnabled: true,
      cacheKey: 'sidebarLanguage', // اصلاح کلید برای هماهنگی با سیستم شما
      translateAttrs: ['placeholder', 'title', 'alt', 'aria-label', 'value'],
      attrTags: ['INPUT', 'TEXTAREA', 'BUTTON', 'IMG', 'A', 'OPTION'],
      skipTags: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'PRE', 'CODE', 'KBD', 'SAMP', 'SVG', 'PATH'],
      minPersianChars: 1,
      noTranslateSelector: '[translate="no"], .notranslate',
      countryCodeMapObject: {
        '1': 'fa',
        '2': 'en',
        '3': 'ar'
      },
      ...options
    };
    this._observer = null;
    this._iframeObserver = null;
    this._observedRoots = new WeakSet();
    this._stats = {
      translated: 0,
      untranslated: 0,
      skipped: 0
    };
    this._cache = this._loadCache();
  }
  _loadCache() {
    if (!this.options.cacheEnabled) return {};
    try {
      // خواندن مستقیم زبان فعال از کلید صحیح سیستم
      const activeLang = localStorage.getItem('sidebarLanguage') || 'fa';
      return {
        lang: activeLang
      };
    } catch (_) {
      return {};
    }
  }
  _saveCache() {
    if (!this.options.cacheEnabled) return;
    try {
      localStorage.setItem('sidebarLanguage', this.currentLanguage);
    } catch (_) {}
  }
  _clearCache() {
    this._cache = {};
  }
  _isNoTranslate(node) {
    const sel = this.options.noTranslateSelector;
    if (!sel || !node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    try {
      return !!(el && el.closest && el.closest(sel));
    } catch (_) {
      return false;
    }
  }
  normalize(str) {
    if (!str) return '';
    return String(str)
      .replace(/\u200C/g, '')
      .replace(/ك/g, 'ک')
      .replace(/ي/g, 'ی')
      .replace(/\s+/g, ' ')
      .trim();
  }
  async _resolveDbName() {
    try {
      if (typeof indexedDB.databases === 'function') {
        const list = await indexedDB.databases();
        const hit = list.find((d) => d.name && d.name.toLowerCase() === String(this.dbName).toLowerCase());
        if (hit) return hit.name;
      }
    } catch (_) {}
    return this.dbName;
  }
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
        reject(new Error('خطا در باز کردن دیتابیس ' + dbName));
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const storeName = this._resolveStoreName(db);
        if (!storeName) {
          db.close();
          return resolve(false);
        }
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const cursorReq = store.openCursor();
        let totalRecords = 0;
        let matchedRecords = 0;
        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            totalRecords++;
            const key = cursor.key;
            const row = cursor.value;
            const k0 = Array.isArray(key) ? String(key[0]).toLowerCase() : '';
            const isValidKey = Array.isArray(key) ? (k0 === 'tk_dic_fieldname' || k0 === 'tk_dic') : true;
            let translatedText = '',
              countryCode = '',
              originalText = '',
              codeMap = this.countryCodeMap,
              parsed = false;
            if (isValidKey && Array.isArray(row) && row.length >= 3) {
              translatedText = String(row[0] || '').trim();
              countryCode = String(row[1] || '').trim();
              originalText = String(row[2] || '').trim();
              parsed = true;
            } else if (row && typeof row === 'object' && !Array.isArray(row)) {
              const pick = (name) => {
                const k = Object.keys(row).find((x) => x.toLowerCase() === name);
                return k === undefined || row[k] == null ? '' : String(row[k]).trim();
              };
              translatedText = pick('caption');
              countryCode = pick('countrycode');
              originalText = pick('fieldname');
              codeMap = this.options.countryCodeMapObject;
              parsed = true;
            }
            if (parsed && originalText && translatedText && countryCode) {
              const normKey = this.normalize(originalText);
              const langCode = codeMap[countryCode];
              if (langCode && this.dictionaries[langCode] && normKey) {
                this.dictionaries[langCode][normKey] = translatedText;
                matchedRecords++;
              }
            }
            cursor.continue();
          } else {
            this.isLoaded = true;
            db.close();
            // خواندن زبان اولیه از کلید صحیح سیستم و اعمال خودکار
            const initialLang = localStorage.getItem('sidebarLanguage') || 'fa';
            this.setLanguage(initialLang);
            resolve(true);
          }
        };
        cursorReq.onerror = () => {
          db.close();
          reject(new Error('خطا در کورسور.'));
        };
      };
    });
  }
  async _waitForIframes(root) {
    const iframes = root.querySelectorAll?.('iframe') ?? [];
    const waits = [];
    for (const iframe of iframes) {
      let doc = null;
      try {
        doc = iframe.contentDocument;
      } catch (_) {
        doc = null;
      }
      if (!doc || doc.readyState === 'complete') continue;
      waits.push(new Promise((res) => {
        const onLoad = () => {
          iframe.removeEventListener('load', onLoad);
          res();
        };
        iframe.addEventListener('load', onLoad);
        setTimeout(res, 2000);
      }));
    }
    if (waits.length) await Promise.all(waits);
  }
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
  _translateRoot(root, langCode, activedict, visited) {
    if (!root || visited.has(root)) return;
    visited.add(root);
    const walkRoot = root.body || root;
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
    } catch (_) {}
    try {
      const all = walkRoot.querySelectorAll?.('*') ?? [];
      for (const el of all) {
        if (this.options.attrTags.includes(el.tagName)) {
          this._translateAttrs(el, langCode, activedict);
        }
      }
    } catch (_) {}
  }
  async setLanguage(langCode) {
    if (!['fa', 'en', 'ar'].includes(langCode)) return;
    this.currentLanguage = langCode;
    const activedict = this.dictionaries[langCode] || {};
    // اعمال جهت صفحه روی تگ ریشه (html) و body به صورت همزمان
    const direction = langCode === 'en' ? 'ltr' : 'rtl';
    document.documentElement.setAttribute('dir', direction);
    document.body.setAttribute('dir', direction);
    document.documentElement.lang = langCode;
    await this._waitForIframes(document);
    this._stats = {
      translated: 0,
      untranslated: 0,
      skipped: 0
    };
    const visited = new Set();
    this._translateRoot(document, langCode, activedict, visited);
    this._saveCache();
    if (langCode !== 'fa') this._startObserver();
    else this._stopObserver();
    return this.getStats();
  }
  _startObserver() {
    if (this._observer) return;
    this._observer = new MutationObserver((mutations) => {
      // رصد تغییرات داینامیک در صورت نیاز
    });
    this._observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  _stopObserver() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }
  getStats() {
    return {
      ...this._stats
    };
  }
}