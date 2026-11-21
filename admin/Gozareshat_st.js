 (async function () {
    "use strict";

    const REPORT_STORE = "tk_c_gozareshat_st";
    const SERVER_FIELD = "Code_Gozareshat_st";
    const LOCAL_FIELD = "code_gozareshat_st";
    const GRID_COL = "Report_St";

    // ─── عناصر DOM ───
    const companySelect = document.getElementById("companySelect");
    const loadAndSyncBtn = document.getElementById("loadAndSyncBtn");
    const pushToServerBtn = document.getElementById("pushToServerBtn");
    const bulkPickerBtn = document.getElementById("bulkPickerBtn");
    const bulkPickerLabel = document.getElementById("bulkPickerLabel");
    const assignReportValue = document.getElementById("assignReportValue");
    const applyGroupBtn = document.getElementById("applyGroupBtn");
    const clearGroupBtn = document.getElementById("clearGroupBtn");

    const statTotal = document.getElementById("statTotal");
    const statSynced = document.getElementById("statSynced");
    const statPending = document.getElementById("statPending");
    const statNoGroup = document.getElementById("statNoGroup");

    // عناصر مودال جدول‌نما
    const reportPickerModal = document.getElementById("reportPickerModal");
    const closePickerBtn = document.getElementById("closePickerBtn");
    const pickerSearchInput = document.getElementById("pickerSearchInput");
    const pickerClearOptionBtn = document.getElementById("pickerClearOptionBtn");
    const pickerCount = document.getElementById("pickerCount");
    const pickerTableBody = document.getElementById("pickerTableBody");

    // ─── State ───
    let dbManager = null;
    let grid = null;
    let reportItems = [];
    let reportByTriple = new Map();
    let allRows = [];
    const rowByKey = new Map();
    let currentCompanyCode = null;
    let pickerCallback = null;
    let pickerSelectedCode = "";

    const endpoint = () =>
        localStorage.getItem("bina_manager_endpoint") || "http://localhost/FastDataHandler.ashx";

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

    function statusToPersian(st) {
        if (st === "synced") return "🟢 همگام";
        if (st === "no-group") return "🔴 بدون نگاشت";
        if (st === "pending-delete") return "🟠 حذف در انتظار";
        return "🟡 در انتظار ارسال";
    }

    // ساخت کد ترکیبی کل-معین-تفصیل
    function buildTripleCode(kol, moien, tafsil) {
        return [kol, moien, tafsil]
            .map(v => String(v ?? "").trim())
            .filter(v => v !== "")
            .join("-");
    }

    // ─── ۱. دریافت نام دیتابیس‌های عددی شرکت‌ها از IndexedDB (کاملاً لوکال) ───
    async function getNumericCompanyDBs() {
        const set = new Set();

        if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
            try {
                const dbs = await indexedDB.databases();
                for (const d of (dbs || [])) {
                    const name = String(d && d.name ? d.name : "").trim();
                    if (/^\d+$/.test(name)) set.add(name);
                }
            } catch (_) { /* ادامه */ }
        }

        if (!set.size && dbManager && typeof dbManager.listLocalInventory === "function") {
            try {
                const inv = await dbManager.listLocalInventory();
                for (const item of (inv || [])) {
                    const name = String(item && item.database ? item.database : "").trim();
                    if (/^\d+$/.test(name)) set.add(name);
                }
            } catch (_) { /* ادامه */ }
        }

        if (!set.size && dbManager && typeof dbManager.getCompanyCodes === "function") {
            try {
                const codes = await dbManager.getCompanyCodes();
                for (const c of (codes || [])) {
                    const s = String(c || "").trim();
                    if (/^\d+$/.test(s)) set.add(s);
                }
            } catch (_) { /* ادامه */ }
        }

        return Array.from(set).sort((a, b) => Number(a) - Number(b));
    }

    // ─── ۲. خواندن دقیق استور tk_c_gozareshat_st از دیتابیس public لوکال ───
    function parseReportRow(row) {
        if (!row || typeof row !== "object") return null;

        const rowKey = pick(row, "key", "id", "Id");
        const kolCode = pick(row, "kol_code_st", "KOl_Code_st", "Kol_Code_st");
        const kolOnvan = pick(row, "kol_onvan_st", "KOl_Onvan_st", "Kol_Onvan_st");
        const moienCode = pick(row, "moien_code_st", "MOien_Code_st", "Moien_Code_st");
        const moienOnvan = pick(row, "moien_onvan_st", "MOien_Onvan_st", "Moien_Onvan_st");
        const tafsilCode = pick(row, "tafsil_code_st", "Tafsil_Code_st");
        const tafsilOnvan = pick(row, "tafsil_onvan_st", "Tafsil_Onvan_st");
        const tafsilCode1 = pick(row, "tafsil_code1_st", "Tafsil_Code1_st");
        const tafsilOnvan1 = pick(row, "tafsil_onvan1_st", "Tafsil_Onvan1_st");
        const tafsilCode2 = pick(row, "tafsil_code2_st", "Tafsil_Code2_st");
        const tafsilOnvan2 = pick(row, "tafsil_onvan2_st", "Tafsil_Onvan2_st");
        const active = pick(row, "active", "Active");

        const tripleCode = buildTripleCode(kolCode, moienCode, tafsilCode) || rowKey;
        if (!tripleCode) return null;

        const titleParts = [kolOnvan, moienOnvan, tafsilOnvan, tafsilOnvan1, tafsilOnvan2].filter(Boolean);
        const shortTitle = titleParts.join(" / ") || `کد ${tripleCode}`;
        const searchBlob = [
            rowKey, tripleCode, kolCode, kolOnvan, moienCode, moienOnvan,
            tafsilCode, tafsilOnvan, tafsilCode1, tafsilOnvan1, tafsilCode2, tafsilOnvan2, active
        ].join(" ").toLowerCase();

        return {
            rowKey,
            tripleCode,
            kolCode,
            kolOnvan,
            moienCode,
            moienOnvan,
            tafsilCode,
            tafsilOnvan,
            tafsilCode1,
            tafsilOnvan1,
            tafsilCode2,
            tafsilOnvan2,
            active,
            shortTitle,
            searchBlob
        };
    }

    async function loadStandardReportsFromLocal() {
        const pubDb = await dbManager._publicDB();
        let storeName = null;
        for (const name of pubDb.objectStoreNames) {
            if (String(name).toLowerCase() === REPORT_STORE) {
                storeName = name;
                break;
            }
        }

        let rows = [];
        if (storeName) {
            rows = await new Promise((res, rej) => {
                const tx = pubDb.transaction(storeName, "readonly");
                const req = tx.objectStore(storeName).getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
        }

        reportItems = [];
        reportByTriple.clear();

        for (const r of rows) {
            const parsed = parseReportRow(r);
            if (!parsed) continue;
            reportItems.push(parsed);
            if (!reportByTriple.has(parsed.tripleCode)) {
                reportByTriple.set(parsed.tripleCode, parsed);
            }
        }

        reportItems.sort((a, b) =>
            Number(a.rowKey || 0) - Number(b.rowKey || 0) ||
            a.tripleCode.localeCompare(b.tripleCode, "en", { numeric: true })
        );
    }

    // ─── ۳. مودال جدول‌نما برای ستون‌های tk_c_gozareshat_st ───
    function renderPickerRows(filterText = "") {
        const q = String(filterText || "").trim().toLowerCase();
        const filtered = q
            ? reportItems.filter(it => it.searchBlob.includes(q))
            : reportItems;

        if (pickerCount) pickerCount.textContent = filtered.length.toLocaleString("fa-IR");

        const html = filtered.slice(0, 500).map(it => {
            const selClass = it.tripleCode === pickerSelectedCode ? "is-selected" : "";
            return `<tr class="${selClass}" data-code="${it.tripleCode}">
                <td>${it.rowKey || "-"}</td>
                <td><span class="code-badge">${it.tripleCode}</span></td>
                <td>${it.kolCode || "-"}</td>
                <td>${it.kolOnvan || "-"}</td>
                <td>${it.moienCode || "-"}</td>
                <td>${it.moienOnvan || "-"}</td>
                <td>${it.tafsilCode || "-"}</td>
                <td>${it.tafsilOnvan || "-"}</td>
                <td>${it.tafsilCode1 || "-"}</td>
                <td>${it.tafsilOnvan1 || "-"}</td>
                <td>${it.tafsilCode2 || "-"}</td>
                <td>${it.tafsilOnvan2 || "-"}</td>
                <td>${it.active || "-"}</td>
            </tr>`;
        }).join("");

        pickerTableBody.innerHTML = html ||
            '<tr><td colspan="13" style="text-align:center;padding:16px;color:#64748b;">موردی یافت نشد</td></tr>';
    }

    function openReportPicker(currentCode, onSelect) {
        pickerSelectedCode = String(currentCode || "").trim();
        pickerCallback = onSelect;
        if (pickerSearchInput) pickerSearchInput.value = "";
        renderPickerRows("");
        reportPickerModal.classList.add("open");
        setTimeout(() => pickerSearchInput && pickerSearchInput.focus(), 30);
    }

    function closeReportPicker() {
        reportPickerModal.classList.remove("open");
        pickerCallback = null;
    }

    if (pickerSearchInput) {
        pickerSearchInput.addEventListener("input", () => {
            renderPickerRows(pickerSearchInput.value);
        });
    }

    if (pickerTableBody) {
        pickerTableBody.addEventListener("click", (e) => {
            const tr = e.target.closest("tr[data-code]");
            if (!tr) return;
            const code = tr.dataset.code;
            const cb = pickerCallback;
            closeReportPicker();
            if (typeof cb === "function") cb(code);
        });
    }

    if (pickerClearOptionBtn) {
        pickerClearOptionBtn.onclick = () => {
            const cb = pickerCallback;
            closeReportPicker();
            if (typeof cb === "function") cb("");
        };
    }

    if (closePickerBtn) closePickerBtn.onclick = closeReportPicker;
    if (reportPickerModal) {
        reportPickerModal.addEventListener("click", (e) => {
            if (e.target === reportPickerModal) closeReportPicker();
        });
    }

    // ─── ۴. راه‌اندازی اولیه کاملاً لوکال ───
    async function init() {
        grid = new BinaGrid("#gridContainer", {
            height: "640px",
            pageSize: 100,
            pageSizeOptions: [100, 500, 1000, 5000, true],
            rowSelector: true,
            storagePrefix: "BinaCodingGozareshatStV4",
            captions: {
                [GRID_COL]: "گزارش استاندارد (tk_c_gozareshat_st)",
                StatusLabel: "وضعیت",
                Kol_Code: "کد کل",
                Kol_Onvan: "عنوان کل",
                Moien_Code: "کد معین",
                Moien_Onvan: "عنوان معین",
                Tafsil_Code: "کد تفصیلی",
                Tafsil_Onvan: "عنوان تفصیلی"
            },
            presetcolumns: {
                [GRID_COL]: { width: 320, minWidth: 210, kind: "text" },
                StatusLabel: { width: 125, minWidth: 95, kind: "text" },
                Kol_Code: { width: 85, minWidth: 65, kind: "text" },
                Kol_Onvan: { width: 190, minWidth: 110, kind: "text" },
                Moien_Code: { width: 95, minWidth: 70, kind: "text" },
                Moien_Onvan: { width: 200, minWidth: 120, kind: "text" },
                Tafsil_Code: { width: 105, minWidth: 75, kind: "text" },
                Tafsil_Onvan: { width: 200, minWidth: 120, kind: "text" }
            }
        });

        grid.on("selectionChanged", ({ rows }) => {
            const disabled = !rows;
            if (applyGroupBtn) applyGroupBtn.disabled = disabled;
            if (clearGroupBtn) clearGroupBtn.disabled = disabled;
        });

        dbManager = new Index_db({
            webservice: new window.webservice({ endpoint: endpoint() })
        });
        await dbManager.initialize();

        const codes = await getNumericCompanyDBs();
        if (companySelect) {
            companySelect.innerHTML =
                '<option value="">انتخاب شرکت...</option>' +
                codes.map(c => `<option value="${c}">${c}</option>`).join("");
        }

        await loadStandardReportsFromLocal();

        if (codes.length > 0) {
            currentCompanyCode = codes[0];
            companySelect.value = codes[0];
            await loadAllData();
        }
    }

    // ─── ۵. خواندن حساب‌های coding شرکت از IndexedDB ───
    async function fetchAllCodingRows(companyCode) {
        const all = [];
        let afterId = -1;
        const BATCH = 10000;
        while (true) {
            const batch = await dbManager.getRows({
                companyCode,
                family: "coding",
                afterId,
                limit: BATCH
            });
            if (!batch.length) break;
            all.push(...batch);
            afterId = batch[batch.length - 1].id;
            if (batch.length < BATCH) break;
        }
        return all;
    }

    function getSavedReportCode(rec) {
        if (!rec) return "";
        return String(
            rec[LOCAL_FIELD] ??
            rec[SERVER_FIELD] ??
            rec.code_gozareshat_st ??
            rec.Code_Gozareshat_st ??
            ""
        ).trim();
    }

    function displayReportSummary(code) {
        const v = String(code || "").trim();
        if (!v) return "— انتخاب از tk_c_gozareshat_st —";
        const item = reportByTriple.get(v);
        return item ? `${v} | ${item.shortTitle}` : v;
    }

    async function loadAllData() {
        if (!currentCompanyCode) return;

        const [codingRows, mappingRows] = await Promise.all([
            fetchAllCodingRows(currentCompanyCode),
            dbManager.getCodingIndex(currentCompanyCode)
        ]);

        const mappingMap = new Map(mappingRows.map(r => [String(r.key), r]));
        rowByKey.clear();

        allRows = codingRows.map((r, idx) => {
            const kol = String(r.kol_code || "").trim();
            const moien = String(r.moien_code || "").trim();
            const tafsil = String(r.tafsil_code || "").trim();
            const key = `${currentCompanyCode}_${kol}_${moien}_${tafsil}`;
            const rec = mappingMap.get(key);

            const code = getSavedReportCode(rec);
            const status = rec && code ? (rec.status || "synced") : "no-group";

            const rowObj = {
                __id: idx + 1,
                _key: key,
                _reportCode: code,
                _status: status,
                [GRID_COL]: displayReportSummary(code),
                StatusLabel: statusToPersian(status),
                Kol_Code: kol,
                Kol_Onvan: r.kol_onvan || "",
                Moien_Code: moien,
                Moien_Onvan: r.moien_onvan || "",
                Tafsil_Code: tafsil,
                Tafsil_Onvan: r.tafsil_onvan || ""
            };
            rowByKey.set(key, rowObj);
            return rowObj;
        });

        await grid.setData(allRows, `CodingGozareshatSt_${currentCompanyCode}`, { own: true });

        ["_key", "_reportCode", "_status"].forEach(f => {
            const col = grid.table.getColumn(f);
            if (col) col.hide();
        });

        await setupReportComboColumn();
        updateStats();
    }

    async function setupReportComboColumn() {
        const col = grid.table.getColumn(GRID_COL);
        if (!col) return;

        await col.updateDefinition({
            formatter: (cell) => {
                const rowData = cell.getRow().getData();
                const currentCode = String(rowData._reportCode || "");
                const item = reportByTriple.get(currentCode);

                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "cell-combo-btn" + (currentCode ? " has-val" : "");

                const titleSpan = document.createElement("span");
                titleSpan.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                titleSpan.textContent = currentCode
                    ? (item ? item.shortTitle : currentCode)
                    : "— انتخاب از tk_c_gozareshat_st —";

                const badgeSpan = document.createElement("span");
                badgeSpan.className = "cell-combo-code";
                badgeSpan.textContent = currentCode ? `${currentCode} ▾` : "انتخاب ▾";

                btn.append(titleSpan, badgeSpan);

                btn.addEventListener("pointerdown", (e) => e.stopPropagation());
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openReportPicker(currentCode, async (pickedCode) => {
                        await applyReportCodeToKeys([rowData._key], pickedCode);
                    });
                });

                return btn;
            }
        });
    }

    function updateStats() {
        let synced = 0, pending = 0, noGroup = 0;
        for (const r of allRows) {
            if (r._status === "synced") synced++;
            else if (r._status === "no-group") noGroup++;
            else pending++;
        }
        const fa = (n) => n.toLocaleString("fa-IR");
        if (statTotal) statTotal.textContent = fa(allRows.length);
        if (statSynced) statSynced.textContent = fa(synced);
        if (statPending) statPending.textContent = fa(pending);
        if (statNoGroup) statNoGroup.textContent = fa(noGroup);

        if (pushToServerBtn) {
            pushToServerBtn.disabled = pending === 0;
            pushToServerBtn.textContent = `ثبت دایم در سرور (${pending})`;
        }
    }

    // ─── ۶. ذخیره کد ترکیبی کل-معین-تفصیل در استور لوکال coding_index ───
    async function applyReportCodeToKeys(keys, newReportCode) {
        if (!keys.length || !currentCompanyCode) return;
        const cleanCode = String(newReportCode || "").trim();

        const compDb = await dbManager._companyDB(currentCompanyCode);
        const existing = new Map();
        {
            const tx = compDb.transaction("coding_index", "readonly");
            const store = tx.objectStore("coding_index");
            await Promise.all(
                keys.map(key => new Promise(res => {
                    const req = store.get(key);
                    req.onsuccess = () => {
                        if (req.result) existing.set(key, req.result);
                        res();
                    };
                    req.onerror = () => res();
                }))
            );
        }

        const writes = [];
        const updatesForGrid = [];

        for (const key of keys) {
            const row = rowByKey.get(key);
            if (!row) continue;

            const rec = existing.get(key);
            let nextStatus = "no-group";

            if (!cleanCode) {
                if (rec && rec.status === "pending-insert") {
                    writes.push({ op: "delete", key });
                    nextStatus = "no-group";
                } else if (rec) {
                    writes.push({
                        op: "put",
                        rec: {
                            ...rec,
                            [LOCAL_FIELD]: "",
                            [SERVER_FIELD]: "",
                            status: "pending-delete",
                            lastModified: Date.now()
                        }
                    });
                    nextStatus = "pending-delete";
                }
            } else {
                nextStatus =
                    rec && rec.status && rec.status !== "pending-insert"
                        ? "pending-update"
                        : "pending-insert";

                writes.push({
                    op: "put",
                    rec: {
                        ...(rec || {}),
                        key,
                        codehesab: key,
                        companyCode: currentCompanyCode,
                        kol_code: row.Kol_Code,
                        moien_code: row.Moien_Code,
                        tafsil_code: row.Tafsil_Code,
                        [LOCAL_FIELD]: cleanCode,
                        [SERVER_FIELD]: cleanCode,
                        status: nextStatus,
                        lastModified: Date.now()
                    }
                });
            }

            row._reportCode = cleanCode;
            row._status = nextStatus;
            row[GRID_COL] = displayReportSummary(cleanCode);
            row.StatusLabel = statusToPersian(nextStatus);

            updatesForGrid.push({
                __id: row.__id,
                _reportCode: row._reportCode,
                _status: row._status,
                [GRID_COL]: row[GRID_COL],
                StatusLabel: row.StatusLabel
            });
        }

        if (writes.length) {
            const tx = compDb.transaction("coding_index", "readwrite");
            const store = tx.objectStore("coding_index");
            for (const w of writes) {
                if (w.op === "delete") store.delete(w.key);
                else store.put(w.rec);
            }
            await new Promise((res, rej) => {
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });
        }

        if (updatesForGrid.length) {
            await grid.table.updateData(updatesForGrid);
        }
        updateStats();
        if (updatesForGrid.length && grid._toast) {
            grid._toast(`${updatesForGrid.length} حساب به‌روزرسانی شد ✓`);
        }
    }

    // ─── ۷. ارسال به سرور با فیلد Code_Gozareshat_st ───
// ─── ۷. ارسال به سرور با فیلد Code_Gozareshat_st ───
    async function pushToServer() {
        const pendingRows = allRows.filter(
            r => r._status && r._status !== "synced" && r._status !== "no-group"
        );
        if (!pendingRows.length) {
            alert("هیچ تغییر در انتظار ارسالی وجود ندارد.");
            return;
        }

        const compDb = await dbManager._companyDB(currentCompanyCode);
        const existingMap = new Map();
        {
            const tx = compDb.transaction("coding_index", "readonly");
            const store = tx.objectStore("coding_index");
            await Promise.all(
                pendingRows.map(r => new Promise(res => {
                    const req = store.get(r._key);
                    req.onsuccess = () => {
                        if (req.result) existingMap.set(r._key, req.result);
                        res();
                    };
                    req.onerror = () => res();
                }))
            );
        }

        const payload = pendingRows.map(r => {
            const old = existingMap.get(r._key) || {};
            const hasOtherFields =
                String(old.code_soratmali_sh ?? old.Code_SoratMali_sh ?? "").trim() !== "" ||
                String(old.code_soratmali_st ?? old.Code_SoratMali_st ?? "").trim() !== "" ||
                String(old.code_gozareshat_sh ?? old.Code_Gozareshat_sh ?? "").trim() !== "";

            const effectiveStatus =
                r._status === "pending-delete" && hasOtherFields
                    ? "pending-update"
                    : r._status;

            return {
                key: r._key,
                codehesab: r._key,
                companyCode: currentCompanyCode,
                kol_code: r.Kol_Code,
                moien_code: r.Moien_Code,
                tafsil_code: r.Tafsil_Code,
                Code_SoratMali_sh: old.code_soratmali_sh ?? old.Code_SoratMali_sh ?? null,
                Code_SoratMali_st: old.code_soratmali_st ?? old.Code_SoratMali_st ?? null,
                Code_Gozareshat_sh: old.code_gozareshat_sh ?? old.Code_Gozareshat_sh ?? null,
                Code_Gozareshat_st: r._reportCode || null,
                status: effectiveStatus,
                lastModified: Date.now()
            };
        });

        console.log("📤 Payload sent to save_coding_index:", payload);

        if (pushToServerBtn) {
            pushToServerBtn.disabled = true;
            pushToServerBtn.textContent = "در حال ارسال...";
        }

        try {
            const url = `${endpoint()}?mode=save_coding_index`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyCode: currentCompanyCode, mappings: payload })
            });
            const text = await res.text();
            console.log("📥 Server response:", res.status, text);

            let result;
            try {
                result = JSON.parse(text);
            } catch (_) {
                throw new Error(`پاسخ غیر JSON از سرور (${res.status}): ${text.slice(0, 220)}`);
            }
            if (!res.ok || result.ok === false) {
                throw new Error(result.error || result.message || `خطای سرور (${res.status})`);
            }

            const tx = compDb.transaction("coding_index", "readwrite");
            const store = tx.objectStore("coding_index");
            const updatesForGrid = [];

            for (const r of pendingRows) {
                const old = existingMap.get(r._key) || {};
                if (r._status === "pending-delete") {
                    const hasOther =
                        String(old.code_soratmali_sh ?? old.Code_SoratMali_sh ?? "").trim() !== "" ||
                        String(old.code_soratmali_st ?? old.Code_SoratMali_st ?? "").trim() !== "" ||
                        String(old.code_gozareshat_sh ?? old.Code_Gozareshat_sh ?? "").trim() !== "";
                    if (hasOther) {
                        store.put({
                            ...old,
                            [LOCAL_FIELD]: "",
                            [SERVER_FIELD]: "",
                            status: "synced",
                            lastModified: Date.now()
                        });
                    } else {
                        store.delete(r._key);
                    }
                    r._status = "no-group";
                    r._reportCode = "";
                } else {
                    r._status = "synced";
                    store.put({
                        ...old,
                        key: r._key,
                        codehesab: r._key,
                        companyCode: currentCompanyCode,
                        kol_code: r.Kol_Code,
                        moien_code: r.Moien_Code,
                        tafsil_code: r.Tafsil_Code,
                        [LOCAL_FIELD]: r._reportCode,
                        [SERVER_FIELD]: r._reportCode,
                        status: "synced",
                        lastModified: Date.now()
                    });
                }
                r[GRID_COL] = displayReportSummary(r._reportCode);
                r.StatusLabel = statusToPersian(r._status);

                updatesForGrid.push({
                    __id: r.__id,
                    _reportCode: r._reportCode,
                    _status: r._status,
                    [GRID_COL]: r[GRID_COL],
                    StatusLabel: r.StatusLabel
                });
            }

            await new Promise((res2, rej2) => {
                tx.oncomplete = res2;
                tx.onerror = () => rej2(tx.error);
            });

            await grid.table.updateData(updatesForGrid);
            updateStats();
            if (grid._toast) {
                grid._toast(`✅ ${result.saved ?? pendingRows.length} نگاشت ثبت و ${result.deleted ?? 0} حذف شد`);
            }
        } catch (err) {
            console.error("❌ pushToServer error:", err);
            alert("❌ خطا در ارسال به سرور: " + err.message);
        } finally {
            updateStats();
        }
    }
    // ─── ۸. رویدادها ───
    if (companySelect) {
        companySelect.onchange = async () => {
            if (!companySelect.value) return;
            currentCompanyCode = companySelect.value;
            await loadAllData();
        };
    }

    if (loadAndSyncBtn) {
        loadAndSyncBtn.onclick = async () => {
            if (!companySelect || !companySelect.value) return alert("لطفاً یک شرکت انتخاب کنید.");
            currentCompanyCode = companySelect.value;
            await loadStandardReportsFromLocal();
            await loadAllData();
            if (grid && grid._toast) grid._toast("✅ داده‌ها از tk_c_gozareshat_st لوکال بازخوانی شدند");
        };
    }

    if (bulkPickerBtn) {
        bulkPickerBtn.onclick = () => {
            openReportPicker(assignReportValue.value, (code) => {
                assignReportValue.value = code;
                if (bulkPickerLabel) {
                    bulkPickerLabel.textContent = code
                        ? displayReportSummary(code)
                        : "— انتخاب از tk_c_gozareshat_st —";
                }
            });
        };
    }

    if (applyGroupBtn) {
        applyGroupBtn.onclick = async () => {
            const code = assignReportValue ? String(assignReportValue.value || "").trim() : "";
            if (!code) return alert("ابتدا از جدول tk_c_gozareshat_st یک آیتم انتخاب کنید.");
            const selected = (grid && grid.getSelectedData && grid.getSelectedData()) || [];
            if (!selected.length) return alert("ابتدا ردیف‌ها را انتخاب کنید.");
            await applyReportCodeToKeys(selected.map(r => r._key), code);
        };
    }

    if (clearGroupBtn) {
        clearGroupBtn.onclick = async () => {
            const selected = (grid && grid.getSelectedData && grid.getSelectedData()) || [];
            if (!selected.length) return;
            await applyReportCodeToKeys(selected.map(r => r._key), "");
        };
    }

    if (pushToServerBtn) pushToServerBtn.onclick = () => pushToServer();

    window.addEventListener("storage", (e) => {
        if (e.key === "sidebarLanguage" && e.newValue) {
            const isRtl = e.newValue === "fa" || e.newValue === "ar";
            document.documentElement.lang = e.newValue;
            document.documentElement.dir = isRtl ? "rtl" : "ltr";
            if (grid && grid.table && grid.table.redraw) grid.table.redraw(true);
        }
    });

    try {
        await init();
    } catch (err) {
        console.error("❌ خطا در راه‌اندازی:", err);
        alert("خطا: " + err.message);
    }
})();