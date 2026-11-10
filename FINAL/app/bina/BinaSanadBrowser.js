/* BINA Sanad Browser v1.0.0 — standalone UI; existing core files are unchanged.
 * IndexedDB: public/columns + public/TK_sherkat; company db: Coding and Sanad.
 * Reuses BinaDBManager, DataDecompressor.inflateSingleBlock and BinaGrid.
 * Unlike DataDecompressor.inflateBlocks (default cap 250000), streams ALL blocks
 * without silently truncating the document index.
 */
(function (root) {
  'use strict';

  const MONEY = new Intl.NumberFormat('fa-IR', {maximumFractionDigits: 3});
  const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const COLLATOR = new Intl.Collator('fa', {numeric:true, sensitivity:'base'});
  const keyText = value => String(value == null ? '' : value).trim();
  const ascii = value => keyText(value)
    .replace(/[۰-۹]/g, d => String(DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)));
  const codeKey = value => {
    const s = ascii(value);
    return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
  };
  const accountKey = (kol, moien, tafsil) =>
    [kol, moien, tafsil].map(codeKey).join('|');
  const money = value => {
    if (value == null || value === '') return 0;
    const numeric = ascii(value).replace(/[\s,٬،]/g, '');
    const n = Number(numeric);
    if (!Number.isFinite(n)) throw new Error('مبلغ بدهکار/بستانکار نامعتبر است: ' + String(value));
    return n;
  };
  const dateText = value => {
    let s = ascii(value);
    if (/^\d{8}$/.test(s)) s = s.slice(0,4) + '/' + s.slice(4,6) + '/' + s.slice(6);
    return s.replace(/-/g, '/');
  };
  const field = (row, names) => {
    for (const name of names) if (row[name] !== undefined && row[name] !== null) return row[name];
    return '';
  };

  class BinaSanadBrowser {
    constructor(container) {
      if (!container) throw new Error('ریشه فرم اسناد پیدا نشد.');
      this.root = container;
      this.el = id => container.querySelector('#' + id);
      this.ui = {
        company: this.el('sb-company'), year: this.el('sb-year'),
        load: this.el('sb-load'), status: this.el('sb-status'),
        docSelect: this.el('sb-document'), number: this.el('sb-number'),
        date: this.el('sb-date'), counter: this.el('sb-counter'),
        first: this.el('sb-first'), prev: this.el('sb-prev'),
        next: this.el('sb-next'), last: this.el('sb-last'),
        print: this.el('sb-print'), debit: this.el('sb-total-debit'),
        credit: this.el('sb-total-credit'), balance: this.el('sb-balance'),
        account: this.el('sb-account-title')
      };
      this.dbManager = null;
      this.decompressor = null;
      this.grid = null;
      this.docs = [];
      this.accountTitles = new Map();
      this.current = -1;
      this.loadedKey = '';
      this.busy = false;
      this._yearRequest = 0;
      this._showRequest = 0;
      this._bind();
    }

    _bind() {
      const u = this.ui;
      u.company.addEventListener('change', async () => {
        const requestId = ++this._yearRequest;
        this._invalidate();
        await this._loadYears(u.company.value, requestId);
      });
      u.year.addEventListener('change', () => this._invalidate());
      u.load.addEventListener('click', () => this.load());
      u.docSelect.addEventListener('change', () => this.showDocument(Number(u.docSelect.value)));
      u.first.addEventListener('click', () => this.showDocument(0));
      u.prev.addEventListener('click', () => this.showDocument(this.current - 1));
      u.next.addEventListener('click', () => this.showDocument(this.current + 1));
      u.last.addEventListener('click', () => this.showDocument(this.docs.length - 1));
      u.print.addEventListener('click', () => root.print());
    }

    _status(message, error = false) {
      this.ui.status.textContent = message;
      this.ui.status.classList.toggle('sb-error', error);
    }

    _busy(value) {
      this.busy = value;
      this.ui.company.disabled = value;
      this.ui.year.disabled = value || !this.ui.company.value;
      this.ui.load.disabled = value || !this.ui.company.value || !this.ui.year.value;
      this._updateButtons();
    }

    _updateButtons() {
      const active = !this.busy && this.current >= 0;
      this.ui.docSelect.disabled = !active;
      this.ui.first.disabled = !active || this.current <= 0;
      this.ui.prev.disabled = !active || this.current <= 0;
      this.ui.next.disabled = !active || this.current >= this.docs.length - 1;
      this.ui.last.disabled = !active || this.current >= this.docs.length - 1;
      this.ui.print.disabled = !active;
    }

    _invalidate() {
      this.loadedKey = '';
      this.docs = [];
      this.accountTitles.clear();
      this.current = -1;
      this._showRequest++;
      this.ui.number.textContent = '—';
      this.ui.date.textContent = '—';
      this.ui.counter.textContent = '۰ از ۰';
      this.ui.docSelect.replaceChildren(new Option('ابتدا اطلاعات را نمایش دهید', ''));
      this.ui.debit.textContent = '۰';
      this.ui.credit.textContent = '۰';
      this.ui.balance.textContent = '—';
      this.ui.balance.classList.remove('sb-unbalanced');
      this.ui.account.textContent = 'برای نمایش عنوان، یک ردیف سند را انتخاب کنید.';
      if (this.grid) this.grid.clearData().catch(e => console.warn(e));
      this._busy(false);
    }

    async init() {
      try {
        if (!root.BinaDBManager || !root.DataDecompressor || !root.BinaGrid ||
            !root.pako || !root.Tabulator) {
          throw new Error('کتابخانه‌های Tabulator، Pako یا کامپوننت‌های BINA بارگذاری نشده‌اند.');
        }
        let publicDbName = 'public';
        if (typeof indexedDB.databases === 'function') {
          const names = (await indexedDB.databases()).map(d => d.name).filter(Boolean);
          publicDbName = names.find(n => n.toLowerCase() === 'public') || publicDbName;
          if (!names.includes(publicDbName)) throw new Error('بانک Public در IndexedDB این سایت وجود ندارد.');
        }
        this.dbManager = new root.BinaDBManager({publicDbName});
        this.decompressor = new root.DataDecompressor();
        this.grid = new root.BinaGrid(this.el('sb-grid'), {
          pageSize: 500, height: '100%', rtl: true,
          captions: {
            kol_code:'کد کل', moien_code:'کد معین', tafsil_code:'کد تفصیل',
            sharhsanad:'شرح سند', bedehkar:'بدهکار', bestankar:'بستانکار'
          },
          noTranslateBody:true, storagePrefix:'BinaSanadBrowser'
        });
        this.grid.on('rowClick', event => this._showAccount(event.data));
        const companies = await this.dbManager.getCompanies();
        if (!companies.length) throw new Error('شرکتی در Public/TK_sherkat یافت نشد.');
        this.ui.company.replaceChildren();
        for (const company of companies) {
          this.ui.company.add(new Option(company.EsmSherkat + ' (' + company.Codesherkat + ')', company.Codesherkat));
        }
        const requestId = ++this._yearRequest;
        await this._loadYears(this.ui.company.value, requestId);
        this._status('شرکت و سال مالی را انتخاب کنید و «نمایش اسناد» را بزنید.');
      } catch (err) {
        this._status(err.message || String(err), true);
        console.error('[BinaSanadBrowser:init]', err);
      }
    }

    async _loadYears(company, requestId) {
      const u = this.ui;
      u.year.disabled = true;
      u.year.replaceChildren(new Option('در حال بارگذاری…', ''));
      if (!company) return;
      try {
        const years = await this.dbManager.getAvailableYears(company);
        if (requestId !== this._yearRequest) return;
        u.year.replaceChildren();
        if (!years.length) {
          u.year.add(new Option('بدون سند', ''));
        } else {
          for (const year of years) u.year.add(new Option(String(year), String(year)));
          u.year.value = String(years[years.length - 1]);
        }
        this._busy(false);
      } catch (err) {
        if (requestId !== this._yearRequest) return;
        u.year.replaceChildren(new Option('خطا در خواندن سال', ''));
        this._status(err.message, true);
      }
    }

    // Maps array-valued GZIP rows to public/columns without guessing column offsets.
    _columnsFor(columns, rawLength) {
      const all = this.decompressor.normalizeColumns(columns).map(c => c.name.toLowerCase());
      const isId = n => n === 'id';
      const isKey = n => isId(n) || ['companycode','company','fiscalyear','year'].includes(n);
      const candidates = [all.filter(n => !isKey(n)), all.filter(n => !isId(n)), all];
      const matched = candidates.find(c => c.length === rawLength);
      if (!matched) {
        throw new Error('ساختار ستون‌ها با داده‌های فشرده تطابق ندارد (طول ردیف ' +
          rawLength + '، ستون‌ها ' + all.length + ').');
      }
      return matched;
    }

    // Uses the existing DataDecompressor for each block, but never imposes its
    // default 250,000-row cap. Only the fields needed by the form are retained.
    async _eachRow(data, callback, label) {
      let count = 0, layout = null, oldLength = -1;
      for (let b = 0; b < data.blocks.length; b++) {
        const decoded = await this.decompressor.inflateSingleBlock(data.blocks[b]);
        if (!decoded || !Array.isArray(decoded.rows)) {
          throw new Error('فرمت بلوک فشرده ' + label + ' نامعتبر است.');
        }
        for (const raw of decoded.rows) {
          let row;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
          } else if (Array.isArray(raw)) {
            if (raw.length !== oldLength) {
              layout = this._columnsFor(data.columns, raw.length);
              oldLength = raw.length;
            }
            row = {};
            for (let c = 0; c < layout.length; c++) row[layout[c]] = raw[c];
          } else {
            throw new Error('نوع ردیف ' + label + ' نامعتبر است.');
          }
          callback(row);
          count++;
        }
        data.blocks[b] = null; // release compressed input
        if ((b + 1) % 8 === 0) {
          this._status('خواندن ' + label + ': ' + MONEY.format(count) + ' ردیف…');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      return count;
    }

    async load() {
      if (this.busy) return;
      const company = this.ui.company.value;
      const year = Number(this.ui.year.value);
      if (!company || !Number.isFinite(year) || !year) return;
      const cacheKey = company + '|' + year;
      if (this.loadedKey === cacheKey && this.docs.length) {
        await this.showDocument(this.current >= 0 ? this.current : 0);
        return;
      }
      this._invalidate();
      this._busy(true);
      const started = performance.now();
      try {
        this._status('در حال خواندن کدینگ و ساخت ایندکس عنوان‌ها…');
        const coding = await this.dbManager.getReadyData(company, 'coding', null);
        const titles = new Map();
        await this._eachRow(coding, row => {
          const k = accountKey(row.kol_code, row.moien_code, row.tafsil_code);
          titles.set(k, [
            field(row,['kol_onvan','onvan_kol']),
            field(row,['moien_onvan','onvan_moien']),
            field(row,['tafsil_onvan','onvan_tafsil'])
          ].map(keyText).filter(Boolean).join(' - '));
        }, 'کدینگ');

        this._status('در حال خواندن اسناد و فهرست‌بندی شماره سندها…');
        const sanad = await this.dbManager.getReadyData(company, 'sanad', year);
        const byNumber = new Map();
        let totalLines = 0;
        await this._eachRow(sanad, row => {
          const number = keyText(field(row,['shomarehsanad','shomareh_sanad','shomare_sanad']));
          if (!number) throw new Error('ستون shomarehsanad در یک ردیف سند وجود ندارد.');
          const day = dateText(field(row,['tarikh','tarikhsanad','tarikh_sanad']));
          const k = ascii(number);
          let doc = byNumber.get(k);
          if (!doc) {
            doc = {number, date:day, rows:[], debit:0, credit:0};
            byNumber.set(k, doc);
          }
          if (!doc.date && day) doc.date = day;
          const debit = money(field(row,['bedehkar']));
          const credit = money(field(row,['bestankar']));
          doc.rows.push({
            kol_code: field(row,['kol_code']),
            moien_code: field(row,['moien_code']),
            tafsil_code: field(row,['tafsil_code']),
            sharhsanad: field(row,['sharhsanad','sharh_sanad','sharh']),
            bedehkar: debit,
            bestankar: credit
          });
          doc.debit += debit;
          doc.credit += credit;
          totalLines++;
        }, 'اسناد');

        const docs = [...byNumber.values()].sort((a, b) => COLLATOR.compare(ascii(a.number), ascii(b.number)));
        if (!docs.length) throw new Error('برای این شرکت و سال مالی سندی یافت نشد.');
        this.accountTitles = titles;
        this.docs = docs;
        this.loadedKey = cacheKey;

        // Every option contains both document number and date.
        const select = this.ui.docSelect;
        select.replaceChildren();
        const options = document.createDocumentFragment();
        for (let i = 0; i < docs.length; i++) {
          options.appendChild(new Option(docs[i].number + ' — ' + (docs[i].date || 'بدون تاریخ'), String(i)));
        }
        select.appendChild(options);
        this._busy(false);
        await this.showDocument(0);
        const elapsed = Math.round(performance.now() - started);
        this._status(MONEY.format(docs.length) + ' سند، ' + MONEY.format(totalLines) +
          ' ردیف خوانده شد (' + MONEY.format(elapsed) + ' میلی‌ثانیه).');
      } catch (err) {
        this._invalidate();
        this._status('خطا: ' + (err.message || String(err)), true);
        console.error('[BinaSanadBrowser:load]', err);
      } finally {
        this._busy(false);
      }
    }

    async showDocument(index) {
      if (this.busy || !Number.isInteger(index) || index < 0 || index >= this.docs.length) return;
      const token = ++this._showRequest;
      this.busy = true;
      this._updateButtons();
      const doc = this.docs[index];
      this.current = index;
      this.ui.number.textContent = doc.number;
      this.ui.date.textContent = doc.date || '—';
      this.ui.counter.textContent = MONEY.format(index + 1) + ' از ' + MONEY.format(this.docs.length);
      this.ui.docSelect.value = String(index);
      this.ui.debit.textContent = MONEY.format(doc.debit);
      this.ui.credit.textContent = MONEY.format(doc.credit);
      const diff = doc.debit - doc.credit;
      const balanced = Math.abs(diff) < 0.000001;
      this.ui.balance.textContent = balanced ? 'سند تراز است — مانده: صفر' :
        'مانده ' + (diff > 0 ? 'بدهکار' : 'بستانکار') + ': ' + MONEY.format(Math.abs(diff));
      this.ui.balance.classList.toggle('sb-unbalanced', !balanced);
      this.ui.account.textContent = 'برای نمایش عنوان، یک ردیف سند را انتخاب کنید.';
      try {
        await this.grid.setData(doc.rows, 'SanadBrowser_' + this.loadedKey, {own:true});
      } catch (err) {
        this._status('خطای نمایش گرید: ' + err.message, true);
        console.error(err);
      } finally {
        if (token === this._showRequest) {
          this.busy = false;
          this._updateButtons();
        }
      }
    }

    _showAccount(row) {
      if (!row) return;
      const k = accountKey(row.kol_code, row.moien_code, row.tafsil_code);
      const name = this.accountTitles.get(k);
      const code = [row.kol_code,row.moien_code,row.tafsil_code].map(keyText).join(' - ');
      this.ui.account.textContent = name ? code + ' : ' + name :
        'برای حساب ' + code + ' عنوانی در Coding یافت نشد.';
    }

    destroy() {
      if (this.grid) { this.grid.destroy(); this.grid = null; }
      if (this.dbManager) { this.dbManager.closeAll(); this.dbManager = null; }
      this.docs = [];
      this.accountTitles.clear();
    }
  }

  root.BinaSanadBrowser = BinaSanadBrowser;
  // Only pure helpers are exposed for deterministic unit tests.
  BinaSanadBrowser.testUtils = Object.freeze({ascii, codeKey, accountKey, money, dateText});
})(window);
