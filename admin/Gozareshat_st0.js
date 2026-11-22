/**
 * Gozareshat_st.js
 * الگو: SoratMali_sh.js
 * نگاشت حساب‌های Coding (کل / معین / تفصیل) به ردیف‌های tk_c_Gozareshat_st
 * فیلد ذخیره‌شده در coding_index و سرور: Code_Gozareshat_st (و code_gozareshat_st)
 */
(async function () {
  "use strict";

  const companySelect = document.getElementById("companySelect");
  const loadAndSyncBtn = document.getElementById("loadAndSyncBtn");
  const pushToServerBtn = document.getElementById("pushToServerBtn");
  const assignGroupSelect = document.getElementById("assignGroupSelect");
  const applyGroupBtn = document.getElementById("applyGroupBtn");
  const clearGroupBtn = document.getElementById("clearGroupBtn");
  const statTotal = document.getElementById("statTotal");
  const statSynced = document.getElementById("statSynced");
  const statPending = document.getElementById("statPending");
  const statNoGroup = document.getElementById("statNoGroup");

  const LOOKUP_TABLE = "tk_c_Gozareshat_st";
  const MAP_FIELD = "code_gozareshat_st"; // فیلد اصلی در coding_index

  let dbManager = null;
  let grid = null;
  let standardGroups = [];
  let groupNameMap = new Map(); // code → برچسب کامل برای کمبو
  let groupOptionsHTML = '<option value="">— بدون نگاشت —</option>';
  let allRows = [];
  let rowByKey = new Map();
  let currentCompanyCode = null;

  function pick(obj, ...names) {
    if (!obj) return "";
    for (const wanted of names) {
      if (!wanted) continue;
      for (const key of Object.keys(obj)) {
        if (String(key).toLowerCase() !== String(wanted).toLowerCase()) continue;
        const v = obj[key];
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s !== "") return s;
      }
    }
    return "";
  }

  function isActiveRow(g) {
    const a = pick(g, "Active", "active");
    if (a === "") return true;
    return a === "1" || a.toLowerCase() === "true" || a === "yes";
  }

  /** مقدار یکتای گزینه‌ی کمبو از ردیف گزارشات استاندارد */
  function groupCodeOf(g) {
    // اولویت: Id جدول پایه؛ در غیر این صورت ترکیب کدها
    const id = pick(g, "Id", "id");
    if (id) return id;
    const k = pick(g, "KOl_Code_st", "Kol_Code_st", "kol_code_st");
    const m = pick(g, "MOien_Code_st", "Moien_Code_st", "moien_code_st");
    const t = pick(g, "Tafsil_Code_st", "tafsil_code_st");
    const t1 = pick(g, "Tafsil_Code1_st", "tafsil_code1_st");
    const t2 = pick(g, "Tafsil_Code2_st", "tafsil_code2_st");
    return [k, m, t, t1, t2].filter(Boolean).join("_") || "";
  }

  /** برچسب کمبو: تمام ستون‌های معنادار */
  function groupLabelOf(g) {
    const parts = [];
    const push = (codeNames, titleNames) => {
      const c = pick(g, ...codeNames);
      const t = pick(g, ...titleNames);
      if (c || t) parts.push([c, t].filter(Boolean).join(" "));
    };
    push(["KOl_Code_st", "Kol_Code_st"], ["KOl_Onvan_st", "Kol_Onvan_st"]);
    push(["MOien_Code_st", "Moien_Code_st"], ["MOien_Onvan_st", "Moien_Onvan_st"]);
    push(["Tafsil_Code_st"], ["Tafsil_Onvan_st"]);
    push(["Tafsil_Code1_st"], ["Tafsil_Onvan1_st"]);
    push(["Tafsil_Code2_st"], ["Tafsil_Onvan2_st"]);
    const id = pick(g, "Id", "id");
    const body = parts.join(" | ") || "—";
    return id ? `${id} — ${body}` : body;
  }

  function mapValueOf(mapping) {
    if (!mapping) return "";
    return String(
      mapping.code_gozareshat_st ||
        mapping.Code_Gozareshat_st ||
        mapping.groupId ||
        ""
    ).trim();
  }

  function statusToPersian(st) {
    if (st === "synced") return "🟢 همگام";
    if (st === "no-group") return "🔴 بدون نگاشت";
    if (st === "pending-delete") return "🟠 حذف در انتظار";
    return "🟡 در انتظار ارسال";
  }

  // ─── init ───
  async function init() {
    try {
      grid = new BinaGrid("#gridContainer", {
        height: "640px",
        pageSize: 100,
        pageSizeOptions: [100, 500, 1000, 5000, true],
        rowSelector: true,
        storagePrefix: "BinaGozareshatSt",
        captions: {
          GroupTitle: "گزارشات استاندارد (st)",
          StatusLabel: "وضعیت",
          Kol_Code: "کد کل",
          Kol_Onvan: "عنوان کل",
          Moien_Code: "کد معین",
          Moien_Onvan: "عنوان معین",
          Tafsil_Code: "کد تفصیلی",
          Tafsil_Onvan: "عنوان تفصیلی",
        },
        presetcolumns: {
          GroupTitle: { width: 320, minWidth: 200, kind: "text" },
          StatusLabel: { width: 120, minWidth: 95, kind: "text" },
          Kol_Code: { width: 95, minWidth: 70, kind: "text" },
          Kol_Onvan: { width: 210, minWidth: 120, kind: "text" },
          Moien_Code: { width: 100, minWidth: 75, kind: "text" },
          Moien_Onvan: { width: 240, minWidth: 130, kind: "text" },
          Tafsil_Code: { width: 110, minWidth: 80, kind: "text" },
          Tafsil_Onvan: { width: 260, minWidth: 140, kind: "text" },
        },
      });

      grid.on("selectionChanged", ({ rows }) => {
        const hasSelection = rows > 0;
        if (applyGroupBtn) applyGroupBtn.disabled = !hasSelection;
        if (clearGroupBtn) clearGroupBtn.disabled = !hasSelection;
      });

      const endpoint =
        localStorage.getItem("bina_manager_endpoint") ||
        "http://localhost/FastDataHandler.ashx";
      dbManager = new Index_db({
        webservice: new window.webservice({ endpoint }),
      });
      await dbManager.initialize();

      const codes = await dbManager.getCompanyCodes();
      if (companySelect) {
        companySelect.innerHTML =
          '<option value="">انتخاب شرکت...</option>' +
          codes.map((c) => `<option value="${c}">${c}</option>`).join("");
      }

      await loadStandardGroups();

      if (codes.length > 0) {
        companySelect.value = codes[0];
        await syncAndLoadCompany(codes[0]);
      }
    } catch (err) {
      console.error("❌ خطا در راه‌اندازی:", err);
      alert("خطا: " + err.message);
    }
  }

  async function syncAndLoadCompany(companyCode) {
    if (!companyCode) return;
    currentCompanyCode = companyCode;
    if (loadAndSyncBtn) {
      loadAndSyncBtn.disabled = true;
      loadAndSyncBtn.textContent = "در حال همگام‌سازی...";
    }
    try {
      dbManager._tkReady = true;
      await dbManager.syncCodingIndex(currentCompanyCode);
      if (grid) grid._toast("✅ با سرور همگام شد");
    } catch (err) {
      console.warn("⚠️ همگام‌سازی coding_index:", err.message);
      if (grid) {
        grid._toast("⚠️ همگام‌سازی سرور ممکن نشد؛ دادهٔ محلی بارگذاری می‌شود");
      }
    }
    try {
      await loadAllData();
    } catch (err) {
      alert("❌ خطا در خواندن اطلاعات محلی: " + err.message);
    } finally {
      if (loadAndSyncBtn) {
        loadAndSyncBtn.disabled = false;
        loadAndSyncBtn.textContent = "همگام‌سازی با سرور";
      }
    }
  }

  // ─── بارگذاری tk_c_Gozareshat_st ───
  async function fetchGroupsFromServer(tableName) {
    const ws = dbManager.webservice;
    const stats = await (ws.fetchStats
      ? ws.fetchStats(tableName)
      : ws._fetchStats(tableName));
    const names = (stats.columns || []).map((c) => c.name);
    const out = [];
    for await (const pack of ws.fetchTable({
      table: tableName,
      batchSize: 5000,
      afterId: 0,
    })) {
      for (const row of pack.rows) {
        const obj = {};
        if (Array.isArray(row)) names.forEach((n, i) => (obj[n] = row[i]));
        else names.forEach((n) => (obj[n] = row[n]));
        out.push(obj);
      }
    }
    return out;
  }

  async function fetchGroupsFromLocal() {
    const pubDb = await dbManager._publicDB();
    for (const store of [LOOKUP_TABLE, "tk_c_gozareshat_st"]) {
      const real = Array.from(pubDb.objectStoreNames).find(
        (n) => n.toLowerCase() === store.toLowerCase()
      );
      if (!real) continue;
      const rows = await new Promise((res, rej) => {
        const tx = pubDb.transaction(real, "readonly");
        const req = tx.objectStore(real).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
      if (rows && rows.length) return rows;
    }
    return null;
  }

  async function loadStandardGroups() {
    try {
      let rows = null;
      try {
        rows = await fetchGroupsFromServer(LOOKUP_TABLE);
      } catch (err) {
        console.warn("⚠️ خواندن از سرور نشد، تلاش لوکال:", err.message);
        try {
          rows = await fetchGroupsFromLocal();
        } catch (_) {
          rows = null;
        }
      }

      standardGroups = (rows || []).filter(
        (g) => g && typeof g === "object" && isActiveRow(g)
      );

      // مرتب‌سازی تقریبی بر اساس کد کل / معین / تفصیل
      standardGroups.sort((a, b) => {
        const ak = pick(a, "KOl_Code_st", "Kol_Code_st");
        const bk = pick(b, "KOl_Code_st", "Kol_Code_st");
        if (ak !== bk) return String(ak).localeCompare(String(bk), "en", { numeric: true });
        const am = pick(a, "MOien_Code_st", "Moien_Code_st");
        const bm = pick(b, "MOien_Code_st", "Moien_Code_st");
        if (am !== bm) return String(am).localeCompare(String(bm), "en", { numeric: true });
        const at = pick(a, "Tafsil_Code_st");
        const bt = pick(b, "Tafsil_Code_st");
        return String(at).localeCompare(String(bt), "en", { numeric: true });
      });

      groupNameMap.clear();
      const topOpts = ['<option value="">— انتخاب ردیف گزارشات استاندارد —</option>'];
      const cellOpts = ['<option value="">— بدون نگاشت —</option>'];

      for (const g of standardGroups) {
        const code = groupCodeOf(g);
        if (!code) continue;
        const label = groupLabelOf(g);
        groupNameMap.set(code, label);
        topOpts.push(`<option value="${code}">${label}</option>`);
        cellOpts.push(`<option value="${code}">${label}</option>`);
      }

      if (assignGroupSelect) assignGroupSelect.innerHTML = topOpts.join("");
      groupOptionsHTML = cellOpts.join("");
      console.log(`Gozareshat_st گزینه‌ها: ${groupNameMap.size}`);
    } catch (err) {
      console.error("خطا در بارگذاری گروه‌ها:", err);
    }
  }

  async function setupGroupComboColumn() {
    const col = grid.table.getColumn("GroupTitle");
    if (!col) return;
    await col.updateDefinition({
      formatter: (cell) => {
        const rowData = cell.getRow().getData();
        const currentCode = String(rowData._groupId || "");
        const select = document.createElement("select");
        select.style.cssText =
          "width:100%; padding:3px 6px; font-family:inherit; font-size:11.5px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; cursor:pointer;";
        select.innerHTML = groupOptionsHTML;
        select.value = currentCode;
        select.addEventListener("pointerdown", (e) => e.stopPropagation());
        select.addEventListener("click", (e) => e.stopPropagation());
        select.addEventListener("change", (e) => {
          e.stopPropagation();
          applyGroupToKeys([rowData._key], select.value);
        });
        return select;
      },
    });
  }

  async function fetchAllCodingRows(companyCode) {
    const all = [];
    let afterId = -1;
    const BATCH = 10000;
    while (true) {
      const batch = await dbManager.getRows({
        companyCode,
        family: "coding",
        afterId,
        limit: BATCH,
      });
      if (!batch.length) break;
      all.push(...batch);
      afterId = batch[batch.length - 1].id;
      if (batch.length < BATCH) break;
    }
    return all;
  }

  async function loadAllData() {
    const [codingRows, mappingRows] = await Promise.all([
      fetchAllCodingRows(currentCompanyCode),
      dbManager.getCodingIndex(currentCompanyCode),
    ]);

    const mappingMap = new Map(mappingRows.map((r) => [r.key, r]));
    rowByKey.clear();

    allRows = codingRows.map((r, idx) => {
      const kol = String(pick(r, "kol_code", "Kol_Code", "KOl_Code") || "").trim();
      const moien = String(pick(r, "moien_code", "Moien_Code", "MOien_Code") || "").trim();
      const tafsil = String(pick(r, "tafsil_code", "Tafsil_Code") || "").trim();
      const key = `${currentCompanyCode}_${kol}_${moien}_${tafsil}`;
      const mapping = mappingMap.get(key);
      const groupCode = mapValueOf(mapping);
      const status = mapping ? mapping.status || "synced" : "no-group";

      const rowObj = {
        __id: idx + 1,
        _key: key,
        _groupId: groupCode,
        _status: status,
        GroupTitle: groupCode
          ? groupNameMap.get(groupCode) || `کد ${groupCode}`
          : "— بدون نگاشت —",
        StatusLabel: statusToPersian(status),
        Kol_Code: kol,
        Kol_Onvan: pick(r, "kol_onvan", "Kol_Onvan", "KOl_Onvan") || "",
        Moien_Code: moien,
        Moien_Onvan: pick(r, "moien_onvan", "Moien_Onvan", "MOien_Onvan") || "",
        Tafsil_Code: tafsil,
        Tafsil_Onvan: pick(r, "tafsil_onvan", "Tafsil_Onvan") || "",
      };
      rowByKey.set(key, rowObj);
      return rowObj;
    });

    await grid.setData(allRows, `GozareshatSt_${currentCompanyCode}`, { own: true });

    ["_key", "_groupId", "_status"].forEach((f) => {
      const c = grid.table.getColumn(f);
      if (c) c.hide();
    });

    await setupGroupComboColumn();
    updateStats();
  }

  function updateStats() {
    let synced = 0,
      pending = 0,
      noGroup = 0;
    for (const r of allRows) {
      if (r._status === "synced") synced++;
      else if (r._status === "no-group") noGroup++;
      else pending++;
    }
    statTotal.textContent = allRows.length.toLocaleString("fa-IR");
    statSynced.textContent = synced.toLocaleString("fa-IR");
    statPending.textContent = pending.toLocaleString("fa-IR");
    statNoGroup.textContent = noGroup.toLocaleString("fa-IR");
    pushToServerBtn.disabled = pending === 0;
    pushToServerBtn.textContent = `ارسال تغییرات به سرور (${pending})`;
  }

  /** ساخت آبجکت ذخیره‌سازی coding_index با فیلد Code_Gozareshat_st */
  function buildIndexRecord(row, groupCode, status) {
    return {
      key: row._key,
      companyCode: currentCompanyCode,
      kol_code: row.Kol_Code,
      moien_code: row.Moien_Code,
      tafsil_code: row.Tafsil_Code,
      // فیلد اصلی این صفحه
      code_gozareshat_st: groupCode || "",
      Code_Gozareshat_st: groupCode || "",
      // سازگاری با صفحات قبلی / manager
      groupId: groupCode || "",
      karbord: "گزارشات استاندارد",
      lastModified: Date.now(),
      status,
    };
  }

  async function applyGroupToKeys(keys, newGroupCode) {
    if (!keys.length) return;

    const compDb = await dbManager._companyDB(currentCompanyCode);
    const storeName = Array.from(compDb.objectStoreNames).find(
      (n) => n.toLowerCase() === "coding_index"
    );
    if (!storeName) {
      alert("استور coding_index وجود ندارد.");
      return;
    }

    const tx = compDb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const updatesForGrid = [];

    for (const key of keys) {
      const row = rowByKey.get(key);
      if (!row) continue;

      const existing = await new Promise((res) => {
        const req = store.get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });

      let newStatus = "no-group";
      if (!newGroupCode) {
        if (existing) {
          if (existing.status === "pending-insert") {
            store.delete(key);
          } else {
            const rec = {
              ...existing,
              status: "pending-delete",
              code_gozareshat_st: "",
              Code_Gozareshat_st: "",
              groupId: "",
              lastModified: Date.now(),
            };
            store.put(rec);
            newStatus = "pending-delete";
          }
        }
      } else {
        newStatus =
          existing && existing.status !== "pending-insert"
            ? "pending-update"
            : "pending-insert";
        store.put(buildIndexRecord(row, newGroupCode, newStatus));
      }

      row._groupId = newGroupCode || "";
      row._status = newStatus;
      row.GroupTitle = newGroupCode
        ? groupNameMap.get(newGroupCode) || `کد ${newGroupCode}`
        : "— بدون نگاشت —";
      row.StatusLabel = statusToPersian(newStatus);

      updatesForGrid.push({
        __id: row.__id,
        _groupId: row._groupId,
        _status: row._status,
        GroupTitle: row.GroupTitle,
        StatusLabel: row.StatusLabel,
      });
    }

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });

    if (updatesForGrid.length) await grid.table.updateData(updatesForGrid);
    updateStats();
    grid._toast(`${updatesForGrid.length} حساب به‌روزرسانی شد ✓`);
  }

  pushToServerBtn.onclick = async () => {
    const pendingRows = allRows.filter(
      (r) => r._status !== "synced" && r._status !== "no-group"
    );
    if (!pendingRows.length) return;

    const payload = pendingRows.map((r) => ({
      key: r._key,
      companyCode: currentCompanyCode,
      kol_code: r.Kol_Code,
      moien_code: r.Moien_Code,
      tafsil_code: r.Tafsil_Code,
      code_gozareshat_st: r._groupId,
      Code_Gozareshat_st: r._groupId,
      groupId: r._groupId,
      karbord: "گزارشات استاندارد",
      status: r._status,
      lastModified: Date.now(),
    }));

    pushToServerBtn.disabled = true;
    pushToServerBtn.textContent = "در حال ارسال...";
    try {
      const endpoint =
        localStorage.getItem("bina_manager_endpoint") ||
        "http://localhost/FastDataHandler.ashx";
      const res = await fetch(`${endpoint}?mode=save_coding_index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode: currentCompanyCode,
          mappings: payload,
        }),
      });
      const result = await res.json();
      if (!result.ok) throw new Error(result.error || "خطای سرور");

      const compDb = await dbManager._companyDB(currentCompanyCode);
      const storeName = Array.from(compDb.objectStoreNames).find(
        (n) => n.toLowerCase() === "coding_index"
      );
      const writeTx = compDb.transaction(storeName, "readwrite");
      const store = writeTx.objectStore(storeName);
      const updatesForGrid = [];

      for (const r of pendingRows) {
        if (r._status === "pending-delete") {
          store.delete(r._key);
          r._status = "no-group";
          r._groupId = "";
          r.GroupTitle = "— بدون نگاشت —";
        } else {
          r._status = "synced";
          store.put(buildIndexRecord(r, r._groupId, "synced"));
        }
        r.StatusLabel = statusToPersian(r._status);
        updatesForGrid.push({
          __id: r.__id,
          _groupId: r._groupId,
          _status: r._status,
          GroupTitle: r.GroupTitle,
          StatusLabel: r.StatusLabel,
        });
      }

      await new Promise((res2, rej) => {
        writeTx.oncomplete = res2;
        writeTx.onerror = () => rej(writeTx.error);
      });

      await grid.table.updateData(updatesForGrid);
      updateStats();
      grid._toast("✅ تغییرات با موفقیت در سرور ثبت شد");
    } catch (err) {
      alert("❌ خطا در ارسال: " + err.message);
    } finally {
      updateStats();
    }
  };

  if (applyGroupBtn) {
    applyGroupBtn.onclick = () => {
      const groupCode = assignGroupSelect?.value;
      if (!groupCode) return alert("ابتدا یک ردیف گزارشات استاندارد انتخاب کنید.");
      const selected = grid?.getSelectedData() || [];
      if (!selected.length) return;
      applyGroupToKeys(
        selected.map((r) => r._key),
        groupCode
      );
    };
  }
  if (clearGroupBtn) {
    clearGroupBtn.onclick = () => {
      const selected = grid?.getSelectedData() || [];
      if (!selected.length) return;
      applyGroupToKeys(
        selected.map((r) => r._key),
        ""
      );
    };
  }
  if (companySelect) {
    companySelect.onchange = async () => {
      if (!companySelect.value) return;
      currentCompanyCode = companySelect.value;
      await loadAllData();
    };
  }
  if (loadAndSyncBtn) {
    loadAndSyncBtn.onclick = () => {
      if (!companySelect?.value) return alert("لطفاً یک شرکت انتخاب کنید.");
      syncAndLoadCompany(companySelect.value);
    };
  }

  window.addEventListener("storage", (e) => {
    if (e.key === "sidebarLanguage" && e.newValue) {
      const isRtl = e.newValue === "fa" || e.newValue === "ar";
      document.documentElement.lang = e.newValue;
      document.documentElement.dir = isRtl ? "rtl" : "ltr";
      if (grid?.table?.redraw) grid.table.redraw(true);
    }
  });

  await init();
})();
