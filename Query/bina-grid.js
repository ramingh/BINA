/* ═══════════════════════════════════════════════════════════════════════════
   BinaGrid v1.1.0 — کامپوننت حرفه‌ای، کاملاً داینامیک و مستند نمایش داده (گرید)
   ─────────────────────────────────────────────────────────────────────────
   • مستقل از کنسول — وابستگی: Tabulator 5 (الزامی) + ExcelJS (اختیاری، فقط برای exportExcel)
   • بدون دیکشنری ترجمه: عنوان هر ستون = نام فیلدِ برگشتی از کویری.
     عنوان فارسی را خودت با AS می‌سازی:  SELECT [Moien_Onvan] AS [عنوان معین] FROM ...
   • RTL پیش‌فرض، صفحه‌بندی محلی بدون هیچ سقف ردیف، فونت/شکست‌خط هوشمند سلول
   • انتخاب سلول/محدوده + کپی (Ctrl+C / Ctrl+Shift+C)، ناوبری کیبورد،
     جست‌وجوی سراسری، مدیر ستون‌ها (نمایش/فریز/رنگ)، ماندگاری تنظیمات
     به‌ازای هر «نام جدول + امضای ستون‌ها»، خروجی CSV/Excel/چاپ
   • رویدادهای عمومی + متدهای API — فهرست کامل و مثال‌ها: انتهای همین فایل
   استفادهٔ سریع:
     <link rel="stylesheet" href="tabulator.min.css">
     <script src="tabulator.min.js"></script>
     <script src="bina-grid.js"></script>
     const grid = new BinaGrid('#box', { pageSize: 500 });
     grid.setData(rows, 'QueryResult');
     grid.on('rowClick', function (e, row) { console.log(row.getData()); });
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  /* ═══════════════ ۱) فانکشن‌های کمکی (توابع آزاد، قابل استفادهٔ مستقل) ═══════════════ */
  const FONT = { default: 11, min: 8, max: 12, fitTolerance: 1, precision: 10 };
  const DEFAULT_FG = '#2d4355';
  const DEFAULT_BG = '#f7fafc';
  const EXPORT = {
    headerRow: 3,          /* ردیف هدر در فایل Excel */
    dataRow: 4,            /* شروع داده در فایل Excel */
    excelWidthFactor: 7,   /* تبدیل px به واحد عرض Excel */
    pxToPoint: 0.75,       /* تبدیل px به pt برای فونت Excel */
    csvBom: '\ufeff'       /* BOM برای سازگاری Excel با UTF-8 فارسی */
  };
  /* ═══════ ستون‌های عددی که نباید جمع فوتر بگیرند ═══════ */
  const NO_SUM_FIELDS = new Set([
    'Id', 'EsmSherkat', 'ShomarehSanad',
    'SalMali', 'KOl_Code', 'Moien_Code', 'Tafsil_Code', 'Company'
  ]);
  /** عدد را با جداکنندهٔ هزارگان انگلیسی برمی‌گرداند (خوانایی ارقام مالی) */
  function formatNumber(value) {
    if (value === null || value === undefined || value === '') return '';
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    return num.toLocaleString('en-US');
  }
  /** عدد فارسی برای UI */
  function faNum(n) { return Number(n).toLocaleString('fa-IR'); }
  /** ایمن‌سازی HTML برای نمایش متن خام */
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /** آیا مقدار شبیه عدد است؟ (برای تشخیص نوع ستون) */
  function isNumericLike(v) {
    return typeof v === 'number' ||
      (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  }
  /** آیا مقدار خالی است؟ */
  function isBlank(v) { return v === null || v === undefined || v === ''; }
  /** تشخیص خودکار نوع ستون: عددی/متنی — از روی حداکثر ۲۰۰ ردیف نمونه */
  function inferKind(field, rows) {
    const preset = (arguments[2] || null); /* پریست اختیاری از بیرون */
    if (preset) return preset;
    const sample = rows.slice(0, 200);
    let sawValue = false;
    for (let i = 0; i < sample.length; i++) {
      const v = sample[i][field];
      if (isBlank(v)) continue;
      sawValue = true;
      if (!isNumericLike(v)) return 'text';
    }
    return sawValue ? 'number' : 'text';
  }
  /** اندازه‌گیری عرض متن با فونت واقعی — برای برآورد خطوط در خروجی Excel */
  function measureTextWidth(text, fontSize) {
    if (!measureTextWidth.canvas) measureTextWidth.canvas = document.createElement('canvas');
    const ctx = measureTextWidth.canvas.getContext('2d');
    ctx.font = fontSize + 'px IRANYekanX, Tahoma, Arial, sans-serif';
    return ctx.measureText(String(text ?? '')).width;
  }
  /** برآورد تعداد خطوط یک مقدار در عرض ستون (حداکثر ۳ خط) */
  function estimateLineCount(value, style) {
    if (style.kind === 'number' || isBlank(value)) return 1;
    const usableWidth = Math.max(16, style.widthPx - 14);
    const textWidth = measureTextWidth(value, style.fontSizePx);
    return Math.max(1, Math.min(3, Math.ceil(textWidth / usableWidth)));
  }
  /** دانلود یک Blob با نام دلخواه */
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  /** نقل‌قول امن CSV */
  // function csvField(v) {
  //   if (v === null || v === undefined) return '';
  //   const s = String(v);
  //   return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  // }
  /** کپی متن در کلیپ‌بورد — با fallback برای محیط‌های بدون Clipboard API */
  function copyTextToClipboard(text) {
    return new Promise(function (resolve, reject) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); })
          .catch(function () { legacyCopy(text) ? resolve(true) : reject(new Error('کپی ممکن نشد')); });
      } else {
        legacyCopy(text) ? resolve(true) : reject(new Error('کپی ممکن نشد'));
      }
    });
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  /** رنگ hex شش‌رقمی تمیز برای Excel */
  function normalizeHex(color, fallback) {
    const value = String(color || fallback || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.slice(1).toUpperCase();
    return 'FFFFFF';
  }
  /** اجازهٔ رندر به مرورگر بین دو کار سنگین */
  function yieldToUi() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    });
  }
  /* ═══════════════ ۲) EventBus — رویدادهای عمومی کامپوننت ═══════════════ */
  class EventBus {
    constructor() { this._map = new Map(); }
    /** ثبت شنونده — خروجی: تابع لغو */
    on(name, fn) {
      if (!this._map.has(name)) this._map.set(name, new Set());
      this._map.get(name).add(fn);
      const self = this;
      return function () { self.off(name, fn); };
    }
    /** شنوندهٔ یک‌بارمصرف */
    once(name, fn) {
      const off = this.on(name, function (payload) { off(); fn(payload); });
      return off;
    }
    off(name, fn) { if (this._map.has(name)) this._map.get(name).delete(fn); }
    emit(name, payload) {
      if (!this._map.has(name)) return;
      this._map.get(name).forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[BinaGrid] event handler error:', name, e); }
      });
    }
  }
  /* ═══════════════ ۳) SmartText — فونت و شکست‌خط هوشمند سلول‌ها ═══════════════
     پورت مستقیم از ReportGrid/کنسول: فونت سلول از ۱۱px کوچک می‌شود تا متن در
     عرض ستون جا شود؛ اگر در ۸px هم جا نشد، متن متنی به ۲/۳ خط می‌شکند.
     کارها روی سلول‌های رؤیت با requestAnimationFrame دسته‌بندی می‌شود. */
  class SmartText {
    constructor(grid) {
      this.grid = grid;
      this.pending = new Set();
      this.frame = 0;
    }
    /** فرمت‌کنندهٔ سلول Tabulator — با رنگ اختصاصی ستون */
    cellFormatter(cell) {
      const column = cell.getcolumn();
      const definition = column.getDefinition();
      const state = this.grid.getcolumnState(column.getField());
      const cellElement = cell.getElement();
      cellElement.style.color = state.foreground || '';
      cellElement.style.backgroundColor = state.background || '';
      const text = document.createElement('div');
      text.className = 'smart ' + (this.grid.columnKind(definition) === 'number' ? 'num' : 'text');
      text.style.fontSize = FONT.default + 'px';
      text.dataset.fontSize = String(FONT.default);
      text.dataset.lines = '1';
      const self = this;
      requestAnimationFrame(function () { self.scheduleCell(cell); });
      const value = cell.getValue();
      text.textContent = this.grid.columnKind(definition) === 'number' ? formatNumber(value) : (value ?? '');
      return text;
    }
    scheduleCell(cell) {
      this.pending.add(cell);
      if (!this.frame) {
        const self = this;
        this.frame = requestAnimationFrame(function () { self.flush(); });
      }
    }
    schedulecolumn(column) {
      const self = this;
      column.getCells().forEach(function (c) { self.scheduleCell(c); });
    }
    scheduleVisibleRows() {
      const self = this;
      this.grid.table.getRows('visible').forEach(function (row) {
        row.getCells().forEach(function (c) { self.scheduleCell(c); });
      });
    }
    /** محاسبهٔ فونت/خطوط یک سلول — خروجی: {row, layoutChanged} */
    updateSmartCell(cell) {
      const cellElement = cell.getElement();
      if (!cellElement || !cellElement.isConnected) return { row: null, layoutChanged: false };
      const textElement = cellElement.querySelector('.smart');
      if (!textElement) return { row: null, layoutChanged: false };
      const definition = cell.getcolumn().getDefinition();
      const kind = this.grid.columnKind(definition);
      const oldFontSize = Number(textElement.dataset.fontSize || FONT.default);
      const oldLines = Number(textElement.dataset.lines || 1);
      /* فیت فونت: کوچک‌سازی تا حداقل ۸px */
      textElement.classList.remove('w2', 'w3');
      textElement.style.fontSize = FONT.default + 'px';
      const availableWidth = textElement.clientWidth;
      const requiredWidth = textElement.scrollWidth;
      let fontSize = FONT.default;
      if (availableWidth > 0 && requiredWidth > availableWidth + FONT.fitTolerance) {
        const safeAvailableWidth = Math.max(1, availableWidth - FONT.fitTolerance);
        const fittedSize = Math.floor(FONT.default * safeAvailableWidth / requiredWidth * FONT.precision) / FONT.precision;
        fontSize = Math.max(FONT.min, Math.min(FONT.default, fittedSize));
      }
      textElement.style.fontSize = fontSize + 'px';
      /* شکست‌خط فقط وقتی در ۸px هم جا نشد — فقط ستون‌های متنی */
      let lineCount = 1;
      const stillOverflows = availableWidth > 0 && textElement.scrollWidth > availableWidth + FONT.fitTolerance;
      if (kind === 'text' && fontSize <= FONT.min && stillOverflows) {
        const naturalWidth = textElement.scrollWidth;
        lineCount = naturalWidth <= availableWidth * 2 ? 2 : 3;
        textElement.classList.add(lineCount === 2 ? 'w2' : 'w3');
      }
      textElement.dataset.fontSize = String(fontSize);
      textElement.dataset.lines = String(lineCount);
      const layoutChanged = oldLines !== lineCount || (lineCount > 1 && oldFontSize !== fontSize);
      return { row: cell.getRow(), layoutChanged: layoutChanged };
    }
    /** هم‌ترازی ارتفاع سلول‌های یک ردیف با بلندترین سلول */
    normalizeRow(row) {
      try {
        const rowElement = row.getElement();
        const cells = row.getCells();
        cells.forEach(function (cell) {
          const el = cell.getElement();
          el.style.height = '';
          el.style.minHeight = '';
        });
        row.normalizeHeight();
        if (!rowElement || !rowElement.isConnected) return;
        const rowHeight = Math.ceil(rowElement.getBoundingClientRect().height);
        cells.forEach(function (cell) {
          const el = cell.getElement();
          if (!el || !el.isConnected) return;
          el.style.height = rowHeight + 'px';
          el.style.minHeight = rowHeight + 'px';
        });
      } catch (e) { /* Virtual DOM ممکن است ردیف را بین دو فریم حذف کند */ }
    }
    /** rowFormatter — حفظ پیوستگی خطوط عمودی با Virtual DOM */
    syncRowHeight(row) {
      requestAnimationFrame(function () {
        try {
          const rowElement = row.getElement();
          if (!rowElement || !rowElement.isConnected) return;
          const rowHeight = Math.ceil(rowElement.getBoundingClientRect().height);
          row.getCells().forEach(function (cell) {
            const el = cell.getElement();
            if (!el || !el.isConnected) return;
            const cellHeight = Math.ceil(el.getBoundingClientRect().height);
            if (cellHeight !== rowHeight) {
              el.style.height = rowHeight + 'px';
              el.style.minHeight = rowHeight + 'px';
            }
          });
        } catch (e) { /* row recycled */ }
      });
    }
    flush() {
      this.frame = 0;
      const rows = new Set();
      const self = this;
      this.pending.forEach(function (cell) {
        const result = self.updateSmartCell(cell);
        if (result.row && result.layoutChanged) rows.add(result.row);
      });
      this.pending.clear();
      rows.forEach(function (row) { self.normalizeRow(row); });
    }
  }
  /* ═══════════════ ۴) columnManagerPanel — پنل مدیریت ستون‌ها ═══════════════
     پنل شناور: نمایش/مخفی، فریز بازه‌ای، رنگ متن/پس‌زمینه برای هر ستون.
     باز شدن: کلیک راست روی هدر گرید، دکمهٔ «ستون‌ها»، یا متد opencolumnManager(). */
  class columnManagerPanel {
    constructor(grid) {
      this.grid = grid;
      this.dragState = { active: false, pointerId: null, offsetX: 0, offsetY: 0 };
      this._buildDom();
      this._bind();
    }
    _buildDom() {
      const root = this.grid.root;
      this.overlay = document.createElement('div');
      this.overlay.className = 'bina-cm-overlay';
      this.panel = document.createElement('div');
      this.panel.className = 'bina-cm';
      this.panel.setAttribute('aria-hidden', 'true');
      this.panel.innerHTML =
        '<header><span>مدیریت ستون‌ها</span>' +
        '<span class="bina-cm-actions">' +
        '<button type="button" class="bina-cm-reset" title="بازگشت همهٔ ستون‌ها به حالت اولیه">بازنشانی</button>' +
        '<button type="button" class="bina-cm-close" title="بستن (Esc)">✕</button>' +
        '</span></header>' +
        '<div class="bina-cm-list"></div>' +
        '<footer>نمایش · فریز (همهٔ ستون‌ها تا اینجا یخ می‌زنند) · رنگ متن · رنگ پس‌زمینه</footer>';
      root.appendChild(this.overlay);
      root.appendChild(this.panel);
      this.list = this.panel.querySelector('.bina-cm-list');
      this.header = this.panel.querySelector('header');
    }
    _bind() {
      const self = this;
      this.panel.querySelector('.bina-cm-close').addEventListener('click', function () { self.close(); });
      this.panel.querySelector('.bina-cm-reset').addEventListener('click', function () { self.reset(); });
      this.overlay.addEventListener('click', function () { self.close(); });
      this.header.addEventListener('pointerdown', function (e) { self._startDrag(e); });
      this.header.addEventListener('pointermove', function (e) { self._moveDrag(e); });
      this.header.addEventListener('pointerup', function (e) { self._stopDrag(e); });
      this.header.addEventListener('pointercancel', function (e) { self._stopDrag(e); });
    }
    isOpen() { return this.panel.classList.contains('open'); }
    open() {
      this.build();
      this.panel.classList.add('open');
      this.overlay.classList.add('open');
      this.panel.setAttribute('aria-hidden', 'false');
      this.grid.emit('columnManagerToggled', { open: true });
    }
    close() {
      this.panel.classList.remove('open');
      this.overlay.classList.remove('open');
      this.panel.setAttribute('aria-hidden', 'true');
      this.grid.emit('columnManagerToggled', { open: false });
    }
    /** ساخت ردیف‌های پنل از ستون‌های فعلی گرید */
    build() {
      const self = this;
      this.list.textContent = '';
      this.grid.getManagedcolumns().forEach(function (column) {
        const field = column.getField();
        const definition = column.getDefinition();
        const state = self.grid.getcolumnState(field);
        state.visible = column.isVisible();
        state.frozen = definition.frozen === true;
        const row = document.createElement('div');
        row.className = 'bina-cm-row';
        const name = document.createElement('span');
        name.className = 'bina-cm-name';
        name.textContent = field;
        name.title = field;
        const visible = self._checkbox(state.visible, function () {
          state.visible = visible.checked;
          if (visible.checked) column.show(); else column.hide();
        });
        const frozen = self._checkbox(state.frozen, function () {
          frozen.disabled = true;
          self.setFrozenRange(field, frozen.checked).finally(function () {
            frozen.disabled = false;
            self.build();
          });
        });
        const fg = self._color(state.foreground || DEFAULT_FG, function () {
          self.applyColor(column, 'foreground', fg.value);
        });
        const bg = self._color(state.background || DEFAULT_BG, function () {
          self.applyColor(column, 'background', bg.value);
        });
        row.append(name, visible, frozen, fg, bg);
        self.list.append(row);
      });
    }
    /** فریز بازه‌ای: همهٔ ستون‌ها تا ستون هدف (شامل خودش) یخ می‌زنند؛ unchecked = آب‌کردن */
    async setFrozenRange(targetField, checked) {
      const fields = this.grid.getManagedcolumns().map(function (c) { return c.getField(); });
      const selectedIndex = fields.indexOf(targetField);
      if (selectedIndex < 0) return;
      const frozenThrough = checked ? selectedIndex : selectedIndex - 1;
      for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        const state = this.grid.getcolumnState(field);
        state.frozen = index <= frozenThrough;
        const column = this.grid.table.getcolumn(field);
        if (!column) continue;
        const isFrozen = column.getDefinition().frozen === true;
        if (isFrozen !== state.frozen) {
          await column.updateDefinition({ frozen: state.frozen });
        }
      }
      requestAnimationFrame(() => this.grid.smart.scheduleVisibleRows());
      this.grid.stateStore.schedule();
    }
    /** اعمال فوری رنگ روی همهٔ سلول‌های یک ستون + ذخیره */
    applyColor(column, key, value) {
      const state = this.grid.getcolumnState(column.getField());
      state[key] = value;
      column.getCells().forEach(function (cell) {
        const el = cell.getElement();
        if (key === 'foreground') el.style.color = value;
        else el.style.backgroundColor = value;
      });
      this.grid.stateStore.schedule();
    }
    /** بازنشانی همهٔ ستون‌ها: نمایش همه، حذف فریز و رنگ‌ها */
    async reset() {
      const self = this;
      for (const column of this.grid.getManagedcolumns()) {
        const state = this.grid.getcolumnState(column.getField());
        state.visible = true;
        state.frozen = false;
        state.foreground = null;
        state.background = null;
        column.show();
        if (column.getDefinition().frozen) await column.updateDefinition({ frozen: false });
        column.getCells().forEach(function (cell) {
          const el = cell.getElement();
          el.style.color = '';
          el.style.backgroundColor = '';
        });
      }
      this.grid.stateStore.schedule();
      this.close();
    }
    _checkbox(checked, onChange) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.title = checked ? 'نمایش' : 'فریز/نمایش';
      input.addEventListener('change', onChange);
      return input;
    }
    _color(value, onInput) {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = value;
      input.addEventListener('input', onInput);
      return input;
    }
    _clampPosition(left, top) {
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - this.panel.offsetWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - this.panel.offsetHeight - margin);
      return {
        left: Math.min(Math.max(margin, left), maxLeft),
        top: Math.min(Math.max(margin, top), maxTop)
      };
    }
    _startDrag(event) {
      if (event.button !== 0 || !this.isOpen()) return;
      const rect = this.panel.getBoundingClientRect();
      this.dragState.active = true;
      this.dragState.pointerId = event.pointerId;
      this.dragState.offsetX = event.clientX - rect.left;
      this.dragState.offsetY = event.clientY - rect.top;
      this.panel.style.left = rect.left + 'px';
      this.panel.style.top = rect.top + 'px';
      this.panel.style.transform = 'none';
      this.panel.classList.add('dragging');
      this.header.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    _moveDrag(event) {
      if (!this.dragState.active || event.pointerId !== this.dragState.pointerId) return;
      const pos = this._clampPosition(
        event.clientX - this.dragState.offsetX,
        event.clientY - this.dragState.offsetY
      );
      this.panel.style.left = pos.left + 'px';
      this.panel.style.top = pos.top + 'px';
    }
    _stopDrag(event) {
      if (!this.dragState.active || event.pointerId !== this.dragState.pointerId) return;
      this.dragState.active = false;
      this.dragState.pointerId = null;
      this.panel.classList.remove('dragging');
      if (this.header.hasPointerCapture(event.pointerId)) {
        this.header.releasePointerCapture(event.pointerId);
      }
    }
  }
  /* ═══════════════ ۵) GridStateStore — ماندگاری تنظیمات گرید ═══════════════
     کلید localStorage = prefix + نام جدول + امضای ستون‌ها — یعنی هر نما
     (جدول کامل یا نتیجهٔ یک کویری) تنظیمات مستقل خودش را دارد.
     ذخیره: چیدمان/عرض/ترتیب/نمایش ستون‌ها، فریز، رنگ‌ها، فیلترهای هدر، مرتب‌سازی
     و فیلترهای برنامه‌ایِ سریال‌پذیر. جست‌وجوی سراسری عمداً ماندگار نیست. */
  class GridStateStore {
    constructor(grid) {
      this.grid = grid;
      this.timer = 0;
    }
    key() {
      return this.grid.options.storagePrefix + '.' +
        (this.grid.tableName || 'default') + '.' +
        (this.grid.fieldSignature || 'none') + '.v1';
    }
    read() {
      try {
        const raw = localStorage.getItem(this.key());
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && parsed.version === 1) ? parsed : null;
      } catch (e) {
        console.warn('[BinaGrid] settings read failed', e);
        return null;
      }
    }
    /** فقط فیلترهای سریال‌پذیر (توابع ذخیره نمی‌شوند) */
    serializableFilters() {
      try {
        return this.grid.table.getFilters()
          .filter(function (f) { return typeof f.type !== 'function'; })
          .map(function (f) { return { field: f.field, type: f.type, value: f.value }; });
      } catch (e) { return []; }
    }
    /** حذف title از چیدمان — عنوان همیشه از نام فیلد می‌آید (تک‌منبع حقیقت) */
    sanitizeLayout(layout) {
      if (!Array.isArray(layout)) return [];
      return layout.map(function (item) {
        const clean = Object.assign({}, item);
        delete clean.title;
        if (Array.isArray(clean.columns)) clean.columns = this.sanitizeLayout(clean.columns);
        return clean;
      }, this);
    }
    /** آیا فیلدهای ذخیره‌شده با گرید فعلی یکی است؟ (شرط restore) */
    layoutMatches(saved) {
      if (!saved || !Array.isArray(saved.columnLayout)) return false;
      const savedFields = saved.columnLayout.map(function (c) { return c && c.field; }).filter(Boolean).sort();
      const currentFields = this.grid.getManagedcolumns().map(function (c) { return c.getField(); }).sort();
      if (currentFields.length !== savedFields.length) return false;
      for (let i = 0; i < currentFields.length; i++) {
        if (currentFields[i] !== savedFields[i]) return false;
      }
      return true;
    }
    collect() {
      const grid = this.grid;
      const customcolumns = {};
      grid.getManagedcolumns().forEach(function (column) {
        const field = column.getField();
        const state = grid.getcolumnState(field);
        customcolumns[field] = {
          foreground: state.foreground,
          background: state.background,
          baseWidth: state.baseWidth,
          frozen: column.getDefinition().frozen === true
        };
      });
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        columnLayout: this.sanitizeLayout(grid.table.getcolumnLayout()),
        customcolumns: customcolumns,
        headerFilters: grid.table.getHeaderFilters().map(function (f) {
          return { field: f.field, value: f.value };
        }),
        sorters: grid.table.getSorters().map(function (s) {
          return { column: s.field, dir: s.dir };
        }),
        filters: this.serializableFilters()
      };
    }
    saveNow() {
      if (this.grid.restoring || !this.grid.table) return;
      try {
        localStorage.setItem(this.key(), JSON.stringify(this.collect()));
      } catch (e) {
        console.warn('[BinaGrid] settings save failed', e);
      }
    }
    /** ذخیرهٔ debounce شده (۲۵۰ms) با قفل اسنپ‌شات — نماها را آلوده نمی‌کند */
    schedule() {
      if (this.grid.restoring || !this.grid.table) return;
      clearTimeout(this.timer);
      const key = this.key();
      const payload = this.collect();
      this.timer = setTimeout(function () {
        try { localStorage.setItem(key, JSON.stringify(payload)); }
        catch (e) { console.warn('[BinaGrid] settings save failed', e); }
      }, 250);
    }
    /** بازگردانی کامل تنظیمات همین نما (فقط وقتی ساختار ستون‌ها بخورد) */
    async restore() {
      const grid = this.grid;
      const saved = this.read();
      if (!saved) return;
      grid.restoring = true;
      try {
        /* ۱) رنگ‌ها و baseWidth */
        const savedcolumns = saved.customcolumns || {};
        Object.keys(savedcolumns).forEach(function (field) {
          if (!grid.table.getcolumn(field)) return;
          const value = savedcolumns[field];
          const state = grid.getcolumnState(field);
          state.foreground = value?.foreground ?? null;
          state.background = value?.background ?? null;
          state.baseWidth = Number(value?.baseWidth) || 0;
          state.frozen = value?.frozen === true;
        });
        /* ۲) چیدمان (عرض/ترتیب/نمایش) — فقط اگر مجموعهٔ فیلدها بخورد */
        const matching = this.layoutMatches(saved);
        if (matching && saved.columnLayout.length) {
          grid.table.setcolumnLayout(this.sanitizeLayout(saved.columnLayout));
          /* بعد از restore از layout، فرمت‌کنندهٔ جمع فوتر دوباره وصل می‌شود */
          grid.getManagedcolumns().forEach(function (column) {
            if (column.getDefinition().bottomCalc) {
              column.updateDefinition({
                bottomCalcFormatter: function (cell) { return formatNumber(cell.getValue()); }
              });
            }
          });
        }
        /* ۳) فریز */
        await this._restoreFrozen(saved);
        /* ۴) رنگ‌ها روی سلول‌های موجود */
        grid.getManagedcolumns().forEach(function (column) {
          const state = grid.getcolumnState(column.getField());
          if (!state.foreground && !state.background) return;
          column.getCells().forEach(function (cell) {
            const el = cell.getElement();
            el.style.color = state.foreground || '';
            el.style.backgroundColor = state.background || '';
          });
        });
        /* ۵) فیلترهای برنامه‌ای سریال‌پذیر + فیلترهای هدر + مرتب‌سازی */
        if (matching && Array.isArray(saved.filters) && saved.filters.length) {
          grid._customFilters = saved.filters.slice();
          grid._applyDataFilters();
        }
        if (matching && Array.isArray(saved.headerFilters)) {
          saved.headerFilters.forEach(function (f) {
            if (!f?.field) return;
            grid.table.setHeaderFilterValue(f.field, f.value ?? '');
          });
        }
        if (matching && Array.isArray(saved.sorters) && saved.sorters.length) {
          grid.table.setSort(saved.sorters);
        }
      } catch (e) {
        console.warn('[BinaGrid] settings restore failed', e);
      } finally {
        grid.restoring = false;
      }
    }
    async _restoreFrozen(saved) {
      const grid = this.grid;
      const savedcolumns = saved.customcolumns || {};
      const ordered = grid.getManagedcolumns();
      let lastFrozenField = null;
      ordered.forEach(function (column) {
        if (savedcolumns[column.getField()]?.frozen === true) lastFrozenField = column.getField();
      });
      if (lastFrozenField) {
        await grid.columnManager.setFrozenRange(lastFrozenField, true);
        return;
      }
      const firstField = ordered[0]?.getField();
      if (firstField) await grid.columnManager.setFrozenRange(firstField, false);
    }
  }
  /* ═══════════════ ۶) GridSelection — انتخاب سلول/محدوده/ردیف + کپی ═══════════════
     • کلیک ساده = سلول فعال      • Shift+کلیک = محدودهٔ مستطیلی (همان صفحه)
     • Ctrl+کلیک = انتخاب کل ردیف • Esc = پاک کردن
     • Ctrl+C = کپی TSV بدون هدر   • Ctrl+Shift+C = کپی با ردیف هدر
     انتخاب‌ها به‌صورت rowKey('__id') + نام فیلد نگهداری می‌شوند و بعد از هر
     رندر دوباره رنگ می‌گیرند (سازگار با Virtual DOM و صفحه‌بندی). */
  class GridSelection {
    constructor(grid) {
      this.grid = grid;
      this._painted = [];
      this.clear();
    }
    clear() {
      this.cells = new Map();  /* rowKey → Set(field) */
      this.rows = new Set();   /* rowKey → ردیف کامل */
      this.active = null;      /* {row, field} */
      this.anchor = null;      /* {rowKey, field} */
      this.paint();
      this.grid._emitSelectionChanged();
    }
    rowKey(row) { return String(row.getIndex()); }
    setActive(cell) {
      const row = cell.getRow();
      const field = cell.getField();
      this.active = { row: row, field: field };
      this.anchor = { rowKey: this.rowKey(row), field: field };
      const key = this.rowKey(row);
      this.cells.set(key, new Set([field]));
      this.paint();
      this.grid._emitSelectionChanged();
    }
    /** محدودهٔ مستطیلی از anchor تا سلول فعلی — فقط روی همان صفحه */
    extendTo(cell) {
      const row = cell.getRow();
      const field = cell.getField();
      const visibleRows = this.grid.table.getRows('visible');
      const fields = this.grid.getVisibleFields();
      const anchorIdx = visibleRows.findIndex(r => r === this._anchorRow());
      const targetIdx = visibleRows.findIndex(r => r === row);
      const anchorCol = fields.indexOf(this.anchor.field);
      const targetCol = fields.indexOf(field);
      if (anchorIdx < 0 || targetIdx < 0 || anchorCol < 0 || targetCol < 0) {
        this.setActive(cell);
        return;
      }
      this.cells = new Map();
      const r1 = Math.min(anchorIdx, targetIdx), r2 = Math.max(anchorIdx, targetIdx);
      const c1 = Math.min(anchorCol, targetCol), c2 = Math.max(anchorCol, targetCol);
      for (let ri = r1; ri <= r2; ri++) {
        const key = this.rowKey(visibleRows[ri]);
        const set = new Set();
        for (let ci = c1; ci <= c2; ci++) set.add(fields[ci]);
        this.cells.set(key, set);
      }
      this.active = { row: row, field: field };
      this.paint();
      this.grid._emitSelectionChanged();
    }
    _anchorRow() {
      if (!this.anchor) return null;
      return this.grid.table.getRows('visible').find(
        r => this.rowKey(r) === this.anchor.rowKey) || null;
    }
    toggleRow(row) {
      const key = this.rowKey(row);
      if (this.rows.has(key)) { this.rows.delete(key); this.cells.delete(key); }
      else { this.rows.add(key); this.cells.delete(key); }
      this.paint();
      this.grid._emitSelectionChanged();
    }
    /** انتخاب همهٔ ردیف‌های صفحهٔ فعلی */
    selectAllPage() {
      const self = this;
      this.rows = new Set();
      this.cells = new Map();
      this.grid.table.getRows('visible').forEach(function (row) {
        self.rows.add(self.rowKey(row));
      });
      this.paint();
      this.grid._emitSelectionChanged();
    }
    /** رنگ‌آمیزی دوباره — بعد از هر رندر/صفحه/فیلتر صدا زده می‌شود */
    paint() {
      this._painted.forEach(function (el) { el.classList.remove('bina-sel', 'bina-active'); });
      if (this._paintedRows) {
        this._paintedRows.forEach(function (el) { el.classList.remove('bina-row-sel'); });
      }
      this._painted = [];
      this._paintedRows = [];
      if (!this.grid.table) return;
      const self = this;
      const fields = this.grid.getVisibleFields();
      this.grid.table.getRows('visible').forEach(function (row) {
        const el = row.getElement();
        if (!el || !el.isConnected) return;
        const key = self.rowKey(row);
        if (self.rows.has(key)) {
          el.classList.add('bina-row-sel');
          self._paintedRows.push(el);
          return;
        }
        const set = self.cells.get(key);
        if (!set) return;
        row.getCells().forEach(function (cell) {
          const f = cell.getField();
          if (!set.has(f)) return;
          const cel = cell.getElement();
          if (!cel || !cel.isConnected) return;
          cel.classList.add('bina-sel');
          self._painted.push(cel);
          if (self.active && self.active.row === row && self.active.field === f) {
            cel.classList.add('bina-active');
          }
        });
      });
    }
    /** ساخت TSV از انتخاب فعلی — header=true ردیف عنوان هم اضافه می‌کند */
    buildTsv(withHeader) {
      const grid = this.grid;
      const fields = grid.getVisibleFields();
      const activeRows = grid.table.getRows('active');
      const lines = [];
      if (withHeader) lines.push(fields.join('\t'));
      activeRows.forEach(row => {
        const key = this.rowKey(row);
        const data = row.getData();
        if (this.rows.has(key)) {
          lines.push(fields.map(f => data[f] ?? '').join('\t'));
        } else if (this.cells.has(key)) {
          const set = this.cells.get(key);
          const picked = fields.filter(f => set.has(f));
          lines.push(picked.map(f => data[f] ?? '').join('\t'));
        }
      });
      return lines.join('\r\n');
    }
    /** کپی انتخاب — خروجی: {cells, rows} یا null اگر چیزی انتخاب نشده */
    copy(withHeader) {
      const hasAny = this.cells.size > 0 || this.rows.size > 0;
      if (!hasAny) return null;
      let tsv, cellCount;
      if (!this.cells.size && !this.rows.size) return null;
      if (this.cells.size === 1 && this.rows.size === 0 && !withHeader) {
        /* تک‌سلول: فقط مقدار خام */
        const entry = this.cells.entries().next().value;
        const set = entry[1];
        const rowKey = entry[0];
        const data = this._rowDataByKey(rowKey);
        if (!data) return null;
        tsv = [...set].map(f => data[f] ?? '').join('');
        cellCount = 1;
      } else {
        tsv = this.buildTsv(withHeader);
        cellCount = this._countSelectedCells();
      }
      return { text: tsv, cells: cellCount, rows: this.cells.size + this.rows.size };
    }
    _rowDataByKey(rowKey) {
      const row = this.grid.table.getRows('active').find(r => this.rowKey(r) === rowKey);
      return row ? row.getData() : null;
    }
    _countSelectedCells() {
      let n = 0;
      this.cells.forEach(function (set) { n += set.size; });
      this.rows.forEach(key => {
        const data = this._rowDataByKey(key);
        if (data) n += this.grid.getVisibleFields().length;
      }, this);
      return n;
    }
    /** دادهٔ ردیف‌های انتخاب‌شده */
    getSelectedData() {
      const self = this;
      const out = [];
      this.grid.table.getRows('active').forEach(function (row) {
        const key = self.rowKey(row);
        if (self.rows.has(key) || self.cells.has(key)) out.push(row.getData());
      });
      return out;
    }
  }
  /* ═══════════════ ۷) BinaGrid — کامپوننت اصلی ═══════════════ */
  /* عرض/نوع پیش‌فرض فیلدهای شناخته‌شدهٔ بینا — قابل بازنویسی با options.presetcolumns */
  const PRESET_COLUMNS = {
    EsmSherkat: { width: 120, minWidth: 80, kind: 'number' },
    SalMali: { width: 110, minWidth: 75, kind: 'number' },
    ShomarehSanad: { width: 140, minWidth: 90, kind: 'number' },
    Tarikh: { width: 130, minWidth: 90, kind: 'text' },
    KOl_Code: { width: 110, minWidth: 75, kind: 'number' },
    KOl_Onvan: { width: 240, minWidth: 110, kind: 'text' },
    Moien_Code: { width: 120, minWidth: 80, kind: 'number' },
    Moien_Onvan: { width: 300, minWidth: 120, kind: 'text' },
    Tafsil_Code: { width: 130, minWidth: 85, kind: 'number' },
    Tafsil_Onvan: { width: 300, minWidth: 120, kind: 'text' },
    SharhSanad: { width: 340, minWidth: 130, kind: 'text' },
    Bedehkar: { width: 160, minWidth: 100, kind: 'number' },
    Bestankar: { width: 160, minWidth: 100, kind: 'number' },
    Company: { width: 120, minWidth: 80, kind: 'number' },
    Id: { width: 100, minWidth: 75, kind: 'number' },
    Tedad: { width: 110, minWidth: 75, kind: 'number' }
  };
  const BINA_CSS = `
  .bina-grid{position:relative;display:flex;flex-direction:column;gap:8px;outline:none;
    font-family:IRANYekanX,Tahoma,Arial,sans-serif;*{box-sizing:border-box}}
  .bina-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .bina-search{flex:0 1 260px;min-width:170px;padding:7px 12px;border:1px solid #b9c8d4;border-radius:9px;
    font:inherit;font-size:12.5px;background:#fff;color:#20374b}
  .bina-search:focus{outline:2px solid #0e8f6f33;border-color:#0e8f6f}
  .bina-btn{padding:7px 12px;border:1px solid #b9c8d4;border-radius:9px;background:#fff;color:#20374b;
    font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
  .bina-btn:hover{background:#eef4f8;border-color:#8fa8ba}
  .bina-btn:disabled{opacity:.5;cursor:default}
  .bina-count{font-size:12.5px;color:#41586c;background:#eef4f8;border-radius:99px;padding:5px 12px;white-space:nowrap}
  .bina-spacer{flex:1}
  .bina-wrap{position:relative;height:560px}
  .bina-table{height:100%}
  .bina-empty{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;
    background:#f7fafc;color:#7b8b99;font-size:14px;z-index:5;border:1px dashed #c3d0da;border-radius:12px;text-align:center;padding:20px}
  .bina-empty b{color:#41586c;font-size:15px}
  .bina-toast{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:#12395e;color:#fff;
    padding:8px 16px;border-radius:99px;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:9500}
  .bina-toast.show{opacity:.95}
  /* سلول هوشمند */
  .bina-grid .tabulator-cell{white-space:normal}
  .bina-grid .smart{line-height:1.55;overflow:hidden;white-space:nowrap;text-align:inherit}
  .bina-grid .smart.num{font-variant-numeric:tabular-nums}
  .bina-grid .smart.w2,.bina-grid .smart.w3{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical}
  .bina-grid .smart.w2{-webkit-line-clamp:2}
  .bina-grid .smart.w3{-webkit-line-clamp:3}
  /* انتخاب */
  .bina-grid .tabulator-cell.bina-sel{background:rgba(14,143,111,.16)!important}
  .bina-grid .tabulator-cell.bina-active{box-shadow:inset 0 0 0 2px #0e8f6f;position:relative;z-index:2}
  .bina-grid .tabulator-row.bina-row-sel .tabulator-cell{background:rgba(18,57,94,.10)!important}
  /* مدیر ستون‌ها */
  .bina-cm{position:fixed;top:80px;left:80px;z-index:9300;width:360px;background:#fff;border:1px solid #b9c8d4;
    border-radius:12px;box-shadow:0 18px 50px rgba(15,34,51,.28);display:none;direction:rtl;overflow:hidden}
  .bina-cm.open{display:block}
  .bina-cm header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;
    background:#12395e;color:#fff;font-weight:600;font-size:13.5px;cursor:grab;user-select:none}
  .bina-cm.dragging header{cursor:grabbing}
  .bina-cm-actions{display:flex;gap:6px;align-items:center}
  .bina-cm-actions button{border:none;border-radius:7px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
  .bina-cm-reset{background:#1d5a86;color:#fff}
  .bina-cm-reset:hover{background:#276da3}
  .bina-cm-close{background:rgba(255,255,255,.15);color:#fff}
  .bina-cm-list{max-height:46vh;overflow:auto;padding:6px 12px}
  .bina-cm-row{display:grid;grid-template-columns:1fr auto auto auto auto;gap:7px;align-items:center;
    padding:6px 2px;border-bottom:1px dashed #e3ebf1}
  .bina-cm-row:last-child{border-bottom:none}
  .bina-cm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#20374b;direction:ltr;text-align:right}
  .bina-cm-row input[type=color]{width:26px;height:22px;padding:0;border:1px solid #b9c8d4;border-radius:6px;background:none;cursor:pointer}
  .bina-cm footer{padding:8px 12px;font-size:11px;color:#6b7c8a;border-top:1px solid #e3ebf1;background:#f7fafc}
  .bina-cm-overlay{position:fixed;inset:0;z-index:9200;display:none;background:rgba(15,34,51,.14)}
  .bina-cm-overlay.open{display:block}
  `;
  let cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.textContent = BINA_CSS;
    document.head.appendChild(style);
    cssInjected = true;
  }
  class BinaGrid {
    /**
     * @param {string|HTMLElement} container — جای قرارگیری کامپوننت
     * @param {object} [options] — pageSize, pageSizeOptions, rtl, height, storagePrefix,
     *                             presetcolumns, locale, movablecolumns, resizablecolumns
     */
    constructor(container, options = {}) {
      if (typeof Tabulator === 'undefined') {
        throw new Error('Tabulator بارگذاری نشده — اول tabulator.min.css و tabulator.min.js را ضمیمه کن.');
      }
      injectCss();
      const hostEl = typeof container === 'string' ? document.querySelector(container) : container;
      if (!hostEl) throw new Error('کانتینر گرید پیدا نشد: ' + container);
      this.options = Object.assign({
        pageSize: 500,
        pageSizeOptions: [100, 500, 1000, 5000, true],
        rtl: true,
        height: '560px',
        storagePrefix: 'BinaGrid',
        locale: 'fa-fa',
        presetcolumns: PRESET_COLUMNS,
        movablecolumns: true,
        resizablecolumns: true,
        showToolbar: true
      }, options);
      this.events = new EventBus();
      this.tableName = '';
      this.fieldSignature = '';
      this.columnState = new Map();
      this.fieldKinds = new Map();
      this.restoring = false;
      this._customFilters = [];
      this._searchText = '';
      this._searchTimer = 0;
      this._pageSizeRestored = false;
      this._destroyed = false;
      /* ── DOM ── */
      this.root = document.createElement('div');
      this.root.className = 'bina-grid';
      this.root.dir = this.options.rtl ? 'rtl' : 'ltr';
      this.root.tabIndex = 0; /* برای دریافت کلیدهای ناوبری */
      this._buildToolbar();
      this._buildWrap();
      hostEl.appendChild(this.root);
      /* ── زیرسیستم‌ها ── */
      this.smart = new SmartText(this);
      this.stateStore = new GridStateStore(this);
      this.selection = new GridSelection(this);
      this.columnManager = new columnManagerPanel(this);
      this._initTable();
      this._wireEvents();
      this._toggleEmpty();
    }
    /* ─────────── ساخت DOM داخلی ─────────── */
    _buildToolbar() {
      this.toolbar = document.createElement('div');
      this.toolbar.className = 'bina-toolbar';
      this.toolbar.innerHTML =
        '<input type="search" class="bina-search" placeholder="🔍 جست‌وجو در همهٔ ستون‌ها (Ctrl+F)…">' +
        '<button type="button" class="bina-btn bina-clear" title="حذف همهٔ فیلترها و جست‌وجو">✕ پاک‌کردن فیلترها</button>' +
        '<span class="bina-count">تعداد: ۰</span>' +
        '<span class="bina-spacer"></span>' +
        '<button type="button" class="bina-btn" data-act="copyall" title="کپی همهٔ نتایج فیلترشده با هدر (TSV)">کپی همه</button>' +
        '<button type="button" class="bina-btn" data-act="excel" title="خروجی Excel (نیازمند ExcelJS)">Excel</button>' +
        '<button type="button" class="bina-btn" data-act="print" title="چاپ وضعیت فعلی">🖨 چاپ</button>' +
        '<button type="button" class="bina-btn" data-act="columns" title="مدیریت ستون‌ها (کلیک راست روی هدر)">⚙ ستون‌ها</button>';
      this.searchInput = this.toolbar.querySelector('.bina-search');
      this.countEl = this.toolbar.querySelector('.bina-count');
      if (!this.options.showToolbar) this.toolbar.style.display = 'none';
      this.root.appendChild(this.toolbar);
    }
    _buildWrap() {
      const wrap = document.createElement('div');
      wrap.className = 'bina-wrap';
      wrap.style.height = this.options.height;
      this.tableEl = document.createElement('div');
      this.tableEl.className = 'bina-table';
      this.emptyEl = document.createElement('div');
      this.emptyEl.className = 'bina-empty';
      this.emptyEl.style.display = 'none';
      this.emptyEl.innerHTML = '<b>داده‌ای برای نمایش نیست</b><span>کویری بزن یا با setData داده بده</span>';
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'bina-toast';
      wrap.append(this.tableEl, this.emptyEl, this.toastEl);
      this.root.appendChild(wrap);
    }
    /* ─────────── ساخت Tabulator ─────────── */
    _initTable() {
      this.table = new Tabulator(this.tableEl, {
        data: [],
        columns: [],
        index: '__id',
        layout: 'fitData',
        height: '100%',
        movablecolumns: this.options.movablecolumns,
        resizablecolumns: this.options.resizablecolumns,
        renderVertical: 'virtual',
        pagination: 'local',
        paginationSize: this.options.pageSize,
        paginationSizeSelector: this.options.pageSizeOptions,
        paginationInitialPage: 1,
        paginationCounter: 'rows',
        columnCalcs: 'both',
        locale: this.options.locale,
        langs: {
          'fa-fa': {
            pagination: {
              page_size: 'اندازهٔ صفحه:',
              first: 'اول', first_title: 'صفحهٔ اول',
              prev: 'قبلی', prev_title: 'صفحهٔ قبل',
              next: 'بعدی', next_title: 'صفحهٔ بعد',
              last: 'آخر', last_title: 'صفحهٔ آخر',
              all: 'همه',
              counter: { showing: 'نمایش', of: 'از', rows: 'ردیف', pages: 'صفحه' }
            },
            data: { loading: 'در حال بارگذاری…', error: 'خطا' },
            headerFilters: { default: 'فیلتر…' }
          }
        },
        rowFormatter: (row) => this.smart.syncRowHeight(row),
        columnDefaults: {
          vertAlign: 'middle',
          tooltip: true,
          formatter: (cell) => this.smart.cellFormatter(cell)
        }
      });
    }
    _wireEvents() {
      const table = this.table;
      const self = this;
      /* منوی راست‌کلیک هدر → مدیر ستون‌ها (delegation — بعد از setcolumns هم پابرجاست) */
      this.tableEl.addEventListener('contextmenu', function (event) {
        if (event.target.closest && event.target.closest('.tabulator-header')) {
          event.preventDefault();
          self.columnManager.open();
        }
      });
      table.on('tableBuilt', function () {
        self._built = true;
        self.emit('tableBuilt');
      });
      /* ── انتخاب و کلیک ── */
      table.on('cellClick', function (e, cell) {
        if (e.shiftKey && self.selection.anchor) self.selection.extendTo(cell);
        else if (e.ctrlKey || e.metaKey) {
          self.selection.toggleRow(cell.getRow());
          self.selection.active = { row: cell.getRow(), field: cell.getField() };
          self.selection.paint();
        } else self.selection.setActive(cell);
        self.root.focus({ preventScroll: true });
        self.emit('cellClick', { event: e, field: cell.getField(), data: cell.getData() });
      });
      table.on('cellDblClick', function (e, cell) {
        self.emit('cellDblClick', { event: e, field: cell.getField(), data: cell.getData() });
      });
      table.on('rowClick', function (e, row) {
        self.emit('rowClick', { event: e, data: row.getData() });
      });
      table.on('rowDblClick', function (e, row) {
        self.emit('rowDblClick', { event: e, data: row.getData() });
      });
      /* ── فیلتر / مرتب / صفحه ── */
      table.on('dataFiltered', function (filters, filteredRows) {
        /* با صفحه‌بندی activeRows در لحظهٔ رویداد عقب است؛ تعداد واقعی از آرگومان دوم */
        self._updateCount(filteredRows ? filteredRows.length : undefined);
        self.emit('filterChanged', { count: filteredRows ? filteredRows.length : 0 });
      });
      table.on('dataSorted', function () {
        self.stateStore.schedule();
        self.emit('sortChanged', self.getSorters());
      });
      table.on('pageLoaded', function (page) {
        self.selection.paint();
        self.emit('pageChanged', { page: page, pageSize: table.getPageSize() });
      });
      table.on('pageSizeChanged', function (size) {
        /* فقط تغییر واقعی کاربر ذخیره شود — سازنده هم این رویداد را می‌پاشد */
        if (typeof size === 'number' && size >= 100 && table.getDataCount() > 0) {
          try { localStorage.setItem(self.options.storagePrefix + '.pageSize', String(size)); } catch (e) { /* noop */ }
        }
        /* قبل از tableBuilt این رویداد هم پاش می‌شود — getPage هنوز معتبر نیست */
        if (self._built) {
          self.emit('pageChanged', { page: table.getPage(), pageSize: size });
        }
      });
      /* ── ستون‌ها ── */
      table.on('columnResizing', function (column) {
        const field = column.getField();
        if (!field) return;
        self.smart.schedulecolumn(column);
      });
      table.on('columnWidth', function (column) {
        self.smart.schedulecolumn(column);
      });
      table.on('columnResized', function (column) {
        self.smart.schedulecolumn(column);
        const field = column.getField();
        if (field) {
          const state = self.getcolumnState(field);
          if (!state.baseWidth) state.baseWidth = Number(column.getDefinition().width) || column.getWidth() || 100;
        }
        self.stateStore.schedule();
        self.emit('columnResized', { field: column.getField(), width: column.getWidth() });
      });
      table.on('columnMoved', function () {
        self.smart.scheduleVisibleRows();
        self.stateStore.schedule();
        self.emit('columnMoved', self.getcolumnOrder());
      });
      table.on('columnVisibilityChanged', function () {
        self.smart.scheduleVisibleRows();
        self.stateStore.schedule();
        self.emit('columnVisibilityChanged', self.getcolumnOrder());
      });
      /* ── رندر دوباره → رنگ انتخاب‌ها بازآیی شود ── */
      table.on('renderComplete', function () { self.selection.paint(); });
      /* ── کیبورد ── */
      this.root.addEventListener('keydown', function (e) { self._onKeydown(e); });
      this._docKeydown = function (e) {
        if (e.key === 'Escape' && self.columnManager.isOpen()) self.columnManager.close();
      };
      document.addEventListener('keydown', this._docKeydown);
    }
    /* ─────────── داده ─────────── */
    /**
     * نمایش آرایهٔ ردیف‌ها در گرید — ستون‌ها به‌صورت داینامیک از کلیدهای ردیف اول
     * ساخته می‌شوند و تنظیمات ذخیره‌شدهٔ همین «جدول + امضای ستون‌ها» بازیابی می‌شود.
     * @param {object[]} rows — آرایهٔ آبجکت‌ها (خروجی کویری SQL)
     * @param {string} [tableName] — نام نما؛ کلید تنظیمات و نام فایل خروجی‌ها
     * @param {object} [opts] — { own: true } = «این ردیف‌ها مال گرید است» → بدون کپی (فقط __id روی همان
     *        آبجکت‌ها ثبت می‌شود). پیش‌فرض (بدون opts) مثل v1.0: ورودی دست‌نخورده می‌ماند و هر ردیف کپی می‌شود.
     */


    async setData(rows, tableName, opts) {
      if (!Array.isArray(rows)) throw new Error('setData: آرایه‌ای از آبجکت بده.');
      if (rows.length && typeof rows[0] !== 'object') {
        throw new Error('setData: هر ردیف باید آبجکت باشد (خروجی کویری SQL).');
      }

      this.tableName = tableName || this.tableName || 'QueryResult';
      const first = rows[0] || {};
      const fields = Object.keys(first).filter(function (f) { return f !== '__id'; });
      this.fieldSignature = fields.slice().sort().join('|');
      /* state تازه برای ساختار جدید (رنگ‌ها بعداً از تنظیمات ذخیره‌شده برمی‌گردند) */
      this.columnState.clear();
      this.selection.clear();
      /* بازیابی یک‌بارهٔ اندازهٔ صفحهٔ ذخیره‌شده — لحظهٔ اولین نمایش داده */
      if (!this._pageSizeRestored) {
        this._pageSizeRestored = true;
        try {
          const saved = Number(localStorage.getItem(this.options.storagePrefix + '.pageSize'));
          if (saved >= 100 && saved !== this.table.getPageSize()) this.table.setPageSize(saved);
        } catch (e) { /* noop */ }
      }
      this.restoring = true;
      try {
        const defs = fields.map(f => this._makecolumnDef(f, rows));
        this.table.setcolumns(defs);
        /* setcolumnLayout بعداً با options.columns ادغام می‌شود — همیشه همگام نگه دار */
        this.table.options.columns = defs;
      } finally {
        this.restoring = false;
      }
      await this.stateStore.restore();
      const withIds = this._withIds(rows, opts);
      await this.table.replaceData(withIds);
      try { this.table.setPage(1); } catch (e) { /* noop */ }
      this._updateCount();
      this.smart.scheduleVisibleRows();
      this.stateStore.schedule();
      this._toggleEmpty();
      this.emit('dataLoaded', { tableName: this.tableName, rows: rows.length });
    }

    /**
     * آمادهٔ‌سازی ردیف‌ها برای Tabulator (کلید ردیف = __id، انتخاب سلول/ردیف به آن وابسته است).
     * پیش‌فرض (v1.0): هر ردیف کپی می‌شود → ورودی هیچ‌وقت تغییر نمی‌کند.
     * opts.own === true: بدون کپی؛ __id (قابل‌شمارش، چون Tabulator.getIndex با deepClone فقط
     * ویژگی‌های قابل‌شمارش را می‌بیند) روی همان آبجکت‌ها نوشته می‌شود. فقط برای آرایه‌هایی که مال
     * کسی دیگر نیستند (مثل خروجی تازهٔ یک کویری). اگر امن نبود، خودکار مثل v1.0 کپی می‌شود:
     * ردیف null/غیرآبجکت/frozen، یا __id قبلی که با جای این ردیف نمی‌خواند (آبجکت مشترک با گرید دیگر).
     */
    _withIds(rows, opts) {
      const copyAll = function () {
        return rows.map(function (r, i) {
          const copy = Object.assign({}, r);
          copy.__id = i + 1;
          return copy;
        });
      };
      if (!opts || opts.own !== true) return copyAll();
      const has = Object.prototype.hasOwnProperty;
      for (let i = 0; i < rows.length; i++) {            /* پاس ۱: فقط بررسی */
        const r = rows[i];
        if (r === null || typeof r !== 'object' || !Object.isExtensible(r)) return copyAll();
        if (has.call(r, '__id') && r.__id !== i + 1) return copyAll();
      }
      for (let i = 0; i < rows.length; i++) rows[i].__id = i + 1;   /* پاس ۲: ثبت */
      return rows;
    }

    /** پاک کردن کامل گرید */
    async clearData() {
      this.tableName = '';
      this.fieldSignature = '';
      this.columnState.clear();
      this.selection.clear();
      this.restoring = true;
      try {
        this.table.setcolumns([]);
        this.table.options.columns = [];
        await this.table.replaceData([]);
      } finally {
        this.restoring = false;
      }
      this._updateCount(0);
      this._toggleEmpty();
      this.emit('dataLoaded', { tableName: '', rows: 0 });
    }
    /** همهٔ داده‌ها (بدون فیلتر) */
    getData() { return this.table.getData(); }
    /** داده‌های فیلترشدهٔ فعلی (همهٔ صفحات) */
    getFilteredData() { return this.table.getData('active'); }
    /** همان getFilteredData — نام قدیمی سازگار */
    getActiveData() { return this.table.getData('active'); }
    /** تعداد ردیف‌های فعلی (فیلترشده) */
    getRecordCount() { return this.table.getRows('active').length; }
    _updateCount(count) {
      if (typeof count !== 'number') count = this.table ? this.table.getRows('active').length : 0;
      this.countEl.textContent = 'تعداد: ' + faNum(count);
    }
    _toggleEmpty() {
      const empty = !this.table || this.table.getDataCount() === 0;
      this.emptyEl.style.display = empty ? 'flex' : 'none';
    }
    /* ─────────── ستون‌ها ─────────── */

    _makecolumnDef(field, rows) {
      const preset = this.options.presetcolumns[field];
      const kind = preset ? preset.kind : inferKind(field, rows);
      const definition = {
        field: field,
        title: field, /* بدون ترجمه — عنوان فارسی را کویری با AS می‌سازد */
        width: preset ? preset.width : (kind === 'number' ? 130 : 240),
        minWidth: preset ? preset.minWidth : (kind === 'number' ? 80 : 110),
        _kind: kind,
        headerHozAlign: 'center',
        hozAlign: kind === 'number' ? 'center' : 'right',
        sorter: kind === 'number' ? 'number' : 'string',
        headerFilter: 'input',
        variableHeight: true
      };
      /* ═══════ ستون‌هایی که عددی‌اند اما نباید جمع فوتر بگیرند ═══════ */

      this.fieldKinds.set(field, kind);
      if (kind === 'text') definition.headerFilterFunc = 'like';
      if (kind === 'number') {
        if (!NO_SUM_FIELDS.has(field)) {
          definition.bottomCalc = 'sum';
          definition.bottomCalcFormatter = function (cell) {
            return formatNumber(cell.getValue());
          };
        }
      }
      return definition;
    }











    /** نوع ستون — بعد از restore از layout از نگاشت جانبی خوانده می‌شود */
    columnKind(definition) {
      return definition._kind || this.fieldKinds.get(definition.field) || 'text';
    }
    getcolumnState(field) {
      if (!this.columnState.has(field)) {
        this.columnState.set(field, {
          visible: true, frozen: false,
          foreground: null, background: null, baseWidth: 0
        });
      }
      return this.columnState.get(field);
    }
    /** ستون‌های دارای فیلد (بدون ستون‌های سیستمی) */
    getManagedcolumns() {
      return this.table.getcolumns().filter(function (c) { return Boolean(c.getField()); });
    }
    /** نام فیلدهای ستون‌های نمایان (به ترتیب فعلی) */
    getVisibleFields() {
      return this.getManagedcolumns().filter(function (c) { return c.isVisible(); })
        .map(function (c) { return c.getField(); });
    }
    /** ترتیب فعلی ستون‌ها: [{field, visible, width, frozen}] */
    getcolumnOrder() {
      return this.getManagedcolumns().map(function (c) {
        return {
          field: c.getField(), visible: c.isVisible(),
          width: c.getWidth(), frozen: c.getDefinition().frozen === true
        };
      });
    }
    /** نمایش/مخفی کردن یک ستون */
    togglecolumn(field) {
      const column = this.table.getcolumn(field);
      if (!column) throw new Error('ستونی با نام «' + field + '» نیست.');
      if (column.isVisible()) column.hide(); else column.show();
      return column.isVisible();
    }
    /** فریز همهٔ ستون‌ها تا field (شامل خودش) — field=null یعنی آب‌کردن همه */
    async freezeTo(field) {
      if (field === null || field === undefined) {
        const fields = this.getManagedcolumns().map(function (c) { return c.getField(); });
        if (fields.length) await this.columnManager.setFrozenRange(fields[0], false);
        return;
      }
      await this.columnManager.setFrozenRange(field, true);
    }
    /** رنگ اختصاصی متن/پس‌زمینهٔ یک ستون */
    setcolumnColor(field, foreground, background) {
      const column = this.table.getcolumn(field);
      if (!column) throw new Error('ستونی با نام «' + field + '» نیست.');
      const state = this.getcolumnState(field);
      if (foreground !== undefined && foreground !== null) state.foreground = foreground;
      if (background !== undefined && background !== null) state.background = background;
      column.getCells().forEach(function (cell) {
        const el = cell.getElement();
        el.style.color = state.foreground || '';
        el.style.backgroundColor = state.background || '';
      });
      this.stateStore.schedule();
    }
    /** بازنشانی همهٔ ستون‌ها (نمایش/فریز/رنگ) */
    resetcolumns() { return this.columnManager.reset(); }
    opencolumnManager() { this.columnManager.open(); }
    closecolumnManager() { this.columnManager.close(); }
    /* ─────────── فیلتر، جست‌وجو، مرتب‌سازی ─────────── */
    /**
     * فیلتر برنامه‌ای — همان امضای Tabulator:
     * setFilter(field, type, value) یا setFilter([{field,type,value}, ...])
     */
    setFilter(...args) {
      if (args.length === 1 && Array.isArray(args[0])) {
        this._customFilters = args[0].slice();
      } else {
        this._customFilters.push({ field: args[0], type: args[1], value: args[2] });
      }
      this._applyDataFilters();
    }
    /** جست‌وجوی سراسری در همهٔ ستون‌های نمایان (جدا از فیلترها) */
    search(text) {
      this._searchText = String(text ?? '').trim();
      if (this.searchInput.value !== this._searchText) this.searchInput.value = this._searchText;
      this._applyDataFilters();
      this.emit('searchChanged', { text: this._searchText });
    }
    _applyDataFilters() {
      const fns = [];
      if (this._customFilters.length) fns.push(...this._customFilters);
      const term = this._searchText.toLowerCase();
      if (term) {
        const fields = this.getVisibleFields();
        fns.push(function (data) {
          for (let i = 0; i < fields.length; i++) {
            const v = data[fields[i]];
            if (v !== null && v !== undefined &&
              String(v).toLowerCase().indexOf(term) >= 0) return true;
          }
          return false;
        });
      }
      if (fns.length === 1) this.table.setFilter(fns[0]);
      else if (fns.length > 1) this.table.setFilter(fns);
      else this.table.clearFilter();
    }
    /** حذف همهٔ فیلترها: برنامه‌ای + هدر + جست‌وجو */
    clearFilters() {
      this._customFilters = [];
      this._searchText = '';
      this.searchInput.value = '';
      this.table.clearFilter();
      this.table.clearHeaderFilter();
      this.emit('searchChanged', { text: '' });
    }
    /** فهرست فیلترهای فعال */
    getFilters() {
      return {
        header: this.table.getHeaderFilters().map(f => ({ field: f.field, value: f.value })),
        programmatic: this._customFilters.slice(),
        search: this._searchText
      };
    }
    /** مرتب‌سازی: setSort(field, dir) یا setSort([{column, dir}, ...]) */
    setSort(...args) {
      if (args.length === 1 && Array.isArray(args[0])) this.table.setSort(args[0]);
      else this.table.setSort(args[0], args[1]);
    }
    clearSort() { this.table.clearSort(); }
    getSorters() {
      return this.table.getSorters().map(s => ({ column: s.field, dir: s.dir }));
    }
    /* ─────────── صفحه‌بندی ─────────── */
    setPage(n) { return this.table.setPage(n); }
    nextPage() { return this.table.nextPage().catch(function () { /* آخرین صفحه */ }); }
    prevPage() { return this.table.previousPage().catch(function () { /* اولین صفحه */ }); }
    firstPage() { return this.table.setPage(1); }
    lastPage() { return this.table.setPage('last'); }
    setPageSize(n) { return this.table.setPageSize(n); }
    getPageInfo() {
      return {
        page: this.table.getPage(),
        maxPage: this.table.getPageMax(),
        pageSize: this.table.getPageSize(),
        rows: this.getRecordCount()
      };
    }
    /* ─────────── انتخاب و کپی ─────────── */
    getSelectedData() { return this.selection.getSelectedData(); }
    clearSelection() { this.selection.clear(); }
    selectAllPage() { this.selection.selectAllPage(); }
    /** کپی انتخاب فعلی (بدون انتخاب = null) — Excel-سازگار (TSV) */
    async copySelection(withHeader = false) {
      const result = this.selection.copy(withHeader);
      if (!result) return null;
      await copyTextToClipboard(result.text);
      this.emit('copy', { cells: result.cells, rows: result.rows, header: withHeader });
      return result;
    }
    /** کپی همهٔ نتایج فیلترشده (همهٔ صفحات) با هدر */
    async copyAll() {
      const cols = this.getVisiblecolumns();
      const data = this.getActiveData();
      if (!cols.length || !data.length) throw new Error('چیزی برای کپی نیست — اول کویری بزن.');
      const lines = [cols.map(c => c.getField()).join('\t')];
      data.forEach(function (row) {
        lines.push(cols.map(c => row[c.getField()] ?? '').join('\t'));
      });
      await copyTextToClipboard(lines.join('\r\n'));
      this.emit('copy', { cells: data.length * cols.length, rows: data.length, header: true });
      return data.length;
    }
    /* ─────────── خروجی ─────────── */
    getVisiblecolumns() {
      return this.table.getcolumns().filter(function (c) {
        return Boolean(c.getField()) && c.isVisible();
      });
    }
    /** استایل خروجی هر ستون — از وضعیت زندهٔ گرید (عرض/رنگ/فونت نسبی) */
    _getExportStyle(column) {
      const definition = column.getDefinition();
      const state = this.getcolumnState(column.getField());
      if (!state.baseWidth) {
        state.baseWidth = Number(definition.width) || column.getWidth() || 100;
      }
      return {
        field: column.getField(),
        title: column.getField(),
        kind: this.columnKind(definition),
        widthPx: column.getWidth(),
        fontSizePx: Math.max(FONT.min, Math.min(FONT.max,
          Math.round(FONT.default * column.getWidth() / state.baseWidth))),
        align: definition.hozAlign || 'center',
        foreground: state.foreground || DEFAULT_FG,
        background: state.background || DEFAULT_BG,
        frozen: definition.frozen === true
      };
    }
    /** خروجی Excel — نیازمند ExcelJS (اختیاری)؛ با حفظ رنگ‌ها/عرض/فریز/فیلتر خودکار */
    async exportExcel() {
      if (typeof ExcelJS === 'undefined') {
        throw new Error('ExcelJS بارگذاری نشده — exceljs.min.js را ضمیمه کن یا از CSV استفاده کن.');
      }
      const styles = this.getVisiblecolumns().map(c => this._getExportStyle(c));
      const data = this.getActiveData();
      if (!styles.length) throw new Error('هیچ ستون قابل خروجی نیست.');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Report', { views: [{ rightToLeft: true }] });
      worksheet.columns = styles.map(function (style) {
        return { key: style.field, width: Math.max(4, style.widthPx / EXPORT.excelWidthFactor) };
      });
      /* Row 1 و 2 خالی · Header = Row 3 · Data = Row 4 به بعد */
      worksheet.addRow([]);
      worksheet.addRow([]);
      worksheet.addRow(styles.map(s => s.title));
      data.forEach(function (rowData) {
        worksheet.addRow(styles.map(function (style) { return rowData[style.field]; }));
      });
      const header = worksheet.getRow(EXPORT.headerRow);
      header.height = 24;
      header.eachCell(function (cell) {
        cell.font = { name: 'IRANYekanX', bold: true, size: 9, color: { argb: 'FF20374B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8DCEB' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF9FB5C7' } },
          bottom: { style: 'thin', color: { argb: 'FF9FB5C7' } },
          left: { style: 'thin', color: { argb: 'FFBFCBD4' } },
          right: { style: 'thin', color: { argb: 'FFBFCBD4' } }
        };
      });
      await yieldToUi();
      data.forEach(function (rowData, dataIndex) {
        const excelRow = worksheet.getRow(EXPORT.dataRow + dataIndex);
        let maxLines = 1;
        styles.forEach(function (style, styleIndex) {
          const cell = excelRow.getCell(styleIndex + 1);
          const lineCount = estimateLineCount(rowData[style.field], style);
          maxLines = Math.max(maxLines, lineCount);
          cell.font = {
            name: 'IRANYekanX',
            size: Math.max(6, style.fontSizePx * EXPORT.pxToPoint),
            color: { argb: 'FF' + normalizeHex(style.foreground, DEFAULT_FG) }
          };
          cell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FF' + normalizeHex(style.background, DEFAULT_BG) }
          };
          cell.alignment = {
            horizontal: (style.align === 'left' || style.align === 'right') ? style.align : 'center',
            vertical: 'middle',
            wrapText: lineCount > 1
          };
          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFD8E1E7' } },
            left: { style: 'thin', color: { argb: 'FFBCC9D3' } },
            right: { style: 'thin', color: { argb: 'FFBCC9D3' } }
          };
        });
        excelRow.height = Math.max(18, maxLines * 13);
      });
      /* فریز ستون‌ها مطابق گرید */
      let frozenCount = 0;
      for (const style of styles) { if (!style.frozen) break; frozenCount += 1; }
      if (frozenCount > 0) {
        worksheet.views = [{
          state: 'frozen', xSplit: frozenCount,
          ySplit: EXPORT.headerRow, rightToLeft: true
        }];
      }
      if (styles.length > 0) {
        worksheet.autoFilter = {
          from: { row: EXPORT.headerRow, column: 1 },
          to: { row: EXPORT.headerRow, column: styles.length }
        };
      }
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }),
        (this.tableName || 'QueryResult') + '.xlsx'
      );
      this.emit('exportDone', { kind: 'excel', rows: data.length });
      return data.length;
    }
    /** چاپ وضعیت فعلی گرید */
    print() { window.print(); }
    /** wrapper دکمه‌های خروجی: قفل دکمه + خطا + رویداد */
    async _runExport(button, action) {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        console.error('[BinaGrid] export error', error);
        this.emit('exportError', { error: error });
        this._toast('خطا در خروجی: ' + (error?.message || 'نامشخص'));
      } finally {
        button.disabled = false;
      }
    }
    _toast(text) {
      this.toastEl.textContent = text;
      this.toastEl.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2000);
    }
    _emitSelectionChanged() {
      let cells = 0;
      this.selection?.cells.forEach(function (set) { cells += set.size; });
      this.emit('selectionChanged', {
        cells: cells,
        rows: this.selection?.rows.size || 0,
        activeField: this.selection?.active?.field || null
      });
    }
    /* ─────────── کیبورد ─────────── */
    _onKeydown(event) {
      if (this._destroyed) return;
      const sel = this.selection;
      if (event.key === 'Escape') { sel.clear(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        this.copySelection(event.shiftKey).then(res => {
          if (res) this._toast(faNum(res.cells) + ' سلول کپی شد ✓');
        }).catch(() => this._toast('کپی ممکن نشد'));
        return;
      }
      const nav = {
        ArrowUp: 'up', ArrowDown: 'down',
        ArrowRight: 'prev', ArrowLeft: 'next',  /* RTL: راست = ستون قبلی (سمت راست صفحه) */
        Home: 'home', End: 'end'
      };
      const dir = nav[event.key];
      if (dir) {
        event.preventDefault();
        this._moveActive(dir, event.ctrlKey || event.metaKey);
        return;
      }
      if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.selectAllPage();
      }
    }
    /** حرکت سلول فعال با کیبورد */
    _moveActive(dir, ctrl) {
      const sel = this.selection;
      const visibleRows = this.table.getRows('visible');
      const fields = this.getVisibleFields();
      if (!visibleRows.length || !fields.length) return;
      let rowIdx = 0, colIdx = 0;
      if (sel.active) {
        rowIdx = visibleRows.findIndex(r => r === sel.active.row);
        colIdx = fields.indexOf(sel.active.field);
        if (rowIdx < 0) rowIdx = 0;
        if (colIdx < 0) colIdx = 0;
      }
      if (ctrl && dir === 'home') { rowIdx = 0; colIdx = 0; }
      else if (ctrl && dir === 'end') { rowIdx = visibleRows.length - 1; colIdx = fields.length - 1; }
      else if (dir === 'up') rowIdx = Math.max(0, rowIdx - 1);
      else if (dir === 'down') rowIdx = Math.min(visibleRows.length - 1, rowIdx + 1);
      else if (dir === 'next') colIdx = Math.min(fields.length - 1, colIdx + 1);
      else if (dir === 'prev') colIdx = Math.max(0, colIdx - 1);
      else if (dir === 'home') colIdx = 0;
      else if (dir === 'end') colIdx = fields.length - 1;
      const row = visibleRows[rowIdx];
      const rowEl = row.getElement();
      if (!rowEl || !rowEl.isConnected) return; /* ردیف در صفحهٔ دیگر — حرکت نمی‌کنیم */
      const cell = row.getCells().find(c => c.getField() === fields[colIdx]);
      if (!cell) return;
      sel.setActive(cell);
      const el = cell.getElement();
      if (el && el.isConnected) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    /* ─────────── دکمه‌های نوار ابزار ─────────── */
    _wireToolbar() {
      const self = this;
      this.searchInput.addEventListener('input', function () {
        clearTimeout(self._searchTimer);
        self._searchTimer = setTimeout(function () { self.search(self.searchInput.value); }, 200);
      });
      this.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { self.search(''); self.root.focus(); }
      });
      this.toolbar.querySelector('.bina-clear').addEventListener('click', function () { self.clearFilters(); });
      this.toolbar.querySelector('[data-act="copyall"]').addEventListener('click', function () {
        self._runExport(event.currentTarget, function () {
          return self.copyAll().then(function (n) { self._toast(faNum(n) + ' ردیف کپی شد ✓'); });
        });
      });
      this.toolbar.querySelector('[data-act="excel"]').addEventListener('click', function (e) {
        self._runExport(e.currentTarget, () => self.exportExcel());
      });
      // this.toolbar.querySelector('[data-act="csv"]').addEventListener('click', function (e) {
      //   self._runExport(e.currentTarget, () => self.exportCsv());
      // });
      this.toolbar.querySelector('[data-act="print"]').addEventListener('click', function () { self.print(); });
      this.toolbar.querySelector('[data-act="columns"]').addEventListener('click', function () { self.columnManager.open(); });
    }
    /* ─────────── وضعیت و چرخهٔ حیات ─────────── */
    /** ذخیرهٔ فوری تنظیمات فعلی */
    saveState() { this.stateStore.saveNow(); }
    /** بازگردانی تنظیمات از localStorage */
    restoreState() { return this.stateStore.restore(); }
    /** پاک کردن تنظیمات ذخیره‌شدهٔ نمای فعلی */
    resetState() {
      try { localStorage.removeItem(this.stateStore.key()); } catch (e) { /* noop */ }
    }
    /** نسخهٔ کامپوننت */
    static get version() { return '1.1.0'; }
    /** تخریب کامل: قطع رویدادها و حذف DOM */
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      document.removeEventListener('keydown', this._docKeydown);
      try { this.table.destroy(); } catch (e) { /* noop */ }
      this.root.remove();
      this.events = new EventBus();
    }
    /* ─────────── رویدادها ─────────── */
    on(name, fn) { return this.events.on(name, fn); }
    once(name, fn) { return this.events.once(name, fn); }
    off(name, fn) { this.events.off(name, fn); }
    emit(name, payload) { this.events.emit(name, payload); }
  }
  /* سیم‌کشی دکمه‌های نوار ابزار — بعد از ساخت کامل نمونه */
  const _origWire = BinaGrid.prototype._wireEvents;
  BinaGrid.prototype._wireEvents = function () {
    _origWire.call(this);
    this._wireToolbar();
  };
  /* توابع کمکی برای استفادهٔ بیرونی/تست */
  BinaGrid.utils = Object.freeze({
    formatNumber, faNum, inferKind, measureTextWidth, estimateLineCount,
    isNumericLike, isBlank, normalizeHex, downloadBlob, copyTextToClipboard, yieldToUi
  });
  global.BinaGrid = BinaGrid;
  /* ═══════════════════════════════════════════════════════════════════════════
     📖 مستند API — BinaGrid v1.1.0
     ───────────────────────────────────────────────────────────────────────────
     ■ چرخهٔ حیات
       new BinaGrid(container, options)   options: pageSize=500,
         pageSizeOptions=[100,500,1000,5000,همه], rtl=true, height='560px',
         storagePrefix='BinaGrid', presetcolumns=PRESET_COLUMNS,
         locale='fa-fa', movablecolumns=true, resizablecolumns=true, showToolbar=true
       grid.destroy()
     ■ داده
       setData(rows, tableName, opts?)  → Promise — ستون‌های داینامیک + restore تنظیمات
                                  opts.own=true → بدون کپی ردیف‌ها (v1.1)؛ __id روی همان آبجکت‌ها می‌نشیند.
                                  پیش‌فرض: مثل v1.0 هر ردیف کپی می‌شود و ورودی دست‌نخورده می‌ماند.
       clearData()               → Promise
       getData()                 → همهٔ ردیف‌ها
       getFilteredData()         → نتایج فیلترشده (همهٔ صفحات)
       getActiveData()           → همان getFilteredData
       getRecordCount()          → تعداد فیلترشده
     ■ ستون‌ها
       getcolumnOrder() → [{field, visible, width, frozen}]
       togglecolumn(field) → visible جدید
       freezeTo(field | null)
       setcolumnColor(field, fg, bg)
       resetcolumns() · opencolumnManager() · closecolumnManager()
     ■ فیلتر / جست‌وجو / مرتب‌سازی
       setFilter(field, type, value) | setFilter([{field,type,value},…])
       search(text)              → جست‌وجو در همهٔ ستون‌های نمایان
       clearFilters()            → فیلتر برنامه‌ای + هدر + جست‌وجو
       getFilters()              → {header, programmatic, search}
       setSort(field, dir) | setSort([{column,dir},…]) · clearSort() · getSorters()
     ■ صفحه‌بندی
       setPage(n) · nextPage() · prevPage() · firstPage() · lastPage()
       setPageSize(n) · getPageInfo() → {page, maxPage, pageSize, rows}
     ■ انتخاب و کپی
       کلیک=سلول فعال · Shift+کلیک=محدوده · Ctrl+کلیک=ردیف · Ctrl+A=همهٔ صفحه · Esc=پاک
       Ctrl+C=کپی TSV · Ctrl+Shift+C=کپی با هدر · Ctrl+F=جست‌وجو
       getSelectedData() · clearSelection() · selectAllPage()
       copySelection(withHeader=false) → Promise<{cells, rows} | null>
       copyAll() → Promise<rows>
     ■ خروجی
       exportCsv() → تعداد ردیف‌ها (کل نتایج فیلترشده، BOM، سازگار Excel فارسی)
       exportExcel() → Promise<تعداد> (نیازمند ExcelJS؛ حفظ رنگ/عرض/فریز/فیلتر)
       print()
     ■ وضعیت
       saveState() · restoreState() → Promise · resetState()
     ■ رویدادها (on/once/off)
       tableBuilt · dataLoaded {tableName, rows} · rowClick {event, data}
       rowDblClick · cellClick {event, field, data} · cellDblClick
       selectionChanged {cells, rows, activeField} · filterChanged {count}
       searchChanged {text} · sortChanged [{column, dir}] · pageChanged {page, pageSize}
       columnMoved · columnResized {field, width} · columnVisibilityChanged
       columnManagerToggled {open} · copy {cells, rows, header}
       exportDone {kind, rows} · exportError {error}
     ■ فانکشن‌های آزاد: BinaGrid.utils
       formatNumber(v) · faNum(n) · inferKind(field, rows)
       measureTextWidth(text, fontSize) · estimateLineCount(value, style)
       isNumericLike(v) · isBlank(v) · normalizeHex(color, fallback)
       downloadBlob(blob, name) · copyTextToClipboard(text) · yieldToUi()
     ■ ماندگاری (localStorage)
       {storagePrefix}.{tableName}.{امضای ستون‌ها}.v1
         = چیدمان + رنگ‌ها + فریز + فیلترهای هدر/برنامه‌ای + مرتب‌سازی
       {storagePrefix}.pageSize = اندازهٔ صفحه
       تنظیمات هر نما (جدول/کویری) مستقل است؛ جست‌وجوی سراسری ماندگار نیست.
     ═══════════════════════════════════════════════════════════════════════ */
})(window);
