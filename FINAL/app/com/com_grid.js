/* BinaGrid v1.2.42 (regular IRANYekanX and consistent frame)
 * Baseline: v1.2.34. Internal behavior and public API are unchanged.
 * Styles: FINAL/css/com_grid.css; JS: FINAL/app/bina/bina-grid.js.
 * Cleanup: remove pending timers/animation frames on destroy; CSS cache marker updated.
 */
(function (ab) {
  "use strict";
  const aC = (() => {
    const dl = document.currentScript;
    try {
      return dl?.src
        ? new URL("com_color.js?v=1.2.3", dl.src).href
        : "./com_color.js?v=1.2.3";
    } catch (_) {
      return "./com_color.js?v=1.2.3";
    }
  })();
  let ae = null;
  function ensureSharedColorPalette() {
    if (ab.BinaColorPalette?.open) return Promise.resolve(ab.BinaColorPalette);
    if (ae) return ae;
    ae = new Promise((eW, dU) => {
      const bJ = document.createElement("script");
      bJ.src = aC;
      bJ.async = true;
      bJ.onload = () =>
        ab.BinaColorPalette?.open
          ? eW(ab.BinaColorPalette)
          : dU(new Error("پالت رنگ قابل استفاده نیست"));
      bJ.onerror = () =>
        dU(new Error("فایل com_color.js در کنار com_grid.js پیدا نشد"));
      document.head.appendChild(bJ);
    }).catch((gB) => {
      ae = null;
      throw gB;
    });
    return ae;
  }
  const aq = {
    default: 11,
    delta: 4,
    manualMin: 9,
    manualMax: 24,
    fitTolerance: 1,
    precision: 10,
  };
  function normalizedColumnAlignment(dm) {
    return dm === "left" || dm === "center" || dm === "right" ? dm : null;
  }
  function normalizedColumnFontSize(dn) {
    const dV = Number(dn);
    return dn !== null &&
      dn !== undefined &&
      dn !== "" &&
      Number.isFinite(dV) &&
      Number.isInteger(dV) &&
      dV >= aq.manualMin &&
      dV <= aq.manualMax
      ? dV
      : null;
  }
  const a3 = "#2d4355";
  const a4 = "#f7fafc";
  function paintCellColors(cj, fB) {
    if (!cj) return;
    cj.style.color = fB.foreground || "";
    cj.style.backgroundColor = fB.background || "";
  }
  const a5 = { headerRow: 3, dataRow: 4, excelWidthFactor: 7, pxToPoint: 0.75 };
  const aH =
    /bed|bes|bedehkar|bestankar|gardesh|mandeh|مانده|گردش|بدهکار|بستانکار/i;
  function financialText(dW) {
    if (dW == null || dW === "") return "";
    return String(dW)
      .trim()
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\s,٬]/g, "")
      .replace(/٫/g, ".")
      .replace(/−/g, "-");
  }
  function sumFinancialValues(f$) {
    let aK = 0n;
    let a_ = 0;
    let bx = false;
    for (const iM of f$) {
      const ay = financialText(iM);
      if (!ay) continue;
      if (/^[+-]?\d+$/.test(ay)) {
        aK += BigInt(ay);
      } else if (/^[+-]?\d+(?:\.\d+)?$/.test(ay)) {
        const dX = Number(ay);
        if (!Number.isFinite(dX)) continue;
        a_ += dX;
        bx = true;
      }
    }
    return bx ? Number(aK) + a_ : aK.toString();
  }
  const ap = Object.freeze({ fa: "fa-IR", en: "en-US", ar: "ar-EG" });
  const ad = new Map();
  function getSidebarLanguage() {
    let ck = "";
    try {
      ck = ab.localStorage?.getItem("sidebarLanguage") || "";
    } catch (_) {}
    if (!ck) {
      try {
        ck = ab.parent?.document?.documentElement?.lang || "";
      } catch (_) {}
    }
    if (!ck) ck = document.documentElement.lang || "fa";
    ck = String(ck).toLowerCase().split(/[-_]/)[0];
    return Object.prototype.hasOwnProperty.call(ap, ck) ? ck : "fa";
  }
  function getNumberFormatter() {
    const cl = ap[getSidebarLanguage()];
    if (!ad.has(cl)) {
      ad.set(cl, new Intl.NumberFormat(cl, { maximumFractionDigits: 20 }));
    }
    return ad.get(cl);
  }
  function formatNumber(b8) {
    if (b8 === null || b8 === undefined || b8 === "") return "";
    const a6 = financialText(b8);
    try {
      if (/^[+-]?\d+$/.test(a6)) return getNumberFormatter().format(BigInt(a6));
      const ik = Number(a6);
      return Number.isFinite(ik) ? getNumberFormatter().format(ik) : b8;
    } catch (_) {
      return b8;
    }
  }
  function compareFinancialValues(a, b) {
    const dp = financialText(a);
    const cm = financialText(b);
    if (/^[+-]?\d+$/.test(dp) && /^[+-]?\d+$/.test(cm)) {
      const av = BigInt(dp),
        bv = BigInt(cm);
      return av < bv ? -1 : av > bv ? 1 : 0;
    }
    const av = dp === "" ? 0 : Number(dp);
    const bv = cm === "" ? 0 : Number(cm);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
  function faNum(n) {
    return getNumberFormatter().format(Number(n));
  }
  function localizeTextDigits(gC) {
    const f0 =
      getSidebarLanguage() === "ar"
        ? "٠١٢٣٤٥٦٧٨٩"
        : getSidebarLanguage() === "fa"
          ? "۰۱۲۳۴۵۶۷۸۹"
          : "0123456789";
    return String(gC ?? "").replace(/[0-9۰-۹٠-٩]/g, (b9) => {
      const cU = b9.charCodeAt(0);
      const gD =
        cU >= 48 && cU <= 57
          ? cU - 48
          : cU >= 0x06f0 && cU <= 0x06f9
            ? cU - 0x06f0
            : cU - 0x0660;
      return f0[gD] || b9;
    });
  }
  function isNumericLike(v) {
    return (
      typeof v === "number" ||
      (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    );
  }
  function isBlank(v) {
    return v === null || v === undefined || v === "";
  }
  function inferKind(field) {
    return aH.test(String(field ?? "")) ? "number" : "text";
  }
  function measureTextWidth(hx, dY) {
    if (!measureTextWidth.canvas)
      measureTextWidth.canvas = document.createElement("canvas");
    const il = measureTextWidth.canvas.getContext("2d");
    il.font = dY + "px BinaGrid-IRANYekanX, Tahoma, Arial, sans-serif";
    return il.measureText(String(hx ?? "")).width;
  }
  function estimateLineCount(fC, dZ) {
    if (dZ.kind === "number" || isBlank(fC)) return 1;
    const cJ = Math.max(16, dZ.widthPx - 14);
    const dE = measureTextWidth(fC, dZ.fontSizePx);
    return Math.max(1, Math.min(3, Math.ceil(dE / cJ)));
  }
  function downloadBlob(hy, d_) {
    const im = URL.createObjectURL(hy);
    const d$ = document.createElement("a");
    d$.href = im;
    d$.download = d_;
    document.body.append(d$);
    d$.click();
    d$.remove();
    URL.revokeObjectURL(im);
  }
  function copyTextToClipboard(f1) {
    return new Promise(function (cn, d0) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(f1)
          .then(function () {
            cn(true);
          })
          .catch(function () {
            legacyCopy(f1) ? cn(true) : d0(new Error("کپی ممکن نشد"));
          });
      } else {
        legacyCopy(f1) ? cn(true) : d0(new Error("کپی ممکن نشد"));
      }
    });
  }
  function legacyCopy(hz) {
    try {
      const ta = document.createElement("textarea");
      ta.value = hz;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }
  function normalizeHex(gE, d1) {
    const fD = String(gE || d1 || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(fD)) return fD.slice(1).toUpperCase();
    return "FFFFFF";
  }
  function yieldToUi() {
    return new Promise(function (eX) {
      requestAnimationFrame(function () {
        setTimeout(eX, 0);
      });
    });
  }
  class EventBus {
    constructor() {
      this._map = new Map();
    }
    on(eY, fn) {
      if (!this._map.has(eY)) this._map.set(eY, new Set());
      this._map.get(eY).add(fn);
      const hA = this;
      return function () {
        hA.off(eY, fn);
      };
    }
    once(hB, fn) {
      const io = this.on(hB, function (eZ) {
        io();
        fn(eZ);
      });
      return io;
    }
    off(gF, fn) {
      if (this._map.has(gF)) this._map.get(gF).delete(fn);
    }
    emit(f2, e_) {
      if (!this._map.has(f2)) return;
      this._map.get(f2).forEach(function (fn) {
        try {
          fn(e_);
        } catch (e) {
          console.error("[BinaGrid] event handler error:", f2, e);
        }
      });
    }
  }
  class SmartText {
    constructor(hC) {
      this.grid = hC;
      this.pending = new Set();
      this.frame = 0;
    }
    cellFormatter(f3) {
      const co = f3.getColumn();
      const a7 = co.getDefinition();
      const d2 = this.grid.getColumnState(co.getField());
      const aO = f3.getElement();
      paintCellColors(aO, d2);
      aO.dataset.binaField = co.getField();
      const b5 = document.createElement("div");
      b5.className =
        "smart " + (this.grid.columnKind(a7) === "number" ? "num" : "text");
      this.applyAlignmentToCell(
        aO,
        this.grid.getEffectiveAlignment(co.getField()),
        b5,
      );
      const bj = normalizedColumnFontSize(d2.fontSize) ?? aq.default;
      this.setTextFont(b5, bj);
      this.applyBoldToText(b5, d2.bold);
      b5.dataset.fontSize = String(bj);
      b5.dataset.lines = "1";
      const dq = f3.getValue();
      if (this.grid.columnKind(a7) === "number") b5._binaNumericValue = dq;
      else b5._binaTextValue = dq;
      b5.textContent =
        this.grid.columnKind(a7) === "number"
          ? formatNumber(dq)
          : localizeTextDigits(dq);
      return b5;
    }
    setTextFont(cp, hD) {
      if (!cp) return;
      cp.style.setProperty(
        "font-family",
        "BinaGrid-IRANYekanX, Tahoma, Arial, sans-serif",
        "important",
      );
      cp.style.setProperty("font-size", hD + "px", "important");
    }
    fontBounds(cV) {
      const base = cV ?? aq.default;
      return { base, min: 9, max: base + aq.delta };
    }
    fitText(aI, cW, ca, at) {
      const { base, min, max } = this.fontBounds(cW);
      const bF = Number(aI.dataset.fontSize);
      const d3 = Number(aI.dataset.lines || 1);
      const dr = aI.textContent || "";
      const gG = ca > 0 && at > 0 ? Math.max(1, at / ca) : 1;
      let bD = Math.min(
        max,
        Math.max(base, Math.round(base * gG * aq.precision) / aq.precision),
      );
      aI.classList.remove("w2", "w3");
      this.setTextFont(aI, bD);
      const aw = aI.clientWidth;
      if (aw > 0) {
        const dF = Math.max(1, aw - aq.fitTolerance);
        for (let ds = 0; ds < 3; ds++) {
          const d4 = aI.scrollWidth;
          if (d4 <= aw + aq.fitTolerance || bD <= min + 0.001) break;
          const f4 = Math.floor(((bD * dF) / d4) * aq.precision) / aq.precision;
          const cL = Math.max(min, Math.min(bD, f4));
          if (cL >= bD - 0.001) break;
          bD = cL;
          this.setTextFont(aI, bD);
        }
      }
      let dt = 1;
      const d5 = aw > 0 && aI.scrollWidth > aw + aq.fitTolerance;
      if (d5 && bD <= min + 0.01) {
        dt = aI.scrollWidth <= aw * 2 ? 2 : 3;
        aI.classList.add(dt === 2 ? "w2" : "w3");
      }
      aI.dataset.fontSize = String(bD);
      aI.dataset.lines = String(dt);
      aI.dataset.fitWidth = String(at);
      aI.dataset.fitBase = String(base);
      aI.dataset.fitContent = dr;
      return bF !== bD || d3 !== dt;
    }
    refreshLocalizedNumbers() {
      this.grid.tableEl
        .querySelectorAll(
          ".smart.num:not(.bina-bottom-calc), .bina-bottom-calc",
        )
        .forEach((dG) => {
          if (dG._binaNumericValue !== undefined)
            dG.textContent = formatNumber(dG._binaNumericValue);
          else if (dG._binaTextValue !== undefined)
            dG.textContent = localizeTextDigits(dG._binaTextValue);
        });
      this.scheduleVisibleRows();
      this.scheduleBottomCalcs();
    }
    scheduleBottomCalcs(field = null) {
      if (!this.pendingCalcFields) this.pendingCalcFields = new Set();
      this.pendingCalcFields.add(field || "*");
      if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
    }
    updateBottomCalcs(cX = null) {
      const gH = new Set();
      this.grid.tableEl.querySelectorAll(".bina-bottom-calc").forEach((e0) => {
        const field = e0.dataset.binaField;
        if (!field || (cX && !cX.has("*") && !cX.has(field))) return;
        const dH = e0.closest(".tabulator-cell");
        if (!dH || !dH.isConnected) return;
        const hu = this.grid.table?.getColumn(field);
        if (!hu) return;
        const cb = this.grid.getColumnState(field);
        const iN = hu.getDefinition();
        if (!cb.baseWidth)
          cb.baseWidth = Number(iN.width) || hu.getWidth() || 100;
        paintCellColors(dH, cb);
        this.applyBoldToText(e0, cb.bold);
        this.alignBottomCalcCell(dH, this.grid.getEffectiveAlignment(field));
        this.fitText(
          e0,
          normalizedColumnFontSize(cb.fontSize),
          cb.baseWidth,
          hu.getWidth(),
        );
        const ip = dH.closest(".tabulator-row") || dH.parentElement;
        if (ip) gH.add(ip);
      });
      if (this.grid.rowSizer?.userSized) return;
      gH.forEach((iO) => {
        const d6 = iO.querySelectorAll(".tabulator-cell");
        d6.forEach((gI) => {
          gI.style.height = "";
          gI.style.minHeight = "";
        });
        let ax = 0;
        d6.forEach((f5) => {
          const f6 = f5.querySelector(".bina-bottom-calc");
          if (f6) {
            const cs = getComputedStyle(f5);
            const cY = Number.parseFloat(getComputedStyle(f6).lineHeight) || 15;
            const dI = Number(f6.dataset.lines || 1);
            const bE =
              (Number.parseFloat(cs.paddingTop) || 0) +
              (Number.parseFloat(cs.paddingBottom) || 0);
            ax = Math.max(ax, Math.ceil(cY * dI + bE));
          }
          ax = Math.max(ax, Math.ceil(f5.getBoundingClientRect().height));
        });
        if (ax)
          d6.forEach((hE) => {
            hE.style.minHeight =
              Math.max(this.grid.rowSizer?.height || 0, ax) + "px";
          });
      });
    }
    applyAlignmentToCell(aP, fE, hF) {
      if (!aP) return;
      aP.style.setProperty("text-align", fE, "important");
      const label = hF || aP.querySelector(".smart");
      if (!label) return;
      label.style.setProperty("width", "100%", "important");
      label.style.setProperty("min-width", "0", "important");
      label.style.setProperty("flex", "1 1 100%", "important");
      label.style.setProperty("text-align", fE, "important");
    }
    applyRenderedColumnAlignment(field, gJ) {
      this.grid.tableEl.querySelectorAll(".tabulator-cell").forEach((aQ) => {
        if (
          (aQ.dataset.binaField || aQ.getAttribute("tabulator-field")) !== field
        )
          return;
        this.applyAlignmentToCell(aQ, gJ);
      });
    }
    alignBottomCalcContent(cc, gK) {
      if (!cc) return;
      cc.style.setProperty("width", "100%", "important");
      cc.style.setProperty("min-width", "0", "important");
      cc.style.setProperty("flex", "1 1 100%", "important");
      cc.style.setProperty("direction", "ltr", "important");
      cc.style.setProperty("text-align", gK, "important");
    }
    alignBottomCalcCell(d7, du) {
      if (!d7) return;
      d7.style.setProperty("direction", "ltr", "important");
      d7.style.setProperty("text-align", du, "important");
      d7.style.setProperty(
        "justify-content",
        du === "right" ? "flex-end" : du === "left" ? "flex-start" : "center",
        "important",
      );
      const fF = d7.querySelector(".bina-bottom-calc");
      if (fF) this.alignBottomCalcContent(fF, du);
    }
    applyRenderedBottomCalcAlignment(field, gL) {
      const gM = this.grid.tableEl.querySelectorAll(
        ".tabulator-calcs-holder .tabulator-cell, .tabulator-calcs .tabulator-cell, " +
          ".tabulator-footer .tabulator-cell, .tabulator-calcs-bottom .tabulator-cell",
      );
      gM.forEach((e1) => {
        const dJ =
          e1.dataset.binaCalcField ||
          e1.getAttribute("tabulator-field") ||
          e1.querySelector(".bina-bottom-calc")?.dataset.binaField;
        if (dJ === field) this.alignBottomCalcCell(e1, gL);
      });
    }
    applyBoldToText(e2, hG) {
      if (!e2) return;
      const dv = hG === true;
      e2.classList.toggle("bina-bold", dv);
      if (dv) e2.style.setProperty("font-weight", "700", "important");
      else e2.style.removeProperty("font-weight");
    }
    applyRenderedColumnBold(field, hH) {
      this.grid.tableEl.querySelectorAll(".tabulator-cell").forEach((aR) => {
        if (
          (aR.dataset.binaField || aR.getAttribute("tabulator-field")) !== field
        )
          return;
        this.applyBoldToText(aR.querySelector(".smart"), hH);
      });
    }
    scheduleCell(hI) {
      this.pending.add(hI);
      if (!this.frame) {
        const hJ = this;
        this.frame = requestAnimationFrame(function () {
          hJ.flush();
        });
      }
    }
    scheduleColumn(d8) {
      if (!d8) return;
      d8.getCells().forEach((gN) => {
        if (gN.getElement()?.isConnected) this.scheduleCell(gN);
      });
    }
    scheduleVisibleRows() {
      this.grid.table.getRows("visible").forEach((iq) => {
        if (!iq.getElement()?.isConnected) return;
        iq.getCells().forEach((gO) => {
          if (gO.getElement()?.isConnected) this.scheduleCell(gO);
        });
      });
    }
    resetRenderedFonts() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.pending.clear();
      this.grid.tableEl.querySelectorAll(".smart").forEach((dK) => {
        dK.classList.remove("w2", "w3");
        this.setTextFont(dK, aq.default);
        this.applyBoldToText(dK, false);
        dK.dataset.fontSize = String(aq.default);
        dK.dataset.lines = "1";
        const aS = dK.closest(".tabulator-cell");
        if (aS) {
          aS.style.height = "";
          aS.style.minHeight = "";
        }
      });
      this.scheduleBottomCalcs();
      const f7 = this.grid.table.getRows("visible");
      if (Array.isArray(f7)) {
        f7.forEach((ir) => {
          const bK = ir.getElement();
          if (!bK || !bK.isConnected) return;
          ir.getCells().forEach((gP) => {
            if (gP.getElement()?.isConnected) this.scheduleCell(gP);
          });
        });
        requestAnimationFrame(() => {
          f7.forEach((it) => {
            if (it.getElement()?.isConnected) this.normalizeRow(it);
          });
        });
      }
    }
    updateSmartCell(f8) {
      const bl = f8.getElement();
      if (!bl || !bl.isConnected) return { row: null, layoutChanged: false };
      const e3 = bl.querySelector(".smart:not(.bina-bottom-calc)");
      if (!e3) return { row: null, layoutChanged: false };
      const cZ = f8.getColumn();
      const field = cZ.getField();
      const cM = this.grid.getColumnState(field);
      const fG = cZ.getWidth() || bl.getBoundingClientRect().width || 100;
      if (!cM.baseWidth) cM.baseWidth = Number(cZ.getDefinition().width) || fG;
      this.applyAlignmentToCell(bl, this.grid.getEffectiveAlignment(field), e3);
      this.applyBoldToText(e3, cM.bold);
      const e4 = this.fitText(
        e3,
        normalizedColumnFontSize(cM.fontSize),
        cM.baseWidth,
        fG,
      );
      return { row: f8.getRow(), layoutChanged: e4 };
    }
    normalizeRow(hK) {
      if (this.grid.rowSizer?.userSized) return;
      try {
        const a8 = hK.getElement();
        const fH = hK.getCells();
        fH.forEach(function (hL) {
          const el = hL.getElement();
          el.style.height = "";
          el.style.minHeight = "";
        });
        hK.normalizeHeight();
        if (!a8 || !a8.isConnected) return;
        const cd = Math.max(
          this.grid.rowSizer?.height || 0,
          Math.ceil(a8.getBoundingClientRect().height),
        );
        fH.forEach(function (hM) {
          const el = hM.getElement();
          if (!el || !el.isConnected) return;
          el.style.height = cd + "px";
          el.style.minHeight = cd + "px";
        });
      } catch (e) {}
    }
    syncRowHeight(iu) {
      const f9 = this.grid;
      if (f9.rowSizer?.userSized) return;
      requestAnimationFrame(function () {
        try {
          if (f9.rowSizer?.userSized) return;
          const a9 = iu.getElement();
          if (!a9 || !a9.isConnected) return;
          const bs = Math.max(
            f9.rowSizer?.height || 0,
            Math.ceil(a9.getBoundingClientRect().height),
          );
          iu.getCells().forEach(function (hN) {
            const el = hN.getElement();
            if (!el || !el.isConnected) return;
            const c_ = Math.ceil(el.getBoundingClientRect().height);
            if (c_ !== bs) {
              el.style.height = bs + "px";
              el.style.minHeight = bs + "px";
            }
          });
        } catch (e) {}
      });
    }
    flush() {
      this.frame = 0;
      const gQ = new Set();
      const gR = this;
      this.pending.forEach(function (hO) {
        const c$ = gR.updateSmartCell(hO);
        if (c$.row && c$.layoutChanged) gQ.add(c$.row);
      });
      this.pending.clear();
      gQ.forEach(function (iP) {
        gR.normalizeRow(iP);
      });
      if (this.pendingCalcFields?.size) {
        const ga = new Set(this.pendingCalcFields);
        this.pendingCalcFields.clear();
        this.updateBottomCalcs(ga);
      }
    }
    destroy() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.pending.clear();
      this.pendingCalcFields?.clear();
    }
  }
  class GridRowSizer {
    constructor(hP) {
      this.grid = hP;
      this.height = 30;
      this.userSized = false;
      this.active = null;
      this._move = this._move.bind(this);
      this._finish = this._finish.bind(this);
      this._frame = 0;
      this.setHeight(this.height, false);
    }
    install(iv) {
      const el = iv.getElement();
      if (!el || el.querySelector(":scope > .bina-row-resizer")) return;
      const cr = document.createElement("span");
      cr.className = "bina-row-resizer";
      cr.title =
        "تغییر ارتفاع تمام ردیف‌ها — بکشید؛ با کلیدهای بالا و پایین هم قابل تنظیم است";
      cr.tabIndex = 0;
      cr.setAttribute("role", "separator");
      cr.setAttribute("aria-orientation", "horizontal");
      cr.setAttribute("aria-label", "ارتفاع تمام ردیف‌ها");
      cr.addEventListener("pointerdown", (gS) => this._start(gS, iv));
      cr.addEventListener("keydown", (cN) => {
        if (cN.key !== "ArrowUp" && cN.key !== "ArrowDown") return;
        cN.preventDefault();
        cN.stopPropagation();
        this.userSized = true;
        this.setHeight(this.height + (cN.key === "ArrowDown" ? 2 : -2), true);
      });
      el.appendChild(cr);
    }
    _start(dw, iQ) {
      if (this.active || dw.button !== 0) return;
      dw.preventDefault();
      dw.stopPropagation();
      this.active = {
        y: dw.clientY,
        height: Math.max(
          this.height,
          Math.ceil(iQ.getElement().getBoundingClientRect().height),
        ),
      };
      this.userSized = true;
      this.setHeight(this.active.height, false);
      this.grid.root.classList.add("bina-row-dragging");
      ab.addEventListener("pointermove", this._move, true);
      ab.addEventListener("pointerup", this._finish, true);
      ab.addEventListener("pointercancel", this._finish, true);
    }
    _move(fI) {
      if (!this.active) return;
      fI.preventDefault();
      this.setHeight(this.active.height + fI.clientY - this.active.y, false);
    }
    _finish() {
      if (!this.active) return;
      this.active = null;
      this.grid.root.classList.remove("bina-row-dragging");
      ab.removeEventListener("pointermove", this._move, true);
      ab.removeEventListener("pointerup", this._finish, true);
      ab.removeEventListener("pointercancel", this._finish, true);
      this.setHeight(this.height, true);
    }
    setHeight(gT, ct = true) {
      const value = Number(gT);
      if (!Number.isFinite(value)) return;
      const height = Math.max(18, Math.round(value));
      const changed = this.height !== height;
      this.height = height;
      if (ct) this.userSized = true;
      this.grid.root.classList.toggle("bina-row-user-sized", this.userSized);
      this.grid.root.style.setProperty("--bina-row-min-height", height + "px");
      this.grid.root.style.setProperty(
        "--bina-row-padding-y",
        Math.min(5, Math.max(0, (height - 18) / 2)) + "px",
      );
      if (changed || ct) {
        if (!this._frame)
          this._frame = requestAnimationFrame(() => {
            this._frame = 0;
            const grid = this.grid,
              table = grid.table;
            if (!table || grid._destroyed) return;
            // Keep Tabulator's internal virtual-row metric consistent with the CSS.
            // Version 5.5+ uses this option while reconstructing rows on redraw.
            if (table.options)
              table.options.rowHeight = this.userSized ? height : false;
            // Tabulator's virtual renderer retains its previous row metrics if only
            // the cells are resized. Recalculate the row itself AND its virtual layout.
            for (const row of table.getRows("visible")) {
              const el = row.getElement();
              if (!el?.isConnected) continue;
              el.style.removeProperty("height");
              el.style.removeProperty("min-height");
              el.style.removeProperty("max-height");
              for (const cell of row.getCells()) {
                const node = cell.getElement();
                if (!node) continue;
                node.style.removeProperty("height");
                node.style.removeProperty("min-height");
                node.style.removeProperty("max-height");
              }
              try {
                row.normalizeHeight();
              } catch (_) {
                /* Not all Tabulator versions expose this */
              }
            }
            const holder = grid.tableEl.querySelector(".tabulator-tableholder");
            const scrollTop = holder?.scrollTop || 0;
            // A full redraw refreshes the VDOM row heights; merely applying CSS
            // leaves the former height as empty space between successive records.
            try {
              table.redraw(true);
            } catch (error) {
              console.warn("[BinaGrid] row-height redraw:", error);
            }
            if (holder) holder.scrollTop = scrollTop;
            grid.smart.scheduleVisibleRows();
            grid.smart.scheduleBottomCalcs();
          });
        if (ct && this.grid.table) {
          this.grid.stateStore.schedule();
          this.grid.emit("rowHeightChanged", { height });
        }
      }
    }
    destroy() {
      this.active = null;
      this.grid.root.classList.remove("bina-row-dragging");
      ab.removeEventListener("pointermove", this._move, true);
      ab.removeEventListener("pointerup", this._finish, true);
      ab.removeEventListener("pointercancel", this._finish, true);
      if (this._frame) cancelAnimationFrame(this._frame);
    }
  }
  function themeHex(c) {
    return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)
      ? c.toUpperCase()
      : null;
  }
  function themeRGB(c) {
    const v = themeHex(c) || "#FFFFFF";
    return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  }
  function themeMix(a, b, w) {
    const A = themeRGB(a),
      B = themeRGB(b),
      r = Math.max(0, Math.min(1, w));
    return (
      "#" +
      A.map((v, i) =>
        Math.round(v * (1 - r) + B[i] * r)
          .toString(16)
          .padStart(2, "0"),
      )
        .join("")
        .toUpperCase()
    );
  }
  function themeLuma(c) {
    const v = themeRGB(c).map((x) => {
      const n = x / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  }
  function themeContrastText(bg) {
    const l = themeLuma(bg);
    return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#06121D";
  }
  class ColumnManagerPanel {
    constructor(hQ) {
      this.grid = hQ;
      this.dragState = {
        active: false,
        pointerId: null,
        offsetX: 0,
        offsetY: 0,
      };
      this.pendingAlignments = new Set();
      this._buildDom();
      this._bind();
    }
    _buildDom() {
      const gU = this.grid.root;
      this.overlay = document.createElement("div");
      this.overlay.className = "bina-cm-overlay";
      this.panel = document.createElement("div");
      this.panel.className = "bina-cm";
      this.panel.setAttribute("aria-hidden", "true");
      this.panel.innerHTML =
        "<header><span>مدیریت ستون‌ها</span>" +
        '<span class="bina-cm-actions">' +
        '<button type="button" class="bina-cm-theme-button bina-cm-theme-soft" aria-label="رنگ روشن تم گرید" title="رنگ روشن زمینه، ردیف‌ها و جمع‌ها"><span class="bina-cm-theme-chip"></span></button>' +
        '<button type="button" class="bina-cm-theme-button bina-cm-theme-strong" aria-label="رنگ تیره تم گرید" title="رنگ تیره عنوان‌ها و بخش‌های تأکیدی"><span class="bina-cm-theme-chip"></span></button>' +
        '<select class="bina-cm-title-font" title="اندازه فونت عنوان همه ستون‌ها" aria-label="اندازه فونت عنوان همه ستون‌ها"></select>' +
        '<button type="button" class="bina-cm-title-bold" aria-pressed="false" title="بولد عنوان همه ستون‌ها" aria-label="بولد عنوان همه ستون‌ها">B</button>' +
        '<button type="button" class="bina-cm-reset" title="بازنشانی تنظیمات ستون‌ها و رنگ‌بندی گرید">بازنشانی</button>' +
        '<button type="button" class="bina-cm-close" title="بستن (Esc)">✕</button>' +
        "</span></header>" +
        '<div class="bina-cm-list"></div>';
      gU.appendChild(this.overlay);
      gU.appendChild(this.panel);
      this.list = this.panel.querySelector(".bina-cm-list");
      this.header = this.panel.querySelector("header");
      const titleFont = this.panel.querySelector(".bina-cm-title-font");
      titleFont.appendChild(new Option("فونت", ""));
      for (let size = aq.manualMin; size <= aq.manualMax; size++)
        titleFont.appendChild(new Option(String(size), String(size)));
      this._syncThemeButtons();
      this._syncTitleControls();
    }
    _syncThemeButtons() {
      const palette = this.grid.themeColors || {};
      const light = this.panel.querySelector(
        ".bina-cm-theme-soft .bina-cm-theme-chip",
      );
      const dark = this.panel.querySelector(
        ".bina-cm-theme-strong .bina-cm-theme-chip",
      );
      if (light) light.style.backgroundColor = palette.soft || "#DBEAFE";
      if (dark) dark.style.backgroundColor = palette.strong || "#2563EB";
    }
    _syncTitleControls() {
      const style = this.grid.titleStyle || {};
      const select = this.panel.querySelector(".bina-cm-title-font");
      const bold = this.panel.querySelector(".bina-cm-title-bold");
      if (select)
        select.value = style.fontSize === null ? "" : String(style.fontSize);
      if (bold) {
        const checked = style.bold === true;
        bold.setAttribute("aria-pressed", String(checked));
        bold.classList.toggle("is-active", checked);
      }
    }
    _openThemePicker(kind) {
      const btn = this.panel.querySelector(
        kind === "soft" ? ".bina-cm-theme-soft" : ".bina-cm-theme-strong",
      );
      if (!btn) return;
      ensureSharedColorPalette()
        .then((p) => {
          p.open({
            anchor: btn,
            type: kind === "soft" ? "background" : "text",
            value:
              this.grid.themeColors?.[kind] ||
              (kind === "soft" ? "#DBEAFE" : "#2563EB"),
            getValue: () =>
              this.grid.themeColors?.[kind] ||
              (kind === "soft" ? "#DBEAFE" : "#2563EB"),
            onChange: (hex) => {
              this.grid.setThemeColor(kind, hex);
              this._syncThemeButtons();
            },
          });
        })
        .catch((err) => {
          console.warn("[BinaGrid] theme palette:", err);
          this.grid._toast("پالت رنگ مشترک پیدا نشد");
        });
    }
    _bind() {
      const cO = this;
      this.panel
        .querySelector(".bina-cm-theme-soft")
        .addEventListener("click", () => this._openThemePicker("soft"));
      this.panel
        .querySelector(".bina-cm-theme-strong")
        .addEventListener("click", () => this._openThemePicker("strong"));
      this.panel
        .querySelector(".bina-cm-title-font")
        .addEventListener("change", (e) => {
          this.grid.setTitleFontSize(e.currentTarget.value);
          this._syncTitleControls();
        });
      this.panel
        .querySelector(".bina-cm-title-bold")
        .addEventListener("click", () => {
          this.grid.setTitleBold(!this.grid.titleStyle.bold);
          this._syncTitleControls();
        });
      this.panel
        .querySelector(".bina-cm-close")
        .addEventListener("click", function () {
          cO.close();
        });
      this.panel
        .querySelector(".bina-cm-reset")
        .addEventListener("click", async function (gV) {
          const c0 = gV.currentTarget;
          if (c0.disabled) return;
          c0.disabled = true;
          try {
            await cO.reset();
          } catch (gW) {
            console.error("[BinaGrid] column manager reset failed", gW);
            cO.grid._toast("بازنشانی ستون‌ها ناموفق بود");
          } finally {
            c0.disabled = false;
          }
        });
      this.overlay.addEventListener("click", function () {
        cO.close();
      });
      this.header.addEventListener("pointerdown", function (e) {
        cO._startDrag(e);
      });
      this.header.addEventListener("pointermove", function (e) {
        cO._moveDrag(e);
      });
      this.header.addEventListener("pointerup", function (e) {
        cO._stopDrag(e);
      });
      this.header.addEventListener("pointercancel", function (e) {
        cO._stopDrag(e);
      });
    }
    isOpen() {
      return this.panel.classList.contains("open");
    }
    open() {
      this.build();
      this._syncTitleControls();
      this.panel.classList.add("open");
      this.overlay.classList.add("open");
      this.panel.setAttribute("aria-hidden", "false");
      this.grid.emit("columnManagerToggled", { open: true });
    }
    close() {
      this.panel.classList.remove("open");
      this.overlay.classList.remove("open");
      this.panel.setAttribute("aria-hidden", "true");
      this.grid.emit("columnManagerToggled", { open: false });
    }
    _displayTitle(c1) {
      const field = c1.getField();
      const cP = c1.getElement()?.querySelector(".tabulator-col-title");
      const cu = cP?.textContent?.trim();
      const bL = c1.getDefinition();
      return (
        cu ||
        (this.grid.options.captions && this.grid.options.captions[field]) ||
        (typeof bL.title === "string"
          ? bL.title.replace(/<[^>]*>/g, "").trim()
          : "") ||
        field
      );
    }
    build() {
      const aA = this;
      this.list.textContent = "";
      const cv = document.createElement("div");
      cv.className = "bina-cm-row bina-cm-heading";
      [
        ["فیلد", "عنوان نمایشی ستون در گرید"],
        ["نمایش", "نمایش یا مخفی کردن ستون"],
        ["فریز", "ثابت نگه‌داشتن این ستون و ستون‌های قبل از آن"],
        ["تراز", "با کلیک، ترازبندی این ستون بین راست، وسط و چپ تغییر می‌کند"],
        ["فونت", "اندازه فونت محتوای ستون (حالت خالی = اندازه پیش‌فرض)"],
        ["بولد", "درشت‌نویسی محتوای ستون"],
        ["متن", "تغییر رنگ متن ستون"],
        ["زمینه", "تغییر رنگ پس‌زمینه ستون"],
      ].forEach(function ([label, help]) {
        const gb = document.createElement("span");
        gb.textContent = label;
        gb.title = help;
        cv.appendChild(gb);
      });
      this.list.appendChild(cv);
      this.grid.getManagedcolumns().forEach(function (cw) {
        const field = cw.getField();
        const c2 = cw.getDefinition();
        const bm = aA.grid.getColumnState(field);
        const aa = aA._displayTitle(cw);
        bm.visible = cw.isVisible();
        bm.frozen = c2.frozen === true;
        const hR = document.createElement("div");
        hR.className = "bina-cm-row";
        const d9 = document.createElement("span");
        d9.className = "bina-cm-name";
        d9.dir = "auto";
        d9.textContent = aa;
        d9.title = aa === field ? aa : aa + " (" + field + ")";
        const cx = aA._checkbox(
          bm.visible,
          "نمایش ستون «" + aa + "»",
          function () {
            bm.visible = cx.checked;
            const a$ = aA.grid.table.getColumn(field);
            if (cx.checked) a$?.show();
            else a$?.hide();
          },
        );
        const cy = aA._checkbox(
          bm.frozen,
          "فریز ستون «" + aa + "» و ستون‌های قبل از آن",
          function () {
            cy.disabled = true;
            aA.setFrozenRange(field, cy.checked)
              .then(function () {
                aA.build();
              })
              .catch(function (gX) {
                console.error("[BinaGrid] freeze failed", gX);
                aA.grid._toast("تغییر فریز ناموفق بود");
              })
              .finally(function () {
                cy.disabled = false;
              });
          },
        );
        const gY = aA._alignment(
          aA.grid.getEffectiveAlignment(field),
          aa,
          function (gc) {
            return aA.applyAlignment(field, gc);
          },
        );
        const gZ = aA._fontSize(
          bm.fontSize,
          "اندازه فونت ستون «" + aa + "» (پیش‌فرض یا ۹ تا ۲۴ پیکسل)",
          function () {
            aA.applyFontSize(field, gZ.value);
          },
        );
        const g_ = aA._checkbox(
          bm.bold === true,
          "بولد کردن متن ستون «" + aa + "»",
          function () {
            aA.applyBold(field, g_.checked);
          },
        );
        const fg = aA._color(
          bm.foreground,
          "text",
          "رنگ متن ستون «" + aa + "»",
          function (g$) {
            const a0 = aA.grid.table.getColumn(field);
            if (a0) aA.applyColor(a0, "foreground", g$);
          },
        );
        const bg = aA._color(
          bm.background,
          "background",
          "رنگ زمینه ستون «" + aa + "»",
          function (g0) {
            const a1 = aA.grid.table.getColumn(field);
            if (a1) aA.applyColor(a1, "background", g0);
          },
        );
        hR.append(d9, cx, cy, gY, gZ, g_, fg, bg);
        aA.list.append(hR);
      });
    }
    async setFrozenRange(cQ, e6) {
      const c3 = this.grid.getManagedcolumns().map(function (c) {
        return c.getField();
      });
      const aE = c3.indexOf(cQ);
      if (aE < 0) return;
      const b6 = e6 ? aE : aE - 1;
      for (let dy = 0; dy < c3.length; dy += 1) {
        const field = c3[dy];
        const ea = this.grid.getColumnState(field);
        ea.frozen = dy <= b6;
        const c4 = this.grid.table.getColumn(field);
        if (!c4) continue;
        const eb = c4.getDefinition().frozen === true;
        if (eb !== ea.frozen) {
          await c4.updateDefinition({ frozen: ea.frozen });
        }
      }
      requestAnimationFrame(() => this.grid.smart.scheduleVisibleRows());
      this.grid.stateStore.schedule();
    }
    applyColor(gd, hS, g1) {
      if (hS !== "foreground" && hS !== "background") return;
      const field = gd.getField();
      this.grid.getColumnState(field)[hS] = g1 || null;
      this.grid.applyColumnColors(field);
      this.grid.stateStore.schedule();
    }
    _alignment(e7, cz, ec) {
      const al = document.createElement("button");
      al.type = "button";
      al.className = "bina-cm-align";
      al.innerHTML =
        '<svg viewBox="0 0 24 20" width="19" height="16" aria-hidden="true">' +
        '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
      const hT = al.querySelector("path");
      const ge = { right: "راست‌چین", center: "وسط‌چین", left: "چپ‌چین" };
      const dL = {
        right: "M3 4H21 M9 10H21 M5 16H21",
        center: "M3 4H21 M7 10H17 M5 16H19",
        left: "M3 4H21 M3 10H15 M3 16H19",
      };
      let ag = e7;
      const cA = () => {
        hT.setAttribute("d", dL[ag]);
        const help = "تراز «" + cz + "»: " + ge[ag] + " — کلیک برای تغییر";
        al.title = help;
        al.setAttribute("aria-label", help);
        al.dataset.align = ag;
      };
      al.addEventListener("click", async () => {
        if (al.disabled) return;
        const ed = ag;
        ag = ag === "right" ? "center" : ag === "center" ? "left" : "right";
        cA();
        al.disabled = true;
        try {
          await ec(ag);
        } catch (g2) {
          ag = ed;
          cA();
          console.error("[BinaGrid] alignment failed:", g2);
          this.grid._toast("تغییر تراز ستون انجام نشد");
        } finally {
          al.disabled = false;
        }
      });
      cA();
      return al;
    }
    applyAlignment(field, g3) {
      const e8 = this.grid;
      const ee = e8.getColumnState(field);
      const ef = ee.align;
      ee.align = normalizedColumnAlignment(g3);
      const aY = e8
        .syncColumnAlignment(field)
        .then(() => {
          e8.stateStore.schedule();
        })
        .catch(async (g4) => {
          ee.align = ef;
          try {
            await e8.syncColumnAlignment(field);
          } catch (_) {}
          throw g4;
        });
      this.pendingAlignments.add(aY);
      aY.finally(() => this.pendingAlignments.delete(aY)).catch(() => {});
      return aY;
    }
    applyBold(field, e9) {
      const c5 = this.grid;
      const eg = c5.getColumnState(field);
      eg.bold = e9 === true;
      const cB = c5.table.getColumn(field);
      if (cB) {
        cB.getCells().forEach(function (hU) {
          const cC = hU.getElement();
          if (!cC) return;
          cC.dataset.binaField = field;
          c5.smart.applyBoldToText(cC.querySelector(".smart"), eg.bold);
        });
      }
      c5.smart.applyRenderedColumnBold(field, eg.bold);
      c5.smart.scheduleBottomCalcs(field);
      if (cB) c5.smart.scheduleColumn(cB);
      c5.stateStore.schedule();
    }
    async reset() {
      const ba = this.grid;
      if (this.pendingAlignments.size) {
        await Promise.allSettled([...this.pendingAlignments]);
      }
      const eh = ba.getManagedcolumns().map((gf) => gf.getField());
      const cD = ba.restoring;
      ba.stateStore.cancelPending();
      ba.restoring = true;
      try {
        for (const field of eh) {
          let aT = ba.table.getColumn(field);
          if (!aT) continue;
          const bM = ba.getColumnState(field);
          bM.visible = true;
          bM.frozen = false;
          bM.foreground = null;
          bM.background = null;
          bM.fontSize = null;
          bM.bold = false;
          bM.align = "center";
          aT.show();
          if (aT.getDefinition().frozen === true) {
            await aT.updateDefinition({ frozen: false });
            aT = ba.table.getColumn(field) || aT;
          }
          aT = (await ba.syncColumnAlignment(field)) || aT;
          ba.applyColumnColors(field);
        }
      } finally {
        ba.restoring = cD;
      }
      ba.themeColors = { strong: null, soft: null };
      ba._applyTheme();
      ba.titleStyle = { fontSize: null, bold: false };
      ba._applyTitleStyle();
      this._syncTitleControls();
      ba.smart.resetRenderedFonts();
      for (const field of eh) {
        ba.smart.applyRenderedBottomCalcAlignment(
          field,
          ba.getEffectiveAlignment(field),
        );
      }
      ba.stateStore.saveNow();
      this.build();
      ba._toast("تنظیمات ستون‌ها بازنشانی شد");
    }
    _checkbox(fb, fJ, ei) {
      const ce = document.createElement("input");
      ce.type = "checkbox";
      ce.checked = fb;
      ce.title = fJ;
      ce.setAttribute("aria-label", fJ);
      ce.addEventListener("change", ei);
      return ce;
    }
    _color(ej, g5, fK, ek) {
      const aL = document.createElement("button");
      aL.type = "button";
      aL.className = "bina-cm-color-button";
      aL.title = fK;
      aL.setAttribute("aria-label", fK);
      aL.setAttribute("aria-haspopup", "dialog");
      const cE = document.createElement("span");
      cE.className = "bina-cm-color-chip";
      aL.appendChild(cE);
      const em = g5 === "text" ? a3 : a4;
      const bN = (eo) => {
        cE.style.backgroundColor = eo || em;
        cE.classList.toggle("is-default", !eo);
      };
      bN(ej);
      aL.addEventListener("click", () => {
        ensureSharedColorPalette()
          .then((fc) => {
            fc.open({
              anchor: aL,
              type: g5,
              value: cE.dataset.value !== undefined ? cE.dataset.value : ej,
              getValue: () =>
                cE.dataset.value !== undefined ? cE.dataset.value : ej,
              onChange: (c6) => {
                bN(c6);
                cE.dataset.value = c6 || "";
                ek(c6);
              },
            });
          })
          .catch((g6) => {
            console.warn("[BinaGrid] Shared color palette:", g6.message);
            this.grid._toast("فایل com_color.js در کنار گرید قرار نگرفته است");
          });
      });
      return aL;
    }
    _fontSize(fL, fM, ep) {
      const aU = document.createElement("select");
      aU.className = "bina-cm-font";
      aU.title = fM;
      aU.setAttribute("aria-label", fM);
      const fd = new Option("", "");
      aU.appendChild(fd);
      for (let fe = aq.manualMin; fe <= aq.manualMax; fe += 1) {
        aU.appendChild(new Option(String(fe), String(fe)));
      }
      aU.value = normalizedColumnFontSize(fL) === null ? "" : String(fL);
      aU.addEventListener("change", ep);
      return aU;
    }
    applyFontSize(field, g7) {
      const g8 = this.grid.getColumnState(field);
      g8.fontSize = normalizedColumnFontSize(g7);
      const eq = this.grid.table.getColumn(field);
      if (eq) {
        g8.baseWidth = eq.getWidth() || Number(eq.getDefinition().width) || 100;
        this.grid.smart.scheduleColumn(eq);
      }
      this.grid.smart.scheduleBottomCalcs(field);
      this.grid.stateStore.schedule();
    }
    _clampPosition(hV, iR) {
      const bt = 8;
      const ff = Math.max(bt, window.innerWidth - this.panel.offsetWidth - bt);
      const gg = Math.max(
        bt,
        window.innerHeight - this.panel.offsetHeight - bt,
      );
      return {
        left: Math.min(Math.max(bt, hV), ff),
        top: Math.min(Math.max(bt, iR), gg),
      };
    }
    _startDrag(bO) {
      if (bO.button !== 0 || !this.isOpen()) return;
      if (bO.target.closest('button, input, select, a, [role="button"]'))
        return;
      const fh = this.panel.getBoundingClientRect();
      this.dragState.active = true;
      this.dragState.pointerId = bO.pointerId;
      this.dragState.offsetX = bO.clientX - fh.left;
      this.dragState.offsetY = bO.clientY - fh.top;
      this.panel.style.left = fh.left + "px";
      this.panel.style.top = fh.top + "px";
      this.panel.style.transform = "none";
      this.panel.classList.add("dragging");
      this.header.setPointerCapture(bO.pointerId);
      bO.preventDefault();
    }
    _moveDrag(er) {
      if (!this.dragState.active || er.pointerId !== this.dragState.pointerId)
        return;
      const ix = this._clampPosition(
        er.clientX - this.dragState.offsetX,
        er.clientY - this.dragState.offsetY,
      );
      this.panel.style.left = ix.left + "px";
      this.panel.style.top = ix.top + "px";
    }
    _stopDrag(es) {
      if (!this.dragState.active || es.pointerId !== this.dragState.pointerId)
        return;
      this.dragState.active = false;
      this.dragState.pointerId = null;
      this.panel.classList.remove("dragging");
      if (this.header.hasPointerCapture(es.pointerId)) {
        this.header.releasePointerCapture(es.pointerId);
      }
    }
  }
  class GridStateStore {
    constructor(hW) {
      this.grid = hW;
      this.timer = 0;
    }
    key() {
      return (
        this.grid.options.storagePrefix +
        "." +
        (this.grid.tableName || "default") +
        "." +
        (this.grid.fieldSignature || "none") +
        ".v1"
      );
    }
    read() {
      try {
        const iy = localStorage.getItem(this.key());
        if (!iy) return null;
        const c7 = JSON.parse(iy);
        return c7 && c7.version === 1 ? c7 : null;
      } catch (e) {
        console.warn("[BinaGrid] settings read failed", e);
        return null;
      }
    }
    serializableFilters() {
      try {
        return this.grid.table
          .getFilters()
          .filter(function (f) {
            return typeof f.type !== "function";
          })
          .map(function (f) {
            return { field: f.field, type: f.type, value: f.value };
          });
      } catch (e) {
        return [];
      }
    }
    sanitizeLayout(et) {
      if (!Array.isArray(et)) return [];
      return et
        .filter((g9) => g9 && g9.field)
        .map(function (hX) {
          const bP = Object.assign({}, hX);
          delete bP.title;
          if (bP.field) bP.minWidth = 1;
          if (Array.isArray(bP.columns))
            bP.columns = this.sanitizeLayout(bP.columns);
          return bP;
        }, this);
    }
    layoutMatches(eu) {
      if (!eu || !Array.isArray(eu.columnLayout)) return false;
      const bz = eu.columnLayout
        .map(function (c) {
          return c && c.field;
        })
        .filter(Boolean)
        .sort();
      const aF = this.grid
        .getManagedcolumns()
        .map(function (c) {
          return c.getField();
        })
        .sort();
      if (aF.length !== bz.length) return false;
      for (let i = 0; i < aF.length; i++) {
        if (aF[i] !== bz[i]) return false;
      }
      return true;
    }
    collect() {
      const c8 = this.grid;
      const a2 = {};
      c8.getManagedcolumns().forEach(function (ev) {
        const field = ev.getField();
        const cf = c8.getColumnState(field);
        a2[field] = {
          foreground: cf.foreground,
          background: cf.background,
          fontSize: normalizedColumnFontSize(cf.fontSize),
          bold: cf.bold === true,
          align: normalizedColumnAlignment(cf.align),
          baseWidth: cf.baseWidth,
          frozen: ev.getDefinition().frozen === true,
        };
      });
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        rowMinHeight: c8.rowSizer?.height ?? 30,
        rowHeightFixed: c8.rowSizer?.userSized === true,
        gridTheme: {
          strong: c8.themeColors?.strong || null,
          soft: c8.themeColors?.soft || null,
        },
        titleStyle: {
          fontSize: normalizedColumnFontSize(c8.titleStyle?.fontSize),
          bold: c8.titleStyle?.bold === true,
        },
        columnLayout: this.sanitizeLayout(c8.table.getColumnLayout()),
        customcolumns: a2,
        headerFilters: c8.table.getHeaderFilters().map(function (f) {
          return { field: f.field, value: f.value };
        }),
        sorters: c8.table.getSorters().map(function (s) {
          return { column: s.field, dir: s.dir };
        }),
        filters: this.serializableFilters(),
      };
    }
    saveNow() {
      if (this.grid.restoring || !this.grid.table) return;
      try {
        localStorage.setItem(this.key(), JSON.stringify(this.collect()));
      } catch (e) {
        console.warn("[BinaGrid] settings save failed", e);
      }
    }
    schedule() {
      if (this.grid.restoring || !this.grid.table) return;
      clearTimeout(this.timer);
      const iS = this.key();
      const fi = this.collect();
      this.timer = setTimeout(function () {
        try {
          localStorage.setItem(iS, JSON.stringify(fi));
        } catch (e) {
          console.warn("[BinaGrid] settings save failed", e);
        }
      }, 250);
    }
    cancelPending() {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    async restore() {
      const aJ = this.grid;
      const ah = this.read();
      if (!ah) return;
      aJ.restoring = true;
      try {
        aJ.themeColors = {
          strong: themeHex(ah.gridTheme?.strong),
          soft: themeHex(ah.gridTheme?.soft),
        };
        aJ._applyTheme();
        aJ.titleStyle = {
          fontSize: normalizedColumnFontSize(ah.titleStyle?.fontSize),
          bold: ah.titleStyle?.bold === true,
        };
        aJ._applyTitleStyle();
        aJ.columnManager?._syncTitleControls();
        if (Number.isFinite(Number(ah.rowMinHeight))) {
          aJ.rowSizer.userSized =
            ah.rowHeightFixed === true ||
            (ah.rowHeightFixed === undefined && Number(ah.rowMinHeight) !== 30);
          aJ.rowSizer.setHeight(ah.rowMinHeight, false);
        }
        const bn = ah.customcolumns || {};
        Object.keys(bn).forEach(function (field) {
          if (!aJ.table.getColumn(field)) return;
          const bQ = bn[field];
          const bR = aJ.getColumnState(field);
          bR.foreground = bQ?.foreground ?? null;
          bR.background = bQ?.background ?? null;
          bR.fontSize = normalizedColumnFontSize(bQ?.fontSize);
          bR.bold = bQ?.bold === true;
          bR.align = normalizedColumnAlignment(bQ?.align);
          bR.baseWidth = Number(bQ?.baseWidth) || 0;
          bR.frozen = bQ?.frozen === true;
        });
        const bo = this.layoutMatches(ah);
        if (bo && ah.columnLayout.length) {
          aJ.table.setColumnLayout(this.sanitizeLayout(ah.columnLayout));
        }
        await aJ._ensureSelectorColumn();
        await this._restoreFrozen(ah);
        await aJ.syncColumnKindsAndCalcs();
        for (const field of aJ.getManagedcolumns().map((gh) => gh.getField())) {
          const fN = aJ.getColumnState(field);
          const c9 = await aJ.syncColumnAlignment(field);
          if (!c9) continue;
          aJ.applyColumnColors(field);
          c9.getCells().forEach((hY) => {
            const ha = hY.getElement()?.querySelector(".smart");
            if (ha) aJ.smart.applyBoldToText(ha, fN.bold);
          });
          aJ.smart.applyRenderedColumnBold(field, fN.bold);
          aJ.smart.scheduleColumn(c9);
        }
        if (bo && Array.isArray(ah.filters) && ah.filters.length) {
          aJ._customFilters = ah.filters.slice();
          aJ._applyDataFilters();
        }
        if (bo && Array.isArray(ah.headerFilters)) {
          ah.headerFilters.forEach(function (f) {
            if (!f?.field) return;
            aJ.table.setHeaderFilterValue(f.field, f.value ?? "");
          });
        }
        if (bo && Array.isArray(ah.sorters) && ah.sorters.length) {
          aJ.table.setSort(ah.sorters);
        }
      } catch (e) {
        console.warn("[BinaGrid] settings restore failed", e);
      } finally {
        aJ.restoring = false;
      }
    }
    async _restoreFrozen(hb) {
      const gi = this.grid;
      const cF = hb.customcolumns || {};
      const dz = gi.getManagedcolumns();
      let am = null;
      dz.forEach(function (ew) {
        if (cF[ew.getField()]?.frozen === true) am = ew.getField();
      });
      if (am) {
        await gi.columnManager.setFrozenRange(am, true);
        return;
      }
      const bS = dz[0]?.getField();
      if (bS) await gi.columnManager.setFrozenRange(bS, false);
    }
  }
  class GridSelection {
    constructor(hZ) {
      this.grid = hZ;
      this._painted = [];
      this.clear();
    }
    clear() {
      this.cells = new Map();
      this.rows = new Set();
      this.active = null;
      this.anchor = null;
      this.rowAnchor = null;
      this.cursorKey = null;
      this.paint();
      this.grid._emitSelectionChanged();
    }
    rowKey(iT) {
      return String(iT.getIndex());
    }
    setActive(hc) {
      const h_ = hc.getRow();
      const field = hc.getField();
      this.cursorKey = this.rowKey(h_);
      this.active = { row: h_, field: field };
      this.anchor = { rowKey: this.rowKey(h_), field: field };
      const iU = this.rowKey(h_);
      this.cells = new Map([[iU, new Set([field])]]);
      this.rows.clear();
      this.paint();
      this.grid._emitSelectionChanged();
    }
    extendTo(h$) {
      this.setActive(h$);
    }
    setOnlyRow(iV) {
      const iz = this.rowKey(iV);
      this.cursorKey = iz;
      this.rows = new Set([iz]);
      this.cells.clear();
      this.active = null;
      this.anchor = null;
      this.rowAnchor = iz;
      this.paint();
      this.grid._emitSelectionChanged();
    }
    selectRowRange(iA, ex = false) {
      this.cursorKey = this.rowKey(iA);
      const cG = this.grid.table.getRows("visible");
      const h0 = cG.findIndex((r) => this.rowKey(r) === this.rowKey(iA));
      const da = cG.findIndex((r) => this.rowKey(r) === this.rowAnchor);
      if (h0 < 0 || da < 0) {
        this.setOnlyRow(iA);
        return;
      }
      if (!ex) this.rows.clear();
      for (let ey = Math.min(da, h0); ey <= Math.max(da, h0); ey++) {
        this.rows.add(this.rowKey(cG[ey]));
      }
      this.cells.clear();
      this.active = null;
      this.anchor = null;
      this.paint();
      this.grid._emitSelectionChanged();
    }
    toggleRow(h1) {
      this.setRowSelected(h1, !this.rows.has(this.rowKey(h1)));
      this.rowAnchor = this.rowKey(h1);
    }
    setRowSelected(iW, fj) {
      const iB = this.rowKey(iW);
      if (fj) this.rows.add(iB);
      else this.rows.delete(iB);
      this.cursorKey = fj ? iB : Array.from(this.rows).pop() || null;
      this.cells.clear();
      this.active = null;
      this.anchor = null;
      this.paint();
      this.grid._emitSelectionChanged();
    }
    setVisibleRowsSelected(fk) {
      const visible = this.grid.table.getRows("visible");
      this.cursorKey = fk && visible.length ? this.rowKey(visible[0]) : null;
      for (const iX of visible) {
        const iC = this.rowKey(iX);
        if (fk) this.rows.add(iC);
        else this.rows.delete(iC);
      }
      this.cells.clear();
      this.active = null;
      this.anchor = null;
      this.paint();
      this.grid._emitSelectionChanged();
    }
    selectAllPage() {
      const hd = this;
      this.rows = new Set();
      this.cells = new Map();
      this.active = null;
      this.anchor = null;
      const visible = this.grid.table.getRows("visible");
      this.cursorKey = visible.length ? this.rowKey(visible[0]) : null;
      visible.forEach(function (iY) {
        hd.rows.add(hd.rowKey(iY));
      });
      this.paint();
      this.grid._emitSelectionChanged();
    }
    selectAllActive() {
      const rows = this.grid.table.getRows("active");
      this.rows = new Set(rows.map((row) => this.rowKey(row)));
      this.cells.clear();
      this.active = null;
      this.anchor = null;
      this.rowAnchor = null;
      this.cursorKey = rows.length ? this.rowKey(rows[0]) : null;
      this.paint();
      this.grid._emitSelectionChanged();
    }
    paint() {
      this.grid.tableEl
        ?.querySelectorAll(".bina-sel,.bina-active,.bina-row-sel")
        .forEach((el) => {
          el.classList.remove("bina-sel", "bina-active", "bina-row-sel");
        });
      this._painted = [];
      this._paintedRows = [];
      if (!this.grid.table || !this.grid.table.modExists("page")) return;
      let bA;
      try {
        bA = this.grid.table.getRows("visible");
      } catch (_) {
        return;
      }
      for (const h2 of bA) {
        const dA = h2.getElement();
        if (!dA || !dA.isConnected) continue;
        const h3 = this.rowKey(h2);
        if (this.rows.has(h3)) {
          dA.classList.add("bina-row-sel");
          this._paintedRows.push(dA);
        }
        const ez = this.cells.get(h3);
        if (!ez) continue;
        for (const gj of h2.getCells()) {
          if (!ez.has(gj.getField())) continue;
          const el = gj.getElement();
          if (!el || !el.isConnected) continue;
          el.classList.add("bina-sel");
          this._painted.push(el);
          if (
            this.active &&
            this.active.field === gj.getField() &&
            this.rowKey(this.active.row) === h3
          ) {
            el.classList.add("bina-active");
          }
        }
      }
      this.grid._syncSelectorChecks();
    }
    buildTsv(db) {
      const he = this.grid;
      const dc = he.getVisibleFields();
      const dd = he.table.getRows("active");
      const dB = [];
      if (db) dB.push(dc.join("\t"));
      dd.forEach((iD) => {
        const h4 = this.rowKey(iD);
        const hf = iD.getData();
        if (this.rows.has(h4)) {
          dB.push(dc.map((f) => hf[f] ?? "").join("\t"));
        } else if (this.cells.has(h4)) {
          const iZ = this.cells.get(h4);
          const gk = dc.filter((f) => iZ.has(f));
          dB.push(gk.map((f) => hf[f] ?? "").join("\t"));
        }
      });
      return dB.join("\r\n");
    }
    copy(bT) {
      if (!this.cells.size && !this.rows.size) return null;
      let h5, bu;
      if (this.cells.size === 1 && this.rows.size === 0 && !bT) {
        const fO = this.cells.entries().next().value;
        const i_ = fO[1];
        const gl = fO[0];
        const hg = this._rowDataByKey(gl);
        if (!hg) return null;
        h5 = [...i_].map((f) => hg[f] ?? "").join("");
        bu = 1;
      } else {
        h5 = this.buildTsv(bT);
        bu = this._countSelectedCells();
      }
      return { text: h5, cells: bu, rows: this.cells.size + this.rows.size };
    }
    _rowDataByKey(gm) {
      const iE = this.grid.table
        .getRows("active")
        .find((r) => this.rowKey(r) === gm);
      return iE ? iE.getData() : null;
    }
    _countSelectedCells() {
      let n = 0;
      this.cells.forEach(function (i$) {
        n += i$.size;
      });
      this.rows.forEach((i0) => {
        const h6 = this._rowDataByKey(i0);
        if (h6) n += this.grid.getVisibleFields().length;
      }, this);
      return n;
    }
    getSelectedData() {
      const gn = this;
      const iF = [];
      this.grid.table.getRows("active").forEach(function (iG) {
        const iH = gn.rowKey(iG);
        if (gn.rows.has(iH) || gn.cells.has(iH)) iF.push(iG.getData());
      });
      return iF;
    }
  }
  const bU = {
    EsmSherkat: { width: 120, minWidth: 80, kind: "number" },
    SalMali: { width: 110, minWidth: 75, kind: "number" },
    ShomarehSanad: { width: 140, minWidth: 90, kind: "number" },
    Tarikh: { width: 130, minWidth: 90, kind: "text" },
    KOl_Code: { width: 110, minWidth: 75, kind: "number" },
    KOl_Onvan: { width: 240, minWidth: 110, kind: "text" },
    Moien_Code: { width: 120, minWidth: 80, kind: "number" },
    Moien_Onvan: { width: 300, minWidth: 120, kind: "text" },
    Tafsil_Code: { width: 130, minWidth: 85, kind: "number" },
    Tafsil_Onvan: { width: 300, minWidth: 120, kind: "text" },
    SharhSanad: { width: 340, minWidth: 130, kind: "text" },
    Bedehkar: { width: 160, minWidth: 100, kind: "number" },
    Bestankar: { width: 160, minWidth: 100, kind: "number" },
    Company: { width: 120, minWidth: 80, kind: "number" },
    Id: { width: 100, minWidth: 75, kind: "number" },
    Tedad: { width: 110, minWidth: 75, kind: "number" },
  }; /* BINA Grid: stable external stylesheet at FINAL/css/bina-grid.css. */
  const binaGridStylesheetUrl = (() => {
    const scriptSrc = document.currentScript?.src;
    try {
      return new URL(
        "../../css/com_grid.css?v=1.2.61",
        scriptSrc || document.baseURI,
      ).href;
    } catch (_) {
      return "../../css/com_grid.css?v=1.2.61";
    }
  })();
  let bB = false;
  function injectCss() {
    if (bB) return;
    // Respect an explicit stylesheet link supplied by a host form.
    const wanted = new URL(binaGridStylesheetUrl, document.baseURI).pathname;
    for (const link of document.querySelectorAll('link[rel~="stylesheet"]')) {
      try {
        if (new URL(link.href, document.baseURI).pathname === wanted) {
          bB = true;
          return;
        }
      } catch (_) {
        /* Ignore unrelated or malformed links. */
      }
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = binaGridStylesheetUrl;
    link.dataset.binaGridCss = "1.2.61";
    link.addEventListener("error", () =>
      console.error(
        "[BinaGrid] بنا به مسیر فایل، com_grid.css بارگذاری نشد:",
        link.href,
      ),
    );
    document.head.appendChild(link);
    bB = true;
  }
  class BinaGrid {
    constructor(aZ, fl = {}) {
      if (typeof Tabulator === "undefined") {
        throw new Error(
          "Tabulator بارگذاری نشده — ابتدا tabulator.min.css و tabulator.min.js را ضمیمه کن.",
        );
      }
      injectCss();
      const eB = typeof aZ === "string" ? document.querySelector(aZ) : aZ;
      if (!eB) throw new Error("کانتینر گرید پیدا نشد: " + aZ);
      this.options = Object.assign(
        {
          pageSize: 100,
          pageSizeOptions: [100, 500, 1000, 5000, true],
          rtl: true,
          height: "740px",
          layout: "fitColumns",
          storagePrefix: "BinaGrid",
          locale: "fa-fa",
          presetcolumns: bU,
          movablecolumns: true,
          resizablecolumns: true,
          showToolbar: true,
          captions: null,
          noTranslateBody: false,
          rowSelector: true,
        },
        fl,
      );
      this.events = new EventBus();
      this.tableName = "";
      this.fieldSignature = "";
      this.columnState = new Map();
      this.fieldKinds = new Map();
      this.restoring = false;
      this._customFilters = [];
      this._searchText = "";
      this._searchTimer = 0;
      this._pageSizeRestored = false;
      this._destroyed = false;
      this.themeColors = { strong: null, soft: null };
      this.titleStyle = { fontSize: null, bold: false };
      this.root = document.createElement("div");
      this.root.className = "bina-grid";
      this.root.dir = getSidebarLanguage() === "en" ? "ltr" : "rtl";
      this.root.tabIndex = 0;
      this._applyTitleStyle();
      this._buildToolbar();
      this._buildWrap();
      eB.appendChild(this.root);
      this.smart = new SmartText(this);
      this.stateStore = new GridStateStore(this);
      this.selection = new GridSelection(this);
      this.rowSizer = new GridRowSizer(this);
      this.columnManager = new ColumnManagerPanel(this);
      this._initTable();
      this._wireEvents();
      this._toggleEmpty();
    }
    _applyTitleStyle() {
      if (!this.root) return;
      const size = normalizedColumnFontSize(this.titleStyle?.fontSize);
      const bold = this.titleStyle?.bold === true;
      this.root.classList.toggle("bina-title-size", size !== null);
      this.root.classList.toggle("bina-title-bold", bold);
      if (size !== null)
        this.root.style.setProperty("--bina-title-size", size + "px");
      else this.root.style.removeProperty("--bina-title-size");
    }
    setTitleFontSize(value) {
      this.titleStyle.fontSize = normalizedColumnFontSize(value);
      this._applyTitleStyle();
      this.stateStore?.schedule();
      this.columnManager?._syncTitleControls();
    }
    setTitleBold(enabled) {
      this.titleStyle.bold = enabled === true;
      this._applyTitleStyle();
      this.stateStore?.schedule();
      this.columnManager?._syncTitleControls();
    }
    setThemeColor(kind, color) {
      if (kind !== "strong" && kind !== "soft") return false;
      const valid = themeHex(color);
      if (!valid) return false;
      this.themeColors[kind] = valid;
      this._applyTheme();
      this.stateStore?.schedule();
      this.emit("themeChanged", { ...this.themeColors });
      return true;
    }
    _applyTheme() {
      if (!this.root) return;
      const theme = this.themeColors || {};
      const enabled = !!(theme.strong || theme.soft);
      this.root.classList.toggle("bina-themed", enabled);
      if (!enabled) {
        [
          "strong",
          "strong-edge",
          "on-strong",
          "soft",
          "soft-alt",
          "footer",
          "on-footer",
          "border",
          "on-soft",
          "hover",
        ].forEach((k) => this.root.style.removeProperty("--bina-theme-" + k));
        this.columnManager?._syncThemeButtons();
        return;
      }
      const strong = theme.strong || "#2563EB";
      const rawSoft = theme.soft || "#DBEAFE";
      const soft =
        themeLuma(rawSoft) < 0.66 ? themeMix(rawSoft, "#FFFFFF", 0.7) : rawSoft;
      const alt = themeMix(soft, strong, 0.075);
      const footer = themeMix(soft, strong, 0.17);
      const border = themeMix(soft, strong, 0.28);
      const hover = themeMix(soft, strong, 0.22);
      const strongEdge = themeMix(strong, "#0F172A", 0.12);
      const vars = {
        strong: strong,
        "strong-edge": strongEdge,
        "on-strong": themeContrastText(strong),
        soft: soft,
        "soft-alt": alt,
        footer: footer,
        "on-footer": themeContrastText(footer),
        border: border,
        "on-soft": themeContrastText(soft),
        hover: hover,
      };
      for (const [k, v] of Object.entries(vars))
        this.root.style.setProperty("--bina-theme-" + k, v);
      this.columnManager?._syncThemeButtons();
    }
    _buildToolbar() {
      this.toolbar = document.createElement("div");
      this.toolbar.className = "bina-toolbar";
      this.toolbar.innerHTML =
        '<input type="search" class="bina-search" placeholder="🔍 جست‌وجو در همهٔ ستون‌ها (Ctrl+F)…">' +
        '<button type="button" class="bina-btn bina-clear" title="حذف همهٔ فیلترها و جست‌وجو">✕ پاک‌کردن فیلترها</button>' +
        '<span class="bina-count">رکورد: ۰ از ۰</span>' +
        '<span class="bina-spacer"></span>' +
        '<button type="button" class="bina-btn" data-act="copy" title="کپی فقط رکوردهای انتخاب‌شده با هدر (TSV)">کپی</button>' +
        '<button type="button" class="bina-btn" data-act="print" title="چاپ وضعیت فعلی">🖨 چاپ</button>' +
        '<button type="button" class="bina-btn bina-btn-columns" data-act="columns" title="مدیریت نمایش ستون‌ها (کلیک راست روی هدر)" aria-label="مدیریت نمایش ستون‌ها">' +
        '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="4" width="18" height="16" rx="2.5"/>' +
        '<path d="M9 4v16M15 4v16M3 10h18M3 15h18"/>' +
        '<circle cx="9" cy="10" r="1.8" fill="currentColor" stroke="none"/>' +
        "</svg></button>";
      this.searchInput = this.toolbar.querySelector(".bina-search");
      this.countEl = this.toolbar.querySelector(".bina-count");
      if (!this.options.showToolbar) this.toolbar.style.display = "none";
      this.root.appendChild(this.toolbar);
    }
    _buildWrap() {
      const fm = document.createElement("div");
      fm.className = "bina-wrap";
      fm.style.height = this.options.height;
      this.tableEl = document.createElement("div");
      this.tableEl.className = "bina-table";
      this.emptyEl = document.createElement("div");
      this.emptyEl.className = "bina-empty";
      this.emptyEl.style.display = "none";
      this.emptyEl.innerHTML =
        "<b>داده‌ای برای نمایش نیست</b><span>کویری بزن یا با setData داده بده</span>";
      this.toastEl = document.createElement("div");
      this.toastEl.className = "bina-toast";
      fm.append(this.tableEl, this.emptyEl, this.toastEl);
      this.root.appendChild(fm);
    }
    _initTable() {
      this.table = new Tabulator(this.tableEl, {
        data: [],
        columns: [],
        index: "__id",
        movableColumns:
          this.options.movableColumns ?? this.options.movablecolumns,
        resizableColumnFit: false,
        renderVertical: "virtual",
        pagination: "local",
        paginationSize: this.options.pageSize,
        paginationSizeSelector: this.options.pageSizeOptions,
        paginationInitialPage: 1,
        paginationCounter: false,
        columnCalcs: "both",
        locale: this.options.locale,
        langs: {
          "fa-fa": {
            pagination: {
              page_size: "اندازه صفحه:",
              first: "اول",
              first_title: "صفحهٔ اول",
              prev: "قبلی",
              prev_title: "صفحهٔ قبل",
              next: "بعدی",
              next_title: "صفحهٔ بعد",
              last: "آخر",
              last_title: "صفحهٔ آخر",
              all: "همه",
              counter: {
                showing: "نمایش",
                of: "از",
                rows: "ردیف",
                pages: "صفحه",
              },
            },
            data: { loading: "در حال بارگذاری…", error: "خطا" },
            headerFilters: { default: "فیلتر…" },
          },
        },
        rowFormatter: (iI) => {
          this.rowSizer.install(iI);
          this.smart.syncRowHeight(iI);
        },
        columnDefaults: {
          minWidth: 1,
          vertAlign: "middle",
          resizable:
            this.options.resizableColumns ?? this.options.resizablecolumns,
          tooltip: true,
          formatter: (go, dT, bV) => {
            const gp = this.smart.cellFormatter(go);
            if (typeof bV === "function") bV(() => this.smart.scheduleCell(go));
            else requestAnimationFrame(() => this.smart.scheduleCell(go));
            return gp;
          },
        },
      });
    }
    _observeColumnWidths() {
      if (this._destroyed || typeof ResizeObserver === "undefined") return;
      if (!this._columnWidthObserver) {
        this._observedHeaders = new Map();
        this._columnWidthObserver = new ResizeObserver((fo) => {
          for (const hh of fo) {
            const bp = hh.target;
            const field =
              bp.getAttribute("tabulator-field") || bp.dataset.field;
            if (!field) continue;
            const eC = bp.getBoundingClientRect().width;
            const eD = this._observedHeaders.get(bp);
            if (Math.abs(eC - (eD ?? eC)) < 0.25) continue;
            this._observedHeaders.set(bp, eC);
            const eE = this.table?.getColumn(field);
            if (eE) {
              this.smart.scheduleColumn(eE);
              this.smart.scheduleBottomCalcs(field);
            }
          }
        });
      }
      const dC = new Set();
      this.tableEl
        .querySelectorAll(".tabulator-header .tabulator-col[tabulator-field]")
        .forEach((bW) => {
          dC.add(bW);
          if (!this._observedHeaders.has(bW)) {
            this._observedHeaders.set(bW, bW.getBoundingClientRect().width);
            this._columnWidthObserver.observe(bW);
          }
        });
      for (const de of this._observedHeaders.keys()) {
        if (!dC.has(de)) {
          this._columnWidthObserver.unobserve(de);
          this._observedHeaders.delete(de);
        }
      }
    }
    _wireSidebarLanguage() {
      this._lastSidebarLanguage = getSidebarLanguage();
      this._syncSidebarLanguage = () => {
        if (this._destroyed) return;
        const gq = getSidebarLanguage();
        const cg = gq === "en" ? "ltr" : "rtl";
        if (this.root.dir !== cg) {
          this.root.dir = cg;
          if (this.table?.redraw) this.table.redraw(true);
        }
        if (gq === this._lastSidebarLanguage) return;
        this._lastSidebarLanguage = gq;
        this.smart.refreshLocalizedNumbers();
        this._updateCount();
      };
      this._onSidebarStorage = (fQ) => {
        if (fQ.key === "sidebarLanguage" || fQ.key === null)
          this._syncSidebarLanguage();
      };
      ab.addEventListener("storage", this._onSidebarStorage);
      if (typeof MutationObserver !== "undefined") {
        this._languageObserver = new MutationObserver(() =>
          this._syncSidebarLanguage(),
        );
        this._languageObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["lang"],
        });
        try {
          const bb = ab.parent?.document?.documentElement;
          if (bb && bb !== document.documentElement)
            this._languageObserver.observe(bb, {
              attributes: true,
              attributeFilter: ["lang"],
            });
        } catch (_) {}
      }
      this._onSidebarFocus = () => this._syncSidebarLanguage();
      ab.addEventListener("focus", this._onSidebarFocus);
    }
    _wireEvents() {
      const ai = this.table;
      const ac = this;
      this._wireSidebarLanguage();
      this.tableEl.addEventListener("contextmenu", function (eF) {
        if (eF.target.closest && eF.target.closest(".tabulator-header")) {
          eF.preventDefault();
          ac.columnManager.open();
        }
      });
      ai.on("tableBuilt", function () {
        ac._built = true;
        ac._observeColumnWidths();
        if (ac.options.noTranslateBody) {
          const eG = ac.root.querySelector(".tabulator-tableholder");
          if (eG) eG.setAttribute("translate", "no");
        }
        ac.emit("tableBuilt");
      });
      ai.on("cellClick", function (e, fp) {
        if (
          e.target?.closest?.(
            ".bina-selector-gutter,.bina-selector-corner,.bina-row-resizer",
          )
        )
          return;
        if (!fp.getField()) return;
        ac.selection.setActive(fp);
        ac.root.focus({ preventScroll: true });
        ac.emit("cellClick", {
          event: e,
          field: fp.getField(),
          data: fp.getData(),
        });
      });
      ai.on("cellDblClick", function (e, hi) {
        ac.emit("cellDblClick", {
          event: e,
          field: hi.getField(),
          data: hi.getData(),
        });
      });
      ai.on("rowClick", function (e, i1) {
        if (
          e.target?.closest?.(
            ".bina-selector-gutter,.bina-selector-corner,.bina-row-resizer",
          )
        )
          return;
        ac.emit("rowClick", { event: e, data: i1.getData() });
      });
      ai.on("rowDblClick", function (e, i2) {
        ac.emit("rowDblClick", { event: e, data: i2.getData() });
      });
      ai.on("dataFiltered", function (hv, au) {
        ac._updateCount(au ? au.length : undefined);
        ac._syncSelectorChecks();
        ac.emit("filterChanged", { count: au ? au.length : 0 });
      });
      ai.on("dataSorted", function () {
        ac._updateCount();
        ac.stateStore.schedule();
        ac.emit("sortChanged", ac.getSorters());
      });
      ai.on("pageLoaded", function (h7) {
        ac.selection.paint();
        ac._syncSelectorChecks();
        ac._updateCount();
        ac.emit("pageChanged", { page: h7, pageSize: ai.getPageSize() });
      });
      ai.on("pageSizeChanged", function (fq) {
        if (typeof fq === "number" && fq >= 100 && ai.getDataCount() > 0) {
          try {
            localStorage.setItem(
              ac.options.storagePrefix + ".pageSize",
              String(fq),
            );
          } catch (e) {}
        }
        if (ac._built) {
          ac.emit("pageChanged", { page: ai.getPage(), pageSize: fq });
        }
      });
      ai.on("columnResizing", function (eH) {
        const field = eH.getField();
        if (!field) return;
        ac.smart.scheduleColumn(eH);
        ac.smart.scheduleBottomCalcs(field);
      });
      ai.on("columnWidth", function (eI) {
        ac.smart.scheduleColumn(eI);
        ac.smart.scheduleBottomCalcs(eI.getField());
      });
      ai.on("columnResized", function (bc) {
        ac.smart.scheduleColumn(bc);
        ac.smart.scheduleBottomCalcs(bc.getField());
        const field = bc.getField();
        if (field) {
          const fR = ac.getColumnState(field);
          if (!fR.baseWidth)
            fR.baseWidth =
              Number(bc.getDefinition().width) || bc.getWidth() || 100;
        }
        ac.stateStore.schedule();
        ac.emit("columnResized", {
          field: bc.getField(),
          width: bc.getWidth(),
        });
      });
      ai.on("columnMoved", function () {
        ac._observeColumnWidths();
        ac.smart.scheduleVisibleRows();
        ac.stateStore.schedule();
        ac.emit("columnMoved", ac.getColumnOrder());
      });
      ai.on("columnVisibilityChanged", function () {
        ac.smart.scheduleVisibleRows();
        ac.stateStore.schedule();
        ac.emit("columnVisibilityChanged", ac.getColumnOrder());
      });
      ai.on("renderComplete", function () {
        ac._observeColumnWidths();
        ac._syncSidebarLanguage();
        ac.selection.paint();
        ac.smart.scheduleVisibleRows();
        ac.smart.scheduleBottomCalcs();
      });
      this._onSelectorPointerUp = () => {
        setTimeout(() => {
          this._selectorDrag = null;
        }, 0);
      };
      ab.addEventListener("pointerup", this._onSelectorPointerUp);
      ab.addEventListener("pointercancel", this._onSelectorPointerUp);
      this.root.addEventListener("keydown", function (e) {
        ac._onKeydown(e);
      });
      this._docKeydown = function (e) {
        if (e.key === "Escape" && ac.columnManager.isOpen())
          ac.columnManager.close();
      };
      document.addEventListener("keydown", this._docKeydown);
      this._wireToolbar();
    }
    async setData(df, dM, h8) {
      if (!Array.isArray(df))
        throw new Error("setData: آرایه‌ای از آبجکت بده.");
      if (df.length && typeof df[0] !== "object") {
        throw new Error("setData: هر ردیف باید آبجکت باشد (خروجی کویری SQL).");
      }
      this.tableName = dM || this.tableName || "QueryResult";
      const hj = df[0] || {};
      const eJ = Object.keys(hj).filter(function (f) {
        return f !== "__id";
      });
      this.fieldSignature = eJ.slice().sort().join("|");
      this.columnState.clear();
      this.selection.clear();
      this.root
        .querySelectorAll(".bina-sel, .bina-active, .bina-row-sel")
        .forEach(function (el) {
          el.classList.remove("bina-sel", "bina-active", "bina-row-sel");
        });
      if (!this._pageSizeRestored) {
        this._pageSizeRestored = true;
        try {
          const eK = Number(
            localStorage.getItem(this.options.storagePrefix + ".pageSize"),
          );
          if (eK >= 100 && eK !== this.table.getPageSize())
            this.table.setPageSize(eK);
        } catch (e) {}
      }
      this.restoring = true;
      try {
        const gr = eJ.map((f) => this._makeColumnDef(f, df));
        if (this.options.rowSelector) gr.unshift(this._makeSelectorColumn());
        if (!this._built) {
          await new Promise((fr) => {
            const bX = () => {
              if (this._built) fr();
              else setTimeout(bX, 50);
            };
            bX();
          });
        }
        this.table.setColumns(gr);
        this.table.options.columns = gr;
      } finally {
        this.restoring = false;
      }
      await this.stateStore.restore();
      await this._ensureSelectorColumn();
      // await this.syncColumnKindsAndCalcs();
      const fs = this._withIds(df, h8);
      await this.table.replaceData(fs);
      this._observeColumnWidths();
      try {
        this.table.setPage(1);
      } catch (e) {}
      this._updateCount();
      this.smart.scheduleVisibleRows();
      this.smart.scheduleBottomCalcs();
      this.stateStore.schedule();
      this._toggleEmpty();
      this.emit("dataLoaded", { tableName: this.tableName, rows: df.length });
    }
    _withIds(dN, hk) {
      const cH = function () {
        return dN.map(function (r, i) {
          const hl = Object.assign({}, r);
          hl.__id = i + 1;
          return hl;
        });
      };
      if (!hk || hk.own !== true) return cH();
      const i3 = Object.prototype.hasOwnProperty;
      for (let i = 0; i < dN.length; i++) {
        const r = dN[i];
        if (r === null || typeof r !== "object" || !Object.isExtensible(r))
          return cH();
        if (i3.call(r, "__id") && r.__id !== i + 1) return cH();
      }
      for (let i = 0; i < dN.length; i++) dN[i].__id = i + 1;
      return dN;
    }
    async clearData() {
      this.tableName = "";
      this.fieldSignature = "";
      this.columnState.clear();
      this.selection.clear();
      this.restoring = true;
      try {
        this.table.setColumns([]);
        this.table.options.columns = [];
        await this.table.replaceData([]);
      } finally {
        this.restoring = false;
      }
      this._updateCount(0);
      this._toggleEmpty();
      this.emit("dataLoaded", { tableName: "", rows: 0 });
    }
    getData() {
      return this.table.getData();
    }
    getFilteredData() {
      return this.table.getData("active");
    }
    getActiveData() {
      return this.table.getData("active");
    }
    getRecordCount() {
      return this.table.getDataCount("active"); // ← O(1)
    }
    _updateCount(explicitTotal) {
      if (!this.countEl) return;

      let total = 0;
      let visible = [];
      try {
        if (this.table) {
          total =
            typeof explicitTotal === "number"
              ? explicitTotal
              : this.table.getDataCount("active");
          visible = this.table.getRows("visible") || [];
        }
      } catch (_) {
        /* Table may still be initializing. */
      }

      let current = 0;
      if (total > 0) {
        const rowKey = (row) => String(row.getIndex());
        const cursor = this.selection?.cursorKey;

        // فقط در صفحهٔ فعلی جستجو کن، نه در کل ۳ میلیون رکورد
        let idx = cursor
          ? visible.findIndex((row) => rowKey(row) === cursor)
          : -1;

        if (idx < 0 && visible.length) idx = 0;

        if (idx >= 0) {
          // موقعیت مطلق = شماره صفحه × اندازه صفحه + اندیس درون صفحه
          let pageStart = 0;
          try {
            const page = this.table.getPage();
            const pageSize = this.table.getPageSize();
            if (typeof page === "number" && typeof pageSize === "number") {
              pageStart = (page - 1) * pageSize;
            }
          } catch (_) {
            /* ignore */
          }
          current = pageStart + idx + 1;
        } else {
          current = 1;
        }
      }

      const lang = getSidebarLanguage();
      const label = lang === "en" ? "Record" : lang === "ar" ? "سجل" : "رکورد";
      const of = lang === "en" ? " of " : lang === "ar" ? " من " : " از ";
      this.countEl.textContent =
        label + ": " + faNum(current) + of + faNum(total);
    }
    _toggleEmpty() {
      const hm = !this.table || this.table.getDataCount() === 0;
      this.emptyEl.style.display = hm ? "flex" : "none";
    }
    _makeSelectorColumn() {
      const aM = this;
      const toggleAll = () => {
        const dD = aM.table.getRows("visible");
        if (!dD.length) return;
        const i4 = dD.every((i5) =>
          aM.selection.rows.has(aM.selection.rowKey(i5)),
        );
        aM.selection.setVisibleRowsSelected(!i4);
        aM.selection.rowAnchor = null;
      };
      return {
        title: "",
        width: 25,
        minWidth: 25,
        maxWidth: 25,
        resizable: false,
        movable: false,
        headerSort: false,
        hozAlign: "center",
        headerHozAlign: "center",
        cssClass: "bina-selector-cell",
        headerTooltip: "کلیک: انتخاب صفحه | دابل‌کلیک: انتخاب همه صفحات",
        headerClick(e) {
          e.preventDefault();
          e.stopPropagation();
          toggleAll();
        },
        headerDblClick(e) {
          e.preventDefault();
          e.stopPropagation();
          aM.selection.selectAllActive();
        },
        titleFormatter() {
          const bd = document.createElement("button");
          bd.type = "button";
          bd.className = "bina-selector-corner";
          bd.title = "کلیک: انتخاب صفحه | دابل‌کلیک: انتخاب همه صفحات";
          bd.setAttribute("aria-label", bd.title);
          bd.addEventListener("click", (fS) => {
            fS.preventDefault();
            fS.stopPropagation();
            toggleAll();
          });
          bd.addEventListener("dblclick", (fS) => {
            fS.preventDefault();
            fS.stopPropagation();
            aM.selection.selectAllActive();
          });
          return bd;
        },
        formatter(dO) {
          const an = document.createElement("button");
          an.type = "button";
          an.className = "bina-selector-gutter";
          an.dataset.rowKey = aM.selection.rowKey(dO.getRow());
          an.setAttribute("aria-label", "انتخاب ردیف");
          an.title =
            "انتخاب ردیف؛ Ctrl برای چندانتخابی، Shift برای انتخاب بازه";
          an.setAttribute(
            "aria-selected",
            aM.selection.rows.has(an.dataset.rowKey) ? "true" : "false",
          );
          an.addEventListener("pointerdown", (eM) => {
            if (eM.button !== 0) return;
            aM._selectorDrag = {
              anchor: aM.selection.rowKey(dO.getRow()),
              moved: false,
              additive: eM.ctrlKey || eM.metaKey,
            };
          });
          an.addEventListener("pointerenter", (hn) => {
            const dP = aM._selectorDrag;
            if (!dP || !(hn.buttons & 1) || dP.anchor === an.dataset.rowKey)
              return;
            if (!dP.moved) {
              aM.selection.rowAnchor = dP.anchor;
              dP.moved = true;
            }
            aM.selection.selectRowRange(dO.getRow(), dP.additive);
          });
          an.addEventListener("click", (bY) => {
            bY.preventDefault();
            bY.stopPropagation();
            if (aM._selectorDrag?.moved) {
              aM._selectorDrag = null;
              return;
            }
            if (bY.shiftKey && aM.selection.rowAnchor) {
              aM.selection.selectRowRange(
                dO.getRow(),
                bY.ctrlKey || bY.metaKey,
              );
            } else if (bY.ctrlKey || bY.metaKey) {
              aM.selection.toggleRow(dO.getRow());
            } else aM.selection.setOnlyRow(dO.getRow());
            aM._selectorDrag = null;
          });
          return an;
        },
        print: false,
        download: false,
        clipboard: false,
      };
    }
    async _ensureSelectorColumn() {
      if (!this.options.rowSelector || !this.table) return;
      const bG = this.table.getColumns();
      const bZ = bG.find((gs) => !gs.getField());
      if (bZ) {
        if (
          bG[0] !== bZ &&
          bG[0] &&
          typeof this.table.moveColumn === "function"
        ) {
          await this.table.moveColumn(bZ, bG[0], false);
        }
        return;
      }
      await this.table.addColumn(this._makeSelectorColumn(), true);
    }
    _syncSelectorChecks() {
      if (!this.options.rowSelector || !this.table) return;
      this.tableEl.querySelectorAll(".bina-selector-gutter").forEach((eN) => {
        const ft = this.selection.rows.has(eN.dataset.rowKey);
        eN.setAttribute("aria-selected", ft ? "true" : "false");
      });
      const dg = this.tableEl.querySelector(".bina-selector-corner");
      if (!dg) return;
      const bH = this.table.getRows("visible");
      const b_ = bH.filter((i6) =>
        this.selection.rows.has(this.selection.rowKey(i6)),
      ).length;
      dg.setAttribute(
        "aria-pressed",
        bH.length > 0 && b_ === bH.length ? "true" : "false",
      );
      dg.title =
        b_ === bH.length && b_ > 0
          ? "لغو انتخاب ردیف‌های صفحه"
          : "انتخاب همه ردیف‌های صفحه";
    }
    _makeColumnDef(field, i7) {
      const eO = this.options.presetcolumns[field];
      const dQ = inferKind(field);
      const az = {
        field: field,
        title: (this.options.captions && this.options.captions[field]) || field,
        width: eO ? eO.width : dQ === "number" ? 130 : 240,
        minWidth: 1,
        headerHozAlign: "center",
        hozAlign: dQ === "number" ? "center" : "right",
        sorter: dQ === "number" ? compareFinancialValues : "string",
        headerFilter: "input",
        variableHeight: true,
      };
      this.fieldKinds.set(field, dQ);
      const fT = this.getColumnState(field);
      if (!fT.baseWidth) fT.baseWidth = az.width;
      if (dQ === "text") az.headerFilterFunc = "like";
      if (dQ === "number") {
        az.bottomCalc = sumFinancialValues;
        az.bottomCalcFormatter = this.makeBottomCalcFormatter(field);
        az.bottomCalcParams = { calcsOnPage: true }; // ← این خط را اضافه کن
      }

      return az;
    }
    columnKind(dh) {
      return inferKind(dh?.field);
    }
    getColumnState(field) {
      if (!this.columnState.has(field)) {
        this.columnState.set(field, {
          visible: true,
          frozen: false,
          foreground: null,
          background: null,
          fontSize: null,
          bold: false,
          align: null,
          baseWidth: 0,
        });
      }
      return this.columnState.get(field);
    }
    getDefaultAlignment(field) {
      return this.columnKind({ field }) === "number" ? "center" : "right";
    }
    getEffectiveAlignment(field) {
      return (
        normalizedColumnAlignment(this.getColumnState(field).align) ||
        this.getDefaultAlignment(field)
      );
    }
    async syncColumnAlignment(field) {
      let be = this.table?.getColumn(field);
      if (!be) return null;
      const cR = this.getEffectiveAlignment(field);
      if (normalizedColumnAlignment(be.getDefinition().hozAlign) !== cR) {
        await be.updateDefinition({ hozAlign: cR });
        be = this.table.getColumn(field) || be;
      }
      be.getCells().forEach((h9) =>
        this.smart.applyAlignmentToCell(h9.getElement(), cR),
      );
      this.smart.applyRenderedColumnAlignment(field, cR);
      this.smart.applyRenderedBottomCalcAlignment(field, cR);
      this.smart.scheduleBottomCalcs(field);
      return be;
    }
    makeBottomCalcFormatter(field) {
      if (!this._calcFormatterMap) this._calcFormatterMap = new Map();
      if (this._calcFormatterMap.has(field))
        return this._calcFormatterMap.get(field);
      const di = this;
      const ch = function (gt, ia, b$) {
        const bC = document.createElement("div");
        bC.className = "smart num bina-bottom-calc";
        bC.dataset.binaField = field;
        bC._binaNumericValue = gt.getValue();
        bC.textContent = formatNumber(bC._binaNumericValue);
        di.smart.setTextFont(bC, aq.default);
        di.smart.alignBottomCalcContent(bC, di.getEffectiveAlignment(field));
        const gu = typeof gt.getElement === "function" ? gt.getElement() : null;
        if (gu) {
          gu.dataset.binaCalcField = field;
          di.smart.alignBottomCalcCell(gu, di.getEffectiveAlignment(field));
        }
        if (typeof b$ === "function")
          b$(() => di.smart.scheduleBottomCalcs(field));
        else requestAnimationFrame(() => di.smart.scheduleBottomCalcs(field));
        return bC;
      };
      this._calcFormatterMap.set(field, ch);
      return ch;
    }
    async syncColumnKindsAndCalcs() {
      for (const field of this.getManagedcolumns().map((gv) => gv.getField())) {
        let ho = this.table.getColumn(field);
        if (!ho) continue;
        const bf = ho.getDefinition();
        const bI = inferKind(field) === "number";
        const aB = bI ? this.makeBottomCalcFormatter(field) : null;
        const b7 = bI
          ? bf.bottomCalc !== sumFinancialValues ||
            bf.bottomCalcFormatter !== aB
          : Boolean(bf.bottomCalc);
        if (b7) {
          await ho.updateDefinition(
            bI
              ? {
                  bottomCalc: sumFinancialValues,
                  bottomCalcFormatter: aB,
                  sorter: compareFinancialValues,
                }
              : {
                  bottomCalc: false,
                  bottomCalcFormatter: false,
                  sorter: "string",
                },
          );
          ho = this.table.getColumn(field) || ho;
        }
        this.fieldKinds.set(field, bI ? "number" : "text");
      }
    }
    getManagedcolumns() {
      return this.table.getColumns().filter(function (c) {
        return Boolean(c.getField());
      });
    }
    applyColumnColors(field) {
      const eP = this.table?.getColumn(field);
      if (!eP) return;
      const fU = this.getColumnState(field);
      eP.getCells().forEach((ib) => paintCellColors(ib.getElement(), fU));
      this.tableEl.querySelectorAll(".tabulator-cell").forEach((cI) => {
        if (
          (cI.dataset.binaField || cI.getAttribute("tabulator-field")) === field
        ) {
          paintCellColors(cI, fU);
        }
      });
      this.smart.scheduleBottomCalcs(field);
    }
    getVisibleFields() {
      return this.getManagedcolumns()
        .filter(function (c) {
          return c.isVisible();
        })
        .map(function (c) {
          return c.getField();
        });
    }
    getColumnOrder() {
      return this.getManagedcolumns().map(function (c) {
        return {
          field: c.getField(),
          visible: c.isVisible(),
          width: c.getWidth(),
          frozen: c.getDefinition().frozen === true,
        };
      });
    }
    toggleColumn(field) {
      const b0 = this.table.getColumn(field);
      if (!b0) throw new Error("ستونی با نام «" + field + "» نیست.");
      if (b0.isVisible()) b0.hide();
      else b0.show();
      return b0.isVisible();
    }
    async freezeTo(field) {
      if (field === null || field === undefined) {
        const eQ = this.getManagedcolumns().map(function (c) {
          return c.getField();
        });
        if (eQ.length) await this.columnManager.setFrozenRange(eQ[0], false);
        return;
      }
      await this.columnManager.setFrozenRange(field, true);
    }
    setColumnColor(field, bh, bi) {
      const gw = this.table.getColumn(field);
      if (!gw) throw new Error("ستونی با نام «" + field + "» نیست.");
      const fV = this.getColumnState(field);
      if (bh !== undefined && bh !== null) fV.foreground = bh;
      if (bi !== undefined && bi !== null) fV.background = bi;
      this.applyColumnColors(field);
      this.stateStore.schedule();
    }
    resetcolumns() {
      return this.columnManager.reset();
    }
    openColumnManager() {
      this.columnManager.open();
    }
    closeColumnManager() {
      this.columnManager.close();
    }
    setFilter(...dR) {
      if (dR.length === 1 && Array.isArray(dR[0])) {
        this._customFilters = dR[0].slice();
      } else {
        this._customFilters.push({ field: dR[0], type: dR[1], value: dR[2] });
      }
      this._applyDataFilters();
    }
    search(ic) {
      this._searchText = String(ic ?? "").trim();
      if (this.searchInput.value !== this._searchText)
        this.searchInput.value = this._searchText;
      this._applyDataFilters();
      this.emit("searchChanged", { text: this._searchText });
    }
    _applyDataFilters() {
      const gA = [];
      if (this._customFilters.length) gA.push(...this._customFilters);
      const hp = this._searchText.toLowerCase();
      if (hp) {
        const eR = this.getVisibleFields();
        gA.push(function (id) {
          for (let i = 0; i < eR.length; i++) {
            const v = id[eR[i]];
            if (
              v !== null &&
              v !== undefined &&
              String(v).toLowerCase().indexOf(hp) >= 0
            )
              return true;
          }
          return false;
        });
      }
      if (gA.length === 1) this.table.setFilter(gA[0]);
      else if (gA.length > 1) this.table.setFilter(gA);
      else this.table.clearFilter();
    }
    clearFilters() {
      this._customFilters = [];
      this._searchText = "";
      this.searchInput.value = "";
      this.table.clearFilter();
      this.table.clearHeaderFilter();
      this.emit("searchChanged", { text: "" });
    }
    getFilters() {
      return {
        header: this.table
          .getHeaderFilters()
          .map((f) => ({ field: f.field, value: f.value })),
        programmatic: this._customFilters.slice(),
        search: this._searchText,
      };
    }
    setSort(...eS) {
      if (eS.length === 1 && Array.isArray(eS[0])) this.table.setSort(eS[0]);
      else this.table.setSort(eS[0], eS[1]);
    }
    clearSort() {
      this.table.clearSort();
    }
    getSorters() {
      return this.table
        .getSorters()
        .map((s) => ({ column: s.field, dir: s.dir }));
    }
    setPage(n) {
      return this.table.setPage(n);
    }
    nextPage() {
      return this.table.nextPage().catch(function () {});
    }
    prevPage() {
      return this.table.previousPage().catch(function () {});
    }
    firstPage() {
      return this.table.setPage(1);
    }
    lastPage() {
      return this.table.setPage("last");
    }
    setPageSize(n) {
      return this.table.setPageSize(n);
    }
    getPageInfo() {
      return {
        page: this.table.getPage(),
        maxPage: this.table.getPageMax(),
        pageSize: this.table.getPageSize(),
        rows: this.getRecordCount(),
      };
    }
    getSelectedData() {
      return this.selection.getSelectedData();
    }
    setRowHeight(height) {
      this.rowSizer.userSized = true;
      this.rowSizer.setHeight(height, true);
    }
    getRowHeight() {
      return this.rowSizer.height;
    }
    clearSelection() {
      this.selection.clear();
    }
    selectAllPage() {
      this.selection.selectAllPage();
    }
    async copySelection(b1 = false) {
      const b2 = this.selection.copy(b1);
      if (!b2) return null;
      await copyTextToClipboard(b2.text);
      this.emit("copy", { cells: b2.cells, rows: b2.rows, header: b1 });
      return b2;
    }
    async copySelectedRows() {
      const fu = this.getVisiblecolumns();
      const picked = this.selection?.rows;
      if (!picked || !picked.size)
        throw new Error("ابتدا رکوردهای موردنظر را انتخاب کنید.");
      if (!fu.length) throw new Error("ستونی برای کپی وجود ندارد.");
      const fields = fu.map((c) => c.getField());
      const lines = [fields.join("\t")];
      let count = 0;
      this.table.getRows("active").forEach((row) => {
        if (!picked.has(this.selection.rowKey(row))) return;
        const data = row.getData();
        lines.push(fields.map((f) => data[f] ?? "").join("\t"));
        count++;
      });
      if (!count)
        throw new Error("هیچ‌یک از رکوردهای انتخابی در نتایج فعلی نیست.");
      await copyTextToClipboard(lines.join("\r\n"));
      this.emit("copy", {
        cells: count * fields.length,
        rows: count,
        header: true,
      });
      return count;
    }
    async copyAll() {
      const fu = this.getVisiblecolumns();
      const eT = this.getActiveData();
      if (!fu.length || !eT.length)
        throw new Error("چیزی برای کپی نیست — اول کویری بزن.");
      const fW = [fu.map((c) => c.getField()).join("\t")];
      eT.forEach(function (i8) {
        fW.push(fu.map((c) => i8[c.getField()] ?? "").join("\t"));
      });
      await copyTextToClipboard(fW.join("\r\n"));
      this.emit("copy", {
        cells: eT.length * fu.length,
        rows: eT.length,
        header: true,
      });
      return eT.length;
    }
    getVisiblecolumns() {
      return this.table.getColumns().filter(function (c) {
        return Boolean(c.getField()) && c.isVisible();
      });
    }
    _getExportStyle(aV) {
      const aN = aV.getDefinition();
      const b3 = this.getColumnState(aV.getField());
      if (!b3.baseWidth) {
        b3.baseWidth = Number(aN.width) || aV.getWidth() || 100;
      }
      return {
        field: aV.getField(),
        title: aN.title || aV.getField(),
        kind: this.columnKind(aN),
        widthPx: aV.getWidth(),
        fontSizePx: (() => {
          const base = normalizedColumnFontSize(b3.fontSize) ?? aq.default;
          return Math.max(
            9,
            Math.min(
              base + aq.delta,
              Math.round(
                ((base * aV.getWidth()) / b3.baseWidth) * aq.precision,
              ) / aq.precision,
            ),
          );
        })(),
        align: this.getEffectiveAlignment(aV.getField()),
        foreground: b3.foreground || a3,
        background: b3.background || a4,
        bold: b3.bold === true,
        frozen: aN.frozen === true,
      };
    }
    print() {
      if (typeof this.table?.print === "function") {
        this.table.print("active", true, { columnGroups: false });
      } else {
        this._toast("قابلیت چاپ Tabulator در این نسخه فعال نیست.");
      }
    }
    async _runExport(dk, gy) {
      if (dk.disabled) return;
      dk.disabled = true;
      try {
        await gy();
      } catch (eV) {
        console.error("[BinaGrid] export error", eV);
        this.emit("exportError", { error: eV });
        this._toast("خطا در خروجی: " + (eV?.message || "نامشخص"));
      } finally {
        dk.disabled = false;
      }
    }
    _toast(ie) {
      this.toastEl.textContent = ie;
      this.toastEl.classList.add("show");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(
        () => this.toastEl.classList.remove("show"),
        2000,
      );
    }
    _emitSelectionChanged() {
      this._updateCount();
      let fY = 0;
      this.selection?.cells.forEach(function (i9) {
        fY += i9.size;
      });
      this.emit("selectionChanged", {
        cells: fY,
        rows: this.selection?.rows.size || 0,
        activeField: this.selection?.active?.field || null,
      });
    }
    _onKeydown(aj) {
      if (this._destroyed) return;
      const ja = this.selection;
      if (aj.key === "Escape") {
        ja.clear();
        return;
      }
      if ((aj.ctrlKey || aj.metaKey) && aj.key.toLowerCase() === "f") {
        aj.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        return;
      }
      if ((aj.ctrlKey || aj.metaKey) && aj.key.toLowerCase() === "c") {
        aj.preventDefault();
        this.copySelection(aj.shiftKey)
          .then((iJ) => {
            if (iJ) this._toast(faNum(iJ.cells) + " سلول کپی شد ✓");
          })
          .catch(() => this._toast("کپی ممکن نشد"));
        return;
      }
      const jb = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowRight: "prev",
        ArrowLeft: "next",
        Home: "home",
        End: "end",
      };
      const iK = jb[aj.key];
      if (iK) {
        aj.preventDefault();
        this._moveActive(iK, aj.ctrlKey || aj.metaKey);
        return;
      }
      if (aj.key.toLowerCase() === "a" && (aj.ctrlKey || aj.metaKey)) {
        aj.preventDefault();
        this.selectAllPage();
      }
    }
    _moveActive(fZ, hs) {
      const hw = this.selection;
      const ak = this.table.getRows("visible");
      const bw = this.getVisibleFields();
      if (!ak.length || !bw.length) return;
      let aG = 0,
        ao = 0;
      if (hw.active) {
        aG = ak.findIndex((r) => r === hw.active.row);
        ao = bw.indexOf(hw.active.field);
        if (aG < 0) aG = 0;
        if (ao < 0) ao = 0;
      }
      if (hs && fZ === "home") {
        aG = 0;
        ao = 0;
      } else if (hs && fZ === "end") {
        aG = ak.length - 1;
        ao = bw.length - 1;
      } else if (fZ === "up") aG = Math.max(0, aG - 1);
      else if (fZ === "down") aG = Math.min(ak.length - 1, aG + 1);
      else if (fZ === "next") ao = Math.min(bw.length - 1, ao + 1);
      else if (fZ === "prev") ao = Math.max(0, ao - 1);
      else if (fZ === "home") ao = 0;
      else if (fZ === "end") ao = bw.length - 1;
      const iL = ak[aG];
      const f_ = iL.getElement();
      if (!f_ || !f_.isConnected) return;
      const gz = iL.getCells().find((c) => c.getField() === bw[ao]);
      if (!gz) return;
      hw.setActive(gz);
      const el = gz.getElement();
      if (el && el.isConnected)
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    _wireToolbar() {
      const br = this;
      this.searchInput.addEventListener("input", function () {
        clearTimeout(br._searchTimer);
        br._searchTimer = setTimeout(function () {
          br.search(br.searchInput.value);
        }, 200);
      });
      this.searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          br.search("");
          br.root.focus();
        }
      });
      this.toolbar
        .querySelector(".bina-clear")
        .addEventListener("click", function () {
          br.clearFilters();
        });
      this.toolbar
        .querySelector('[data-act="copy"]')
        .addEventListener("click", function (ht) {
          br._runExport(ht.currentTarget, function () {
            return br.copySelectedRows().then(function (n) {
              br._toast(faNum(n) + " ردیف کپی شد ✓");
            });
          });
        });
      this.toolbar
        .querySelector('[data-act="print"]')
        .addEventListener("click", function () {
          br.print();
        });
      this.toolbar
        .querySelector('[data-act="columns"]')
        .addEventListener("click", function () {
          br.columnManager.open();
        });
    }
    saveState() {
      this.stateStore.saveNow();
    }
    restoreState() {
      return this.stateStore.restore();
    }
    resetState() {
      this.stateStore.cancelPending();
      try {
        localStorage.removeItem(this.stateStore.key());
      } catch (e) {}
    }
    static get version() {
      return "1.2.64";
    }
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      clearTimeout(this._searchTimer);
      clearTimeout(this._toastTimer);
      this.stateStore.cancelPending();
      this.smart?.destroy();
      document.removeEventListener("keydown", this._docKeydown);
      ab.removeEventListener("pointerup", this._onSelectorPointerUp);
      ab.removeEventListener("pointercancel", this._onSelectorPointerUp);
      ab.removeEventListener("storage", this._onSidebarStorage);
      ab.removeEventListener("focus", this._onSidebarFocus);
      this._languageObserver?.disconnect();
      this._columnWidthObserver?.disconnect();
      this.rowSizer?.destroy();
      try {
        this.table.destroy();
      } catch (e) {}
      this.root.remove();
      this.events = new EventBus();
    }
    on(ig, fn) {
      return this.events.on(ig, fn);
    }
    once(ih, fn) {
      return this.events.once(ih, fn);
    }
    off(ii, fn) {
      this.events.off(ii, fn);
    }
    emit(ij, fA) {
      this.events.emit(ij, fA);
    }
  }
  BinaGrid.utils = Object.freeze({
    formatNumber,
    faNum,
    inferKind,
    measureTextWidth,
    estimateLineCount,
    isNumericLike,
    isBlank,
    normalizeHex,
    downloadBlob,
    copyTextToClipboard,
    yieldToUi,
  });
  ab.BinaGrid = BinaGrid;
})(window);
