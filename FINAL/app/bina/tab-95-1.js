/* tab-95-1.js — اطلاعات پایه: مدیریت بانک محلی IndexedDB (BINA v4.2).
   پیش‌نیاز: ../app/com/bina-db-manager.js  (globals: webservice, Index_db) */

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fa = (n) =>
    n == null || n === "" ? "—" : Number(n).toLocaleString("fa-IR");
  const logBox = $("log");
  function log(line) {
    logBox.textContent =
      "[" +
      new Date().toLocaleTimeString("fa-IR") +
      "] " +
      line +
      "\n" +
      logBox.textContent;
  }
  function msg(id, type, html) {
    $(id).innerHTML = html
      ? '<div class="banner ' + type + '">' + html + "</div>"
      : "";
  }
  function busy(on) {
    [
      "btnBootstrap",
      "btnRefreshTables",
      "btnApplyFilter",
      "btnSelVisible",
      "btnSelIncomplete",
      "btnSelNone",
      "btnSyncSelected",
      "btnLoadTK",
      "btnRefreshInv",
      "btnSelectAllDb",
      "btnSelectNoneDb",
      "btnDeleteSelected",
      "btnWipeAll",
    ].forEach((id) => {
      $(id).disabled = on;
    });
    $("btnStop").disabled = !on;
  }
  if (
    typeof webservice === "undefined" ||
    typeof Index_db === "undefined"
  ) {
    msg("bootMsg", "err", "کلاس‌ها بارگذاری نشدند.");
    return;
  }
  // endpoint در کد ثابت است
  const ENDPOINT =
    localStorage.getItem("bina_manager_endpoint") ||
    "http://localhost/FastDataHandler.ashx";
  $("endpointField").value = ENDPOINT;
  $("saveEndpoint").onclick = () => {
    const text = $("endpointField").value.trim();
    if (!/^https?:\/\//i.test(text)) {
      alert("آدرس باید با http:// یا https:// شروع شود.");
      return;
    }
    localStorage.setItem("bina_manager_endpoint", text);
    location.reload();
  };

  const ws = new webservice({
    endpoint: ENDPOINT,
    onProgress: (p) => {
      if (p.event === "batch")
        log("batch " + p.table + " → " + p.count + " ردیف");
      else if (p.event === "stats-done")
        log("stats " + p.table + " → " + p.count);
      else if (p.event === "discover-done")
        log("discover: " + p.total + " جدول");
    },
  });
  const db = new Index_db({
    webservice: ws,
    blockSize: 10000,
    batchSize: 15000,
    onProgress: (p) => {
      if (p.event === "storage-persist")
        log(
          p.persisted ? "Storage ماندگار ✅" : "Storage ماندگار نشد ⚠️",
        );
      else if (p.event === "coding-index-log") log(p.message);
      else if (p.event === "bootstrap-online")
        log("بار اول: دریافت از سرور");
      else if (p.event === "bootstrap-done")
        log(
          "bootstrap: firstRun=" +
            p.firstRun +
            ", جداول=" +
            p.discovered +
            ", tk_dic=" +
            p.tkdik +
            ", tk_sherkat=" +
            p.tkSherkat,
        );
      else if (p.event === "tk-loaded")
        log("TK " + p.store + " → " + p.count);
      else if (p.event === "tk-skip")
        log("TK " + p.store + " از قبل موجود (" + p.count + ")");
      else if (p.event === "tk-start")
        log("اولویت پایه: دریافت " + p.total + " جدول tk_ قبل از اسناد");
      else if (p.event === "tk-chunk")
        log("دریافت " + p.table + " → " + p.received + " ردیف");
      else if (p.event === "tk-done")
        log("اطلاعات پایه تکمیل شد: " + p.total + " جدول tk_");
      else if (p.event === "tk-error") log("خطای جدی TK: " + p.error);
      else if (p.event === "table-start")
        log(
          "شروع " +
            p.table +
            (p.received ? " (ادامه از " + p.received + ")" : ""),
        );
      else if (p.event === "table-done")
        log("پایان " + p.table + " → " + p.received);
      else if (p.event === "table-skip") log("رد " + p.table);
      else if (p.event === "table-error")
        log(
          "خطای " +
            p.table +
            ": [" +
            (p.errorName || "?") +
            "] " +
            (p.error || "بدون پیام") +
            " @ " +
            (p.errorStack || ""),
        );
      else if (p.event === "chunk")
        log(p.table + " → " + p.received + " (lastId=" + p.lastId + ")");
      else if (p.event === "job-done")
        log("پیشرفت: " + p.done + "/" + p.total + " — " + p.table);
      else if (p.event === "checkpoint-recovered")
        log("بازیابی چک‌پوینت " + p.table);
      else if (p.event === "refresh-start")
        log("بروزرسانی فهرست از سرور...");
      else if (p.event === "refresh-done")
        log("فهرست بروزرسانی شد: " + p.total + " جدول");
    },
  });
  // ── Storage ──
  async function refreshStorage() {
    try {
      const s = await db.getStorageStatus();
      $("stPersist").textContent = s.persisted
        ? "✅ ماندگار"
        : "⚠️ نیمه‌ماندگار";
      $("stPersist").className = s.persisted ? "badge-ok" : "badge-warn";
      $("stUsage").textContent = s.usageMB + " MB / " + s.quotaMB + " MB";
    } catch (_) {}
  }
  $("btnPersist").onclick = async () => {
    busy(true);
    try {
      // درخواست از مسیر مرکزی مدیریت؛ نتیجه واقعی persisted() بررسی می‌شود.
      const res = await db.requestPersistence();
      log(
        res.persisted
          ? "✅ ذخیره‌سازی Persistent فعال شد"
          : "⚠️ مرورگر ماندگاری را تأیید نکرد: " +
              (res.error || res.reason || "دسترسی رد شد"),
      );
      await refreshStorage();
    } finally {
      busy(false);
    }
  };
  $("btnStop").onclick = () => {
    db.stop();
    log("درخواست توقف");
  };
  // ── bootstrap ──
  $("btnBootstrap").onclick = async () => {
    busy(true);
    msg("bootMsg", "info", "در حال راه‌اندازی اولیه…");
    $("bootPills").innerHTML = "";
    try {
      const r = await db.bootstrap();
      msg(
        "bootMsg",
        "ok",
        (r.firstRun ? "بار اول" : "اطلاعات قبلی") +
          " — تعداد جداول پایه: <b>" +
          fa(r.tkTables?.length) +
          "</b>" +
          " · tk_dic: <b>" +
          fa(r.tkdik) +
          "</b> · tk_sherkat: <b>" +
          fa(r.tkSherkat) +
          "</b>" +
          " · جداول جدید ثبت‌شده: <b>" +
          fa(r.discovered) +
          "</b>",
      );
      $("bootPills").innerHTML =
        '<span class="pill">حالت: <b>' +
        (r.firstRun ? "اولیه" : "موجود") +
        "</b></span>" +
        '<span class="pill">tk_dic: <b>' +
        fa(r.tkdik) +
        "</b></span>" +
        '<span class="pill">tk_sherkat: <b>' +
        fa(r.tkSherkat) +
        "</b></span>" +
        (r.tkTables || [])
          .map(
            (t) =>
              '<span class="pill">' +
              t.table +
              ": <b>" +
              fa(t.count) +
              "</b></span>",
          )
          .join("");
      await refreshStorage();
      await loadCompanies();
      await loadTableList();
    } catch (err) {
      if (err.name === "AbortError") msg("bootMsg", "warn", "متوقف شد.");
      else {
        msg("bootMsg", "err", err.message);
        log("خطا: " + err.message);
      }
    } finally {
      busy(false);
    }
  };
  $("btnRefreshTables").onclick = async () => {
    busy(true);
    msg("bootMsg", "info", "بروزرسانی فهرست جداول از سرور…");
    try {
      const r = await db.refreshServerTables();
      msg(
        "bootMsg",
        "ok",
        "فهرست بروزرسانی شد — جداول: <b>" + fa(r.total) + "</b>",
      );
      await loadCompanies();
      await loadTableList();
    } catch (err) {
      if (err.name === "AbortError") msg("bootMsg", "warn", "متوقف شد.");
      else {
        msg("bootMsg", "err", err.message);
        log("خطا: " + err.message);
      }
    } finally {
      busy(false);
    }
  };
  // ── شرکت‌ها ──
  async function loadCompanies() {
    try {
      const codes = await db.getCompanyCodes();
      const sel = $("fCompany");
      const cur = sel.value;
      sel.innerHTML = '<option value="">همه</option>';
      codes.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      });
      if (codes.includes(cur)) sel.value = cur;
    } catch (_) {}
  }
  // ── لیست جداول ──
  let tableCache = [];
  async function loadTableList() {
    const company = $("fCompany").value || null;
    const family = $("fFamily").value || null;
    const status = $("fStatus").value || null;
    msg("tblMsg", "info", "در حال خواندن فهرست…");
    try {
      tableCache = await db.getTableList({
        companyCode: company,
        family,
        status,
      });
      const body = $("tblBody");
      body.innerHTML = "";
      tableCache.forEach((r, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML =
          '<td><input type="checkbox" class="cb-tbl" data-table="' +
          r.table +
          '"></td>' +
          '<td class="ltr">' +
          r.table +
          "</td>" +
          '<td class="ltr">' +
          r.company +
          "</td>" +
          "<td>" +
          r.family +
          "</td>" +
          "<td>" +
          (r.year ?? "—") +
          "</td>" +
          '<td class="ltr">' +
          fa(r.serverCount) +
          "</td>" +
          '<td class="ltr">' +
          fa(r.localCount) +
          "</td>" +
          "<td>" +
          statusLabel(r.status) +
          "</td>";
        body.appendChild(tr);
      });
      const summary = {
        total: tableCache.length,
        missing: tableCache.filter((r) => r.status === "missing").length,
        incomplete: tableCache.filter((r) => r.status === "incomplete")
          .length,
        diff: tableCache.filter((r) => r.status === "diff").length,
        ok: tableCache.filter((r) => r.status === "ok").length,
      };
      $("tblPills").innerHTML =
        '<span class="pill">کل: <b>' +
        fa(summary.total) +
        "</b></span>" +
        '<span class="pill">نیست: <b>' +
        fa(summary.missing) +
        "</b></span>" +
        '<span class="pill">ناقص: <b>' +
        fa(summary.incomplete) +
        "</b></span>" +
        '<span class="pill">اختلاف: <b>' +
        fa(summary.diff) +
        "</b></span>" +
        '<span class="pill">کامل: <b>' +
        fa(summary.ok) +
        "</b></span>";
      msg(
        "tblMsg",
        "ok",
        "فهرست بارگذاری شد — " + fa(tableCache.length) + " جدول",
      );
    } catch (err) {
      msg("tblMsg", "err", err.message);
      log("خطا فهرست: " + err.message);
    }
  }
  function statusLabel(st) {
    if (st === "ok") return '<span class="st-ok">کامل</span>';
    if (st === "missing") return '<span class="st-missing">نیست</span>';
    if (st === "incomplete")
      return '<span class="st-incomplete">ناقص</span>';
    if (st === "diff") return '<span class="st-diff">اختلاف تعداد</span>';
    return st;
  }
  $("btnApplyFilter").onclick = () => loadTableList();
  $("fCompany").onchange = () => loadTableList();
  $("fFamily").onchange = () => loadTableList();
  $("fStatus").onchange = () => loadTableList();
  $("chkAll").onchange = function () {
    document
      .querySelectorAll(".cb-tbl")
      .forEach((c) => (c.checked = this.checked));
  };
  $("btnSelVisible").onclick = () =>
    document
      .querySelectorAll(".cb-tbl")
      .forEach((c) => (c.checked = true));
  $("btnSelNone").onclick = () =>
    document
      .querySelectorAll(".cb-tbl")
      .forEach((c) => (c.checked = false));
  $("btnSelIncomplete").onclick = () => {
    document.querySelectorAll(".cb-tbl").forEach((c) => {
      const table = c.getAttribute("data-table");
      const row = tableCache.find((r) => r.table === table);
      c.checked =
        row &&
        (row.status === "missing" ||
          row.status === "incomplete" ||
          row.status === "diff");
    });
  };
  $("btnSyncSelected").onclick = async () => {
    const names = [...document.querySelectorAll(".cb-tbl:checked")].map(
      (c) => c.getAttribute("data-table"),
    );
    if (!names.length) {
      msg("tblMsg", "warn", "هیچ جدولی انتخاب نشده.");
      return;
    }
    if (!confirm("دانلود " + names.length + " جدول انتخاب‌شده؟")) return;
    busy(true);
    msg("tblMsg", "info", "در حال دانلود " + names.length + " جدول…");
    try {
      const r = await db.syncTables(names);
      msg(
        "tblMsg",
        "ok",
        "تمام شد — درخواستی: <b>" +
          fa(r.requested) +
          "</b> · انجام‌شده: <b>" +
          fa(r.completed) +
          "</b>",
      );
      await loadTableList();
      await refreshStorage();
      await refreshInventory();
    } catch (err) {
      if (err.name === "AbortError") {
        msg("tblMsg", "warn", "متوقف شد.");
        log("توقف sync");
      } else {
        msg("tblMsg", "err", err.message);
        log("خطا sync: " + err.message);
        console.error(err);
      }
    } finally {
      busy(false);
    }
  };
  // ── TK ──
  $("btnLoadTK").onclick = async () => {
    busy(true);
    msg("tkMsg", "info", "در حال خواندن TK…");
    try {
      const dic = await db.getTKdik();
      const sherkat = await db.getTKEsmSherkat();
      $("tkPills").innerHTML =
        '<span class="pill">tk_dic: <b>' +
        fa(dic.length) +
        "</b></span>" +
        '<span class="pill">tk_sherkat: <b>' +
        fa(sherkat.length) +
        "</b></span>";
      const body = $("tkBody");
      body.innerHTML = "";
      const r1 = document.createElement("tr");
      r1.innerHTML =
        '<td class="ltr">tk_dic</td>' +
        '<td class="ltr">' +
        (dic
          .slice(0, 3)
          .map((r) => (r.fieldname || "") + " → " + (r.caption || ""))
          .join(" | ") || "—") +
        "</td>" +
        '<td class="ltr">' +
        fa(dic.length) +
        "</td>";
      body.appendChild(r1);
      const r2 = document.createElement("tr");
      r2.innerHTML =
        '<td class="ltr">tk_sherkat</td>' +
        '<td class="ltr">' +
        (sherkat
          .slice(0, 3)
          .map(
            (r) => (r.codesherkat || "") + " → " + (r.esmsherkat || ""),
          )
          .join(" | ") || "—") +
        "</td>" +
        '<td class="ltr">' +
        fa(sherkat.length) +
        "</td>";
      body.appendChild(r2);
      msg(
        "tkMsg",
        dic.length || sherkat.length ? "ok" : "warn",
        dic.length || sherkat.length
          ? "TK‌ها خوانده شدند."
          : "TK خالی است؛ ابتدا راه‌اندازی اولیه.",
      );
    } catch (err) {
      msg("tkMsg", "err", err.message);
    } finally {
      busy(false);
    }
  };
  $("btnInspectMeta").onclick = async () => {
    try {
      const r = await db.normalizeMetadata({ dryRun: true });
      log("نامگذاری: " + JSON.stringify(r));
      msg(
        "invMsg",
        r.conflicts.length ? "warn" : "ok",
        "کلیدهای نیازمند اصلاح: " +
          r.renamed +
          "؛ تضادها: " +
          r.conflicts.length,
      );
    } catch (e) {
      log(e.message);
    }
  };
  $("btnNormalizeMeta").onclick = async () => {
    if (
      !confirm(
        "فقط متادیتای بدون تضاد در Public استاندارد شود؟ اطلاعات Coding و Sanad دست نمی‌خورند.",
      )
    )
      return;
    try {
      const r = await db.normalizeMetadata({ dryRun: false });
      log("اصلاح متادیتا: " + JSON.stringify(r));
      await loadTableList();
    } catch (e) {
      log("خطا اصلاح: " + e.message);
    }
  };
  // ── موجودی لوکال ──
  function renderInventory(list) {
    const root = $("invTree");
    root.innerHTML = "";
    if (!list.length) {
      root.innerHTML = '<div class="hint">بانکی وجود ندارد.</div>';
      return;
    }
    list.forEach((dbi) => {
      const item = document.createElement("div");
      item.className = "db-item";
      const total = (dbi.stores || []).reduce(
        (s, x) => s + (typeof x.count === "number" ? x.count : 0),
        0,
      );
      const head = document.createElement("div");
      head.className = "db-head";
      head.innerHTML =
        '<input type="checkbox" class="cb-db" data-db="' +
        dbi.database +
        '">' +
        '<span class="chev">▸</span>' +
        '<span class="name">' +
        dbi.database +
        "</span>" +
        '<span class="meta">v' +
        (dbi.version ?? "?") +
        " · " +
        (dbi.stores ? dbi.stores.length : 0) +
        " store · جمع " +
        fa(total) +
        "</span>";
      head.onclick = (e) => {
        if (e.target.tagName !== "INPUT") item.classList.toggle("open");
      };
      const body = document.createElement("div");
      body.className = "db-body";
      if (dbi.error)
        body.innerHTML =
          '<div class="banner err">' + dbi.error + "</div>";
      else if (!dbi.stores || !dbi.stores.length)
        body.innerHTML = '<div class="hint">بدون استور</div>';
      else
        dbi.stores.forEach((st) => {
          const row = document.createElement("div");
          row.className = "store-row";
          row.innerHTML =
            '<span class="sname">' +
            st.store +
            "</span>" +
            '<span class="count-pill">' +
            (st.count == null ? "?" : fa(st.count)) +
            "</span>";
          body.appendChild(row);
        });
      item.appendChild(head);
      item.appendChild(body);
      root.appendChild(item);
    });
  }
  async function refreshInventory() {
    msg("invMsg", "info", "در حال خواندن IndexedDB…");
    try {
      const list = await db.listLocalInventory();
      renderInventory(list);
      msg("invMsg", "ok", "بانک: <b>" + fa(list.length) + "</b>");
    } catch (err) {
      msg("invMsg", "err", err.message);
    }
  }
  $("btnRefreshInv").onclick = refreshInventory;
  $("btnSelectAllDb").onclick = () =>
    document
      .querySelectorAll(".cb-db")
      .forEach((c) => (c.checked = true));
  $("btnSelectNoneDb").onclick = () =>
    document
      .querySelectorAll(".cb-db")
      .forEach((c) => (c.checked = false));
  $("btnDeleteSelected").onclick = async () => {
    const names = [...document.querySelectorAll(".cb-db:checked")].map(
      (c) => c.getAttribute("data-db"),
    );
    if (!names.length) {
      msg("invMsg", "warn", "چیزی انتخاب نشده است.");
      return;
    }
    if (!confirm("این بانک‌ها حذف شوند؟\n" + names.join("\n"))) return;
    busy(true);
    try {
      const res = await db.deleteLocalDatabases(names);
      res.forEach((r) =>
        log(
          (r.ok ? "حذف: " : "خطا: ") +
            r.database +
            (r.blocked ? " (blocked)" : "") +
            (r.error ? " " + r.error : ""),
        ),
      );
      msg("invMsg", "ok", "حذف انجام شد.");
      await refreshInventory();
      await loadTableList();
    } catch (err) {
      msg("invMsg", "err", err.message);
    } finally {
      busy(false);
    }
  };
  $("btnWipeAll").onclick = async () => {
    if (!confirm("همهٔ بانک‌های IndexedDB این origin حذف شوند؟")) return;
    busy(true);
    try {
      const res = await db.wipeAllLocal();
      log("wipeAll: " + res.length + " مورد");
      msg("invMsg", "ok", "همه پاک شد.");
      $("tblBody").innerHTML = "";
      $("tblPills").innerHTML = "";
      $("bootPills").innerHTML = "";
      $("tkBody").innerHTML = "";
      $("tkPills").innerHTML = "";
      await refreshInventory();
      await refreshStorage();
    } catch (err) {
      msg("invMsg", "err", err.message);
    } finally {
      busy(false);
    }
  };
  $("btnClearLog").onclick = () => {
    logBox.textContent = "";
  };

  // قبل از ساخت Tabulator، ارتفاع کانتینر را بگیرید
  /* ────────────────────────────────────────────────────────────
   * همگام‌سازی مستقل جدول coding_index (مناسب برای Form Load)
   * ──────────────────────────────────────────────────────────── */

  (async function init() {
    await refreshStorage();
    await loadCompanies();
    await loadTableList();

    // همگام‌سازی خودکار جدول coding_index برای تمام شرکت‌ها هنگام باز شدن صفحه
    try {
      const res = await db.syncCodingIndexAll();
      log(
        "همگام‌سازی coding_index: " +
          res.status +
          " (" +
          res.count +
          " رکورد)",
      );
      await refreshInventory();
    } catch (err) {
      log("خطا در همگام‌سازی coding_index: " + err.message);
    }

    log("صفحه آماده است.");
  })();
})();
