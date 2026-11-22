(async function () {
    "use strict";

    const REPORT_TABLE = "tk_g_soratmali_st";   // جدول پایهٔ صورت مالی استاندارد در سرور
    const REPORT_STORE = "tk_g_soratmali_st";   // نام استور محلی در دیتابیس public
    const SERVER_FIELD = "Code_SoratMali_st";
    const LOCAL_FIELD = "code_soratmali_st";
    const GRID_COL = "SoratMali_St";

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
    let reportByCode = new Map();
    let allRows = [];
    const rowByKey = new Map();
    let currentCompanyCode = null;
    let pickerCallback = null;
    let pickerSelectedCode = "";

    const endpoint = () =>
        localStorage.getItem("bina_manager_endpoint") || "http://localhost/FastDataHandler.ashx";

    // ─── ابزارها ───
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

    function normCode(v) {
        const s = String(v ?? "").trim();
        return s === "" ? "" : s;
    }

    // کد عددی معتبر برای ستون‌های سرور (ستون‌ها عددی‌اند؛ مقدار غیرعددی 400 می‌دهد)
    function numericOrNull(v) {
        const s = String(v ?? "").trim();
        return /^\d+$/.test(s) && s !== "0" ? s : null;
    }

    function statusToPersian(st) {
        if (st === "synced") return "🟢 همگام";
        if (st === "no-group") return "🔴 بدون نگاشت";
        if (st === "pending-delete") return "🟠 حذف در انتظار";
        return "🟡 در انتظار ارسال";
    }

    // خواندن جدول از سرویس (منبع اصلی)
    async function fetchTableFromServer(tableName, batchSize = 20000) {
        const ws = dbManager.webservice;
        const stats = await ws.fetchStats(tableName);
        const names = (stats.columns || []).map(c => String(c.name));
        const out = [];
        for await (const pack of ws.fetchTable({ table: tableName, batchSize, afterId: 0 })) {
            for (const row of pack.rows) {
                const obj = {};
                if (Array.isArray(row)) names.forEach((n, i) => { obj[n] = row[i]; });
                else names.forEach(n => { obj[n] = row[n]; });
                out.push(obj);
            }
        }
        return { rows: out, columns: names };
    }

    // ─── ۱. خواندن جدول پایه tk_g_soratmali_st ───
    // ستون‌ها: TartibNamayesh, Code_SoratMali_st, Onvan, Karbord, Mahiat, Id
    function parseReportRow(row) {
        if (!row || typeof row !== "object") return null;

        const rowKey = pick(row, "Id", "id", "key");
        const code = pick(row, "Code_SoratMali_st", "code_soratmali_st", "Code", "code");
        const onvan = pick(row, "Onvan", "onvan", "OnvanGoroh");
        const karbord = pick(row, "Karbord", "karbord");
        const mahiat = pick(row, "Mahiat", "mahiat");
        const tartib = pick(row, "TartibNamayesh", "tartibnamayesh");

        if (!code) return null;

        const shortTitle = onvan || `کد ${code}`;
        const searchBlob = [rowKey, code, onvan, karbord, mahiat, tartib]
            .join(" ").toLowerCase();

        return {
            rowKey, code, onvan, karbord, mahiat, tartib,
            shortTitle, searchBlob
        };
    }

    async function readReportsFromLocal() {
        const pubDb = await dbManager._publicDB();
        let storeName = null;
        for (const name of pubDb.objectStoreNames) {
            if (String(name).toLowerCase() === REPORT_STORE) { storeName = name; break; }
        }
        if (!storeName) return [];

        return await new Promise((res, rej) => {
            const tx = pubDb.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => rej(req.error);
        });
    }

    async function loadStandardReports() {
        let rows = null;

        // ۱) سرور (منبع اصلی)
        try {
            const server = await fetchTableFromServer(REPORT_TABLE);
            rows = server.rows;
            console.log(`صورت مالی استاندارد از سرور (${REPORT_TABLE}): ${rows.length}`);
        } catch (err) {
            console.warn(`⚠️ خواندن ${REPORT_TABLE} از سرور نشد، تلاش از حافظه محلی:`, err.message);
        }

        // ۲) حافظه محلی
        if (!rows || !rows.length) {
            try {
                rows = await readReportsFromLocal();
                console.log(`صورت مالی استاندارد از حافظه محلی (${REPORT_STORE}): ${(rows || []).length}`);
            } catch (err2) {
                console.warn("⚠️ خواندن صورت مالی استاندارد از حافظه محلی هم نشد:", err2.message);
                rows = [];
            }
        }

        reportItems = [];
        reportByCode.clear();

        for (const r of (rows || [])) {
            const parsed = parseReportRow(r);
            if (!parsed) continue;
            reportItems.push(parsed);
            if (!reportByCode.has(parsed.code)) reportByCode.set(parsed.code, parsed);
        }

        // مرتب‌سازی بر اساس TartibNamayesh و سپس کد
        reportItems.sort((a, b) =>
            (Number(a.tartib || 9999) - Number(b.tartib || 9999)) ||
            String(a.code).localeCompare(String(b.code), "en", { numeric: true })
        );

        return reportItems.length;
    }

    // ─── ۲. کدهای شرکت: اول سرور، بعد دیتابیس‌های عددی محلی ───
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

        return Array.from(set).sort((a, b) => Number(a) - Number(b));
    }

    async function loadCompanyCodes() {
        let codes = [];
        try {
            codes = (await dbManager.getCompanyCodes()) || [];
        } catch (err) {
            console.warn("⚠️ فهرست شرکت‌ها از سرور خوانده نشد:", err.message);
        }
        if (!codes.length) codes = await getNumericCompanyDBs();
        return codes.filter(c => /^\d+$/.test(String(c)))
            .sort((a, b) => Number(a) - Number(b));
    }

    // ─── ۳. خواندن حساب‌های coding شرکت (لوکال، با پشتیبان سرور) ───
    async function fetchCodingFromServer(companyCode) {
        const table = `coding_${companyCode}`;
        const { rows } = await fetchTableFromServer(table, 20000);
        return rows.map((obj, i) => ({
            id: Number(pick(obj, "Id", "id")) || (i + 1),
            kol_code: normCode(pick(obj, "KOl_Code", "Kol_Code", "kol_code")),
            kol_onvan: pick(obj, "KOl_Onvan", "Kol_Onvan", "kol_onvan"),
            moien_code: normCode(pick(obj, "MOien_Code", "Moien_Code", "moien_code")),
            moien_onvan: pick(obj, "MOien_Onvan", "Moien_Onvan", "moien_onvan"),
            tafsil_code: normCode(pick(obj, "Tafsil_Code", "tafsil_code")),
            tafsil_onvan: pick(obj, "Tafsil_Onvan", "tafsil_onvan")
        }));
    }

    async function fetchAllCodingRows(companyCode) {
        const all = [];
        let afterId = -1;
        const BATCH = 10000;

        try {
            while (true) {
                const batch = await dbManager.getRows({
                    companyCode, family: "coding", afterId, limit: BATCH
                });
                if (!batch.length) break;
                all.push(...batch);
                afterId = batch[batch.length - 1].id;
                if (batch.length < BATCH) break;
            }
        } catch (err) {
            console.warn("⚠️ خواندن coding از حافظه محلی نشد:", err.message);
        }

        if (all.length) return all;

        try {
            const srv = await fetchCodingFromServer(companyCode);
            if (srv.length) {
                console.log(`حساب‌های شرکت ${companyCode} از سرور (coding_${companyCode}): ${srv.length}`);
                return srv;
            }
        } catch (err) {
            console.warn(`⚠️ خواندن coding_${companyCode} از سرور نشد:`, err.message);
        }
        return all;
    }

    // ─── ۴. مودال جدول‌نما (همهٔ ستون‌های tk_g_soratmali_st) ───
    const PICKER_RENDER_LIMIT = 200;
    let pickerSearchTimer = 0;

    function renderPickerRows(filterText = "") {
        const q = String(filterText || "").trim().toLowerCase();
        const filtered = q ? reportItems.filter(it => it.searchBlob.includes(q)) : reportItems;

        if (pickerCount) pickerCount.textContent = filtered.length.toLocaleString("fa-IR");

        const shown = filtered.slice(0, PICKER_RENDER_LIMIT);
        const html = shown.map(it => {
            const selClass = it.code === pickerSelectedCode ? "is-selected" : "";
            return `<tr class="${selClass}" data-code="${it.code}">
                <td>${it.rowKey || "-"}</td>
                <td>${it.tartib || "-"}</td>
                <td><span class="code-badge">${it.code}</span></td>
                <td>${it.onvan || "-"}</td>
                <td>${it.karbord || "-"}</td>
                <td>${it.mahiat || "-"}</td>
            </tr>`;
        }).join("");

        const hint = filtered.length > shown.length
            ? `<tr><td colspan="6" style="text-align:center;padding:10px;color:#475569;background:#f1f5f9;">نمایش ${shown.length.toLocaleString("fa-IR")} از ${filtered.length.toLocaleString("fa-IR")} ردیف — برای دیدن بقیه در کادر جستجو تایپ کنید</td></tr>`
            : "";

        pickerTableBody.innerHTML = (html ||
            '<tr><td colspan="6" style="text-align:center;padding:16px;color:#64748b;">موردی یافت نشد</td></tr>') + hint;
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

    async function openBulkPicker() {
        if (!reportItems.length) await loadStandardReports();
        openReportPicker(assignReportValue.value, (code) => {
            assignReportValue.value = code;
            if (bulkPickerLabel) {
                bulkPickerLabel.textContent = code
                    ? displayReportSummary(code)
                    : "— انتخاب از جدول صورت مالی استاندارد —";
            }
        });
    }

    if (pickerSearchInput) {
        pickerSearchInput.addEventListener("input", () => {
            clearTimeout(pickerSearchTimer);
            pickerSearchTimer = setTimeout(() => renderPickerRows(pickerSearchInput.value), 150);
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

    // ─── ۵. راه‌اندازی ───
    async function init() {
        try {
            grid = new BinaGrid("#gridContainer", {
                height: "640px",
                pageSize: 100,
                pageSizeOptions: [100, 500, 1000, 5000, true],
                rowSelector: true,
                storagePrefix: "BinaCodingSoratMaliSt",
                captions: {
                    [GRID_COL]: "صورت مالی استاندارد",
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
                const hasSelection = rows > 0;
                if (applyGroupBtn) applyGroupBtn.disabled = !hasSelection;
                if (clearGroupBtn) clearGroupBtn.disabled = !hasSelection;
            });

            dbManager = new Index_db({
                webservice: new window.webservice({ endpoint: endpoint() })
            });
            await dbManager.initialize();

            const codes = await loadCompanyCodes();
            if (companySelect) {
                companySelect.innerHTML = '<option value="">انتخاب شرکت...</option>' +
                    codes.map(c => `<option value="${c}">${c}</option>`).join("");
            }

            await loadStandardReports();

            // ✅ اجرای خودکار هنگام باز شدن فرم
            if (codes.length > 0) {
                companySelect.value = codes[0];
                await syncAndLoadCompany(codes[0], true);
            }
        } catch (err) {
            console.error("❌ خطا در راه‌اندازی:", err);
            alert("خطا: " + err.message);
        }
    }

    // ─── ۶. همگام‌سازی coding_index با سرور و سپس نمایش ───
    async function syncAndLoadCompany(companyCode, silentOffline = false) {
        if (!companyCode) return;
        currentCompanyCode = companyCode;

        if (loadAndSyncBtn) {
            loadAndSyncBtn.disabled = true;
            loadAndSyncBtn.textContent = "در حال همگام‌سازی...";
        }

        try {
            dbManager._tkReady = true;
            await dbManager.syncCodingIndex(currentCompanyCode);
            if (!silentOffline && grid && grid._toast) grid._toast("✅ با سرور همگام شد");
        } catch (err) {
            console.warn("⚠️ همگام‌سازی coding_index انجام نشد (نمایش داده‌های محلی):", err.message);
            if (grid && grid._toast) {
                grid._toast("⚠️ همگام‌سازی coding_index نشد؛ داده‌های محلی/سرور بارگذاری می‌شوند");
            }
        }

        try {
            await loadAllData();
        } catch (err) {
            console.error(err);
            alert("❌ خطا در خواندن اطلاعات: " + err.message);
        } finally {
            if (loadAndSyncBtn) {
                loadAndSyncBtn.disabled = false;
                loadAndSyncBtn.textContent = "همگام‌سازی با سرور";
            }
        }
    }

    // ─── ۷. ترکیب داده‌ها و تزریق به گرید ───
    function getSavedReportCode(rec) {
        if (!rec) return "";
        return String(
            rec[LOCAL_FIELD] ??
            rec[SERVER_FIELD] ??
            rec.code_soratmali_st ??
            rec.Code_SoratMali_st ??
            ""
        ).trim();
    }

    function displayReportSummary(code) {
        const v = String(code || "").trim();
        if (!v) return "— انتخاب از جدول صورت مالی استاندارد —";
        const item = reportByCode.get(v);
        if (!item) return v;
        return item.karbord ? `${v} | ${item.shortTitle} (${item.karbord})` : `${v} | ${item.shortTitle}`;
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
            const kol = normCode(r.kol_code);
            const moien = normCode(r.moien_code);
            const tafsil = normCode(r.tafsil_code);
            const key = `${currentCompanyCode}_${kol}_${moien}_${tafsil}`;
            const rec = mappingMap.get(key);

            const code = getSavedReportCode(rec);
            let status = "no-group";
            if (rec) {
                if (code) status = rec.status || "synced";
                else if (rec.status === "pending-delete") status = "pending-delete";
            }

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

        await grid.setData(allRows, `CodingSoratMaliSt_${currentCompanyCode}`, { own: true });

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
                const item = reportByCode.get(currentCode);

                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "cell-combo-btn" + (currentCode ? " has-val" : "");

                const titleSpan = document.createElement("span");
                titleSpan.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                titleSpan.textContent = currentCode
                    ? (item ? item.shortTitle : currentCode)
                    : "— انتخاب از جدول صورت مالی استاندارد —";

                const badgeSpan = document.createElement("span");
                badgeSpan.className = "cell-combo-code";
                badgeSpan.textContent = currentCode ? `${currentCode} ▾` : "انتخاب ▾";

                btn.append(titleSpan, badgeSpan);

                // جلوگیری از تداخل کلیک کمبو با انتخاب/بازسازی سلول در BinaGrid
                ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(evtName => {
                    btn.addEventListener(evtName, (e) => e.stopPropagation());
                });
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

    // به‌روزرسانی داده و اجبار به رندر مجدد همان ردیف‌ها
    async function refreshUpdatedRows(updates) {
        if (!updates.length) return;
        try {
            await grid.table.updateData(updates);
        } catch (err) {
            console.warn("⚠️ updateData ناموفق بود؛ ردیف‌به‌ردیف به‌روزرسانی می‌شود:", err.message);
        }
        for (const u of updates) {
            const row = grid.table.getRow(u.__id);
            if (!row) continue;
            const data = row.getData();
            if (data._reportCode !== u._reportCode || data[GRID_COL] !== u[GRID_COL]) {
                try { row.update(u); } catch (err) { console.warn("⚠️ row.update:", err.message); }
            }
            row.reformat();
        }
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

    // ─── ۸. خواندن رکوردهای محلی (بدون await داخل تراکنش؛ سازگار با کروم) ───
    async function readLocalRecords(compDb, keys) {
        const map = new Map();
        await new Promise((res, rej) => {
            const tx = compDb.transaction("coding_index", "readonly");
            const store = tx.objectStore("coding_index");
            for (const key of keys) {
                const req = store.get(key);
                req.onsuccess = () => { if (req.result) map.set(key, req.result); };
            }
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error || new Error("خواندن coding_index ناموفق بود"));
        });
        return map;
    }

    // ─── ۹. ذخیره کد در استور لوکال coding_index ───
    // سرور هر ردیف را کامل جایگزین می‌کند؛ پس بقیهٔ کدها باید حفظ شوند.
    function otherCodeValues(rec) {
        const get = (...names) => {
            if (!rec) return "";
            for (const n of names) {
                const v = rec[n];
                if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
            }
            return "";
        };
        return {
            code_soratmali_sh: get("code_soratmali_sh", "Code_SoratMali_sh", "groupId"),
            code_gozareshat_sh: get("code_gozareshat_sh", "Code_Gozareshat_sh"),
            code_gozareshat_st: get("code_gozareshat_st", "Code_Gozareshat_st")
        };
    }

    function hasAnyOtherCode(rec) {
        const o = otherCodeValues(rec);
        return !!(numericOrNull(o.code_soratmali_sh) || o.code_gozareshat_sh || o.code_gozareshat_st);
    }

    async function applyReportCodeToKeysCore(keys, newReportCode) {
        if (!keys.length || !currentCompanyCode) return;
        const cleanCode = String(newReportCode || "").trim();

        const compDb = await dbManager._companyDB(currentCompanyCode);
        const existing = await readLocalRecords(compDb, keys);

        const writes = [];
        const updatesForGrid = [];

        for (const key of keys) {
            const row = rowByKey.get(key) || allRows.find(r => r._key === key);
            if (!row) continue;

            const rec = existing.get(key);
            const others = otherCodeValues(rec);
            let nextStatus = "no-group";

            if (!cleanCode) {
                if (rec && rec.status === "pending-insert") {
                    writes.push({ op: "delete", key });
                    nextStatus = "no-group";
                } else if (rec) {
                    // اگر کد نگاشت دیگری روی همین حساب هست، فقط همین ستون خالی شود
                    nextStatus = hasAnyOtherCode(rec) ? "pending-update" : "pending-delete";
                    writes.push({
                        op: "put",
                        rec: Object.assign({}, rec, others, {
                            key, codehesab: key, companyCode: currentCompanyCode,
                            [LOCAL_FIELD]: "",
                            [SERVER_FIELD]: "",
                            status: nextStatus,
                            lastModified: Date.now()
                        })
                    });
                }
            } else {
                nextStatus =
                    rec && rec.status && rec.status !== "pending-insert"
                        ? "pending-update"
                        : "pending-insert";

                writes.push({
                    op: "put",
                    rec: Object.assign({}, rec || {}, others, {
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
                    })
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
            await new Promise((res, rej) => {
                const tx = compDb.transaction("coding_index", "readwrite");
                const store = tx.objectStore("coding_index");
                for (const w of writes) {
                    if (w.op === "delete") store.delete(w.key);
                    else store.put(w.rec);
                }
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error || new Error("ذخیرهٔ coding_index ناموفق بود"));
            });
        }

        await refreshUpdatedRows(updatesForGrid);
        if (updatesForGrid.length && grid._toast) {
            grid._toast(`${updatesForGrid.length} حساب به‌روزرسانی شد ✓`);
        }
    }

    async function applyReportCodeToKeys(keys, newReportCode) {
        try {
            await applyReportCodeToKeysCore(keys, newReportCode);
        } catch (err) {
            console.error("❌ applyReportCodeToKeys:", err);
            alert("❌ خطا در ذخیرهٔ محلی نگاشت: " + err.message);
        } finally {
            updateStats();
        }
    }

    // ─── ۱۰. ارسال به سرور (فیلد Code_SoratMali_st) ───
    async function pushToServer() {
        const pendingRows = allRows.filter(
            r => r._status && r._status !== "synced" && r._status !== "no-group"
        );
        if (!pendingRows.length) {
            alert("هیچ تغییر در انتظار ارسالی وجود ندارد.");
            return;
        }

        try {
            const compDb = await dbManager._companyDB(currentCompanyCode);
            const existingMap = await readLocalRecords(compDb, pendingRows.map(r => r._key));

            const payload = pendingRows.map(r => {
                const old = existingMap.get(r._key) || {};
                const others = otherCodeValues(old);
                const effectiveStatus =
                    r._status === "pending-delete" && hasAnyOtherCode(old)
                        ? "pending-update"
                        : r._status;

                return {
                    key: r._key,
                    codehesab: r._key,
                    companyCode: currentCompanyCode,
                    kol_code: r.Kol_Code,
                    moien_code: r.Moien_Code,
                    tafsil_code: r.Tafsil_Code,
                    Code_SoratMali_sh: numericOrNull(others.code_soratmali_sh),
                    Code_SoratMali_st: numericOrNull(r._reportCode),
                    Code_Gozareshat_sh: others.code_gozareshat_sh || null,
                    Code_Gozareshat_st: others.code_gozareshat_st || null,
                    status: effectiveStatus,
                    lastModified: Date.now()
                };
            });

            if (pushToServerBtn) {
                pushToServerBtn.disabled = true;
                pushToServerBtn.textContent = "در حال ارسال...";
            }

            const url = `${endpoint()}?mode=save_coding_index`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyCode: currentCompanyCode, mappings: payload })
            });
            const text = await res.text();

            let result;
            try {
                result = JSON.parse(text);
            } catch (_) {
                throw new Error(`پاسخ غیر JSON از سرور (${res.status}): ${text.slice(0, 220)}`);
            }
            if (!res.ok || result.ok === false) {
                throw new Error(result.error || result.message || `خطای سرور (${res.status})`);
            }

            const updatesForGrid = [];

            await new Promise((res2, rej2) => {
                const tx = compDb.transaction("coding_index", "readwrite");
                const store = tx.objectStore("coding_index");

                for (const r of pendingRows) {
                    const old = existingMap.get(r._key) || {};
                    const others = otherCodeValues(old);

                    if (r._status === "pending-delete") {
                        if (hasAnyOtherCode(old)) {
                            store.put(Object.assign({}, old, others, {
                                key: r._key, codehesab: r._key, companyCode: currentCompanyCode,
                                [LOCAL_FIELD]: "",
                                [SERVER_FIELD]: "",
                                status: "synced", lastModified: Date.now()
                            }));
                        } else {
                            store.delete(r._key);
                        }
                        r._status = "no-group";
                        r._reportCode = "";
                    } else {
                        r._status = "synced";
                        store.put(Object.assign({}, old, others, {
                            key: r._key, codehesab: r._key, companyCode: currentCompanyCode,
                            kol_code: r.Kol_Code,
                            moien_code: r.Moien_Code,
                            tafsil_code: r.Tafsil_Code,
                            [LOCAL_FIELD]: r._reportCode,
                            [SERVER_FIELD]: r._reportCode,
                            status: "synced", lastModified: Date.now()
                        }));
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

                tx.oncomplete = res2;
                tx.onerror = () => rej2(tx.error || new Error("ذخیرهٔ محلی پس از ارسال ناموفق بود"));
            });

            await refreshUpdatedRows(updatesForGrid);
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

    // ─── ۱۱. رویدادها ───
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
            if (!reportItems.length) await loadStandardReports();
            await syncAndLoadCompany(companySelect.value);
        };
    }

    if (bulkPickerBtn) bulkPickerBtn.onclick = () => openBulkPicker();

    if (applyGroupBtn) {
        applyGroupBtn.onclick = async () => {
            const code = assignReportValue ? String(assignReportValue.value || "").trim() : "";
            if (!code) return alert("ابتدا از جدول صورت مالی استاندارد یک آیتم انتخاب کنید.");
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

    await init();
})();
