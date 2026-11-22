(async function () {
    "use strict";

    // ─── عناصر DOM ───
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

    // ─── State ───
    let dbManager = null;
    let grid = null;
    let standardGroups = [];
    let groupNameMap = new Map(); // CodeGorohSoratMali -> عنوان گروه
    let groupOptionsHTML = '<option value="">— بدون گروه —</option>';
    let allRows = [];
    let rowByKey = new Map();
    let currentCompanyCode = null;

    // ─── ۱. راه‌اندازی BinaGrid و دیتابیس ───
    async function init() {
        try {
            grid = new BinaGrid("#gridContainer", {
                height: "640px",
                pageSize: 100,
                pageSizeOptions: [100, 500, 1000, 5000, true],
                rowSelector: true,
                storagePrefix: "BinaCodingIndex",
                captions: {
                    GroupTitle: "گروه صورت مالی",
                    StatusLabel: "وضعیت",
                    Kol_Code: "کد کل",
                    Kol_Onvan: "عنوان کل",
                    Moien_Code: "کد معین",
                    Moien_Onvan: "عنوان معین",
                    Tafsil_Code: "کد تفصیلی",
                    Tafsil_Onvan: "عنوان تفصیلی"
                },
                presetcolumns: {
                    GroupTitle: { width: 245, minWidth: 180, kind: "text" },
                    StatusLabel: { width: 120, minWidth: 95, kind: "text" },
                    Kol_Code: { width: 95, minWidth: 70, kind: "text" },
                    Kol_Onvan: { width: 210, minWidth: 120, kind: "text" },
                    Moien_Code: { width: 100, minWidth: 75, kind: "text" },
                    Moien_Onvan: { width: 240, minWidth: 130, kind: "text" },
                    Tafsil_Code: { width: 110, minWidth: 80, kind: "text" },
                    Tafsil_Onvan: { width: 260, minWidth: 140, kind: "text" }
                }
            });

            grid.on("selectionChanged", ({ rows }) => {
                const hasSelection = rows > 0;
                if (applyGroupBtn) applyGroupBtn.disabled = !hasSelection;
                if (clearGroupBtn) clearGroupBtn.disabled = !hasSelection;
            });

            const endpoint = localStorage.getItem("bina_manager_endpoint") || "http://localhost/FastDataHandler.ashx";
            dbManager = new Index_db({
                webservice: new window.webservice({ endpoint })
            });
            await dbManager.initialize();

            const codes = await dbManager.getCompanyCodes();
            if (companySelect) {
                companySelect.innerHTML = '<option value="">انتخاب شرکت...</option>' +
                    codes.map(c => `<option value="${c}">${c}</option>`).join("");
            }

            await loadStandardGroups();

            // ✅ اجرای خودکار هنگام باز شدن فرم (Form Load)
            if (codes.length > 0) {
                companySelect.value = codes[0]; // انتخاب خودکار اولین شرکت
                await syncAndLoadCompany(codes[0]);
            }
        } catch (err) {
            console.error("❌ خطا در راه‌اندازی:", err);
            alert("خطا: " + err.message);
        }
    }
    // تابع مشترک برای همگام‌سازی با سرور و نمایش در گرید
    // تابع مشترک: اول تلاش برای همگام‌سازی با سرور، و در هر صورت نمایش داده‌های محلی
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
        if (!silentOffline && grid) grid._toast("✅ با سرور همگام شد");
    } catch (err) {
        console.warn("⚠️ همگام‌سازی خودکار coding_index انجام نشد (نمایش داده‌های محلی):", err.message);
        if (grid) {
            grid._toast("⚠️ دریافت stats برای coding_index در سرویس پشتیبانی نمی‌شود؛ داده‌های محلی بارگذاری می‌شوند");
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
    // اتصال به کلیک دستی دکمه سبز
    if (loadAndSyncBtn) {
        loadAndSyncBtn.onclick = () => {
            if (!companySelect?.value) return alert("لطفاً یک شرکت انتخاب کنید.");
            syncAndLoadCompany(companySelect.value);
        };
    }

    // هنگام تغییر شرکت از کمبو، فقط از دیتابیس لوکال بخواند (سریع و بدون درخواست به سرور)
    if (companySelect) {
        companySelect.onchange = async () => {
            if (!companySelect.value) return;
            currentCompanyCode = companySelect.value;
            await loadAllData();
        };
    }
    // ─── ۲. خواندن جدول پایه tk_g_soratmali_sh بر اساس CodeGorohSoratMali ───
    // خواندن یک فیلد بدون حساسیت به بزرگی/کوچکی حروف و با چند نام جایگزین
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

    // خواندن جدول پایه گروه‌های صورت مالی از سرویس (منبع اصلی)
    async function fetchGroupsFromServer(tableName) {
        const ws = dbManager.webservice;
        const stats = await ws.fetchStats(tableName);
        const names = (stats.columns || []).map(c => c.name);
        const out = [];
        for await (const pack of ws.fetchTable({ table: tableName, batchSize: 5000, afterId: 0 })) {
            for (const row of pack.rows) {
                const obj = {};
                if (Array.isArray(row)) names.forEach((n, i) => { obj[n] = row[i]; });
                else names.forEach(n => { obj[n] = row[n]; });
                out.push(obj);
            }
        }
        return out;
    }

    // خواندن از حافظه محلی به عنوان جایگزین
    async function fetchGroupsFromLocal() {
        const pubDb = await dbManager._publicDB();
        for (const store of ["tk_g_soratmali_sh", "tk_g_soratmali_sherkat"]) {
            if (!pubDb.objectStoreNames.contains(store)) continue;
            const rows = await new Promise((res, rej) => {
                const tx = pubDb.transaction(store, "readonly");
                const req = tx.objectStore(store).getAll();
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
                rows = await fetchGroupsFromServer("tk_g_soratmali_sh");
            } catch (err) {
                console.warn("⚠️ خواندن tk_g_soratmali_sh از سرور نشد، تلاش از حافظه محلی:", err.message);
                try { rows = await fetchGroupsFromLocal(); } catch (err2) { rows = null; }
            }

            standardGroups = (rows || []).filter(g => g && typeof g === "object");

            // مرتب‌سازی بر اساس TartibNamayesh و سپس کد گروه
            standardGroups.sort((a, b) => {
                const ta = Number(pick(a, "TartibNamayesh") || 999);
                const tb = Number(pick(b, "TartibNamayesh") || 999);
                return ta - tb;
            });

            groupNameMap.clear();
            const topOpts = ['<option value="">— انتخاب گروه صورت مالی —</option>'];
            const cellOpts = ['<option value="">— بدون گروه —</option>'];

            for (const g of standardGroups) {
                // ✅ استفاده از کد گروه صورت مالی به جای Id
                const code = pick(g, "Code_SoratMali_sh", "CodeGorohSoratMali", "codegorohsoratmali", "Code");
                const title = pick(g, "Onvan", "OnvanGoroh", "onvan") || "—";
                if (!code) continue;

                const label = `${code} - ${title}`;
                groupNameMap.set(code, label);
                topOpts.push(`<option value="${code}">${label}</option>`);
                cellOpts.push(`<option value="${code}">${label}</option>`);
            }

            if (assignGroupSelect) assignGroupSelect.innerHTML = topOpts.join("");
            groupOptionsHTML = cellOpts.join("");
            console.log(`گروه‌های صورت مالی: ${groupNameMap.size}`);
        } catch (err) {
            console.error("خطا در بارگذاری گروه‌ها:", err);
        }
    }

    // ─── ۳. نصب کمبوباکس داخل ستون GroupTitle در BinaGrid ───
    async function setupGroupComboColumn() {
        const col = grid.table.getColumn("GroupTitle");
        if (!col) return;

        await col.updateDefinition({
            formatter: (cell) => {
                const rowData = cell.getRow().getData();
                const currentCode = String(rowData._groupId || "");

                const select = document.createElement("select");
                select.style.cssText = "width:100%; padding:3px 6px; font-family:inherit; font-size:12px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; cursor:pointer;";
                select.innerHTML = groupOptionsHTML;
                select.value = currentCode;

                // جلوگیری از تداخل کلیک کمبو با انتخاب سلول در BinaGrid
                select.addEventListener("pointerdown", (e) => e.stopPropagation());
                select.addEventListener("click", (e) => e.stopPropagation());

                select.addEventListener("change", (e) => {
                    e.stopPropagation();
                    applyGroupToKeys([rowData._key], select.value);
                });

                return select;
            }
        });
    }

    // ─── ۴. خواندن تمام حساب‌های Coding شرکت ───
    // خواندن حساب‌های coding از سرور وقتی حافظهٔ محلی خالی است
    async function fetchCodingFromServer(companyCode) {
        const rows = await fetchGroupsFromServer("coding_" + companyCode);
        return rows.map((obj, i) => ({
            id: Number(pick(obj, "Id", "id")) || (i + 1),
            kol_code: pick(obj, "KOl_Code", "Kol_Code", "kol_code"),
            kol_onvan: pick(obj, "KOl_Onvan", "Kol_Onvan", "kol_onvan"),
            moien_code: pick(obj, "MOien_Code", "Moien_Code", "moien_code"),
            moien_onvan: pick(obj, "MOien_Onvan", "Moien_Onvan", "moien_onvan"),
            tafsil_code: pick(obj, "Tafsil_Code", "tafsil_code"),
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

        // حافظه محلی خالی است → مستقیم از سرور (تا صفحه در هر مرورگری کار کند)
        try {
            const srv = await fetchCodingFromServer(companyCode);
            if (srv.length) {
                console.log("حساب‌های شرکت " + companyCode + " از سرور: " + srv.length);
                return srv;
            }
        } catch (err) {
            console.warn("⚠️ خواندن coding_" + companyCode + " از سرور نشد:", err.message);
        }
        return all;
    }

    function statusToPersian(st) {
        if (st === "synced") return "🟢 همگام";
        if (st === "no-group") return "🔴 بدون گروه";
        if (st === "pending-delete") return "🟠 حذف در انتظار";
        return "🟡 در انتظار ارسال";
    }

    // ─── ۵. ترکیب داده‌ها و تزریق به BinaGrid ───
    async function loadAllData() {
        const [codingRows, mappingRows] = await Promise.all([
            fetchAllCodingRows(currentCompanyCode),
            dbManager.getCodingIndex(currentCompanyCode)
        ]);

        const mappingMap = new Map(mappingRows.map(r => [r.key, r]));
        rowByKey.clear();

        allRows = codingRows.map((r, idx) => {
            const kol = String(r.kol_code || "").trim();
            const moien = String(r.moien_code || "").trim();
            const tafsil = String(r.tafsil_code || "").trim();
            const key = `${currentCompanyCode}_${kol}_${moien}_${tafsil}`;
            const mapping = mappingMap.get(key);

            let groupCode = mapping ? String(mapping.groupId || mapping.code_soratmali_sh || "").trim() : "";
            if (groupCode === "0") groupCode = "";
            // وضعیت از رکورد محلی خوانده شود تا «حذف در انتظار» بعد از رفرش گم نشود
            let status = "no-group";
            if (mapping) {
                if (groupCode) status = mapping.status || "synced";
                else if (mapping.status === "pending-delete") status = "pending-delete";
            }

            const rowObj = {
                __id: idx + 1,
                _key: key,
                _groupId: groupCode,
                _status: status,
                GroupTitle: groupCode ? (groupNameMap.get(groupCode) || `کد ${groupCode}`) : "— بدون گروه —",
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

        await grid.setData(allRows, `CodingIndex_${currentCompanyCode}`, { own: true });

        // مخفی کردن ستون‌های فنی در گرید
        ["_key", "_groupId", "_status"].forEach(f => {
            const c = grid.table.getColumn(f);
            if (c) c.hide();
        });

        // تبدیل ستون گروه صورت مالی به کمبوباکس
        await setupGroupComboColumn();

        updateStats();
    }

    function updateStats() {
        let synced = 0, pending = 0, noGroup = 0;
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

    // ─── ۶. تخصیص گروه (ذخیره Code_SoratMali_sh) ───
    // سرور هر ردیف coding_index را کامل جایگزین می‌کند؛ پس بقیهٔ کدهای نگاشت
    // باید حفظ و همراه همان ردیف ارسال شوند، وگرنه پاک می‌شوند.
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
            code_soratmali_st: get("code_soratmali_st", "Code_SoratMali_st"),
            code_gozareshat_sh: get("code_gozareshat_sh", "Code_Gozareshat_sh"),
            code_gozareshat_st: get("code_gozareshat_st", "Code_Gozareshat_st")
        };
    }

    function hasOtherCodes(rec) {
        const o = otherCodeValues(rec);
        return !!(o.code_soratmali_st || o.code_gozareshat_sh || o.code_gozareshat_st);
    }

    async function applyGroupToKeys(keys, newGroupCode) {
        if (!keys.length || !currentCompanyCode) return;
        const cleanGroup = String(newGroupCode || "").trim();

        try {
            const compDb = await dbManager._companyDB(currentCompanyCode);

            // ۱) خواندن رکوردهای موجود در یک تراکنش کوتاه
            const existingMap = new Map();
            await new Promise((res, rej) => {
                const tx = compDb.transaction("coding_index", "readonly");
                const store = tx.objectStore("coding_index");
                for (const key of keys) {
                    const req = store.get(key);
                    req.onsuccess = () => { if (req.result) existingMap.set(key, req.result); };
                }
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });

            const writes = [];
            const updatesForGrid = [];

            for (const key of keys) {
                const row = rowByKey.get(key) || allRows.find(r => r._key === key);
                if (!row) continue;
                const rec = existingMap.get(key) || null;
                const others = otherCodeValues(rec);

                let newStatus;
                if (!cleanGroup) {
                    if (rec && rec.status === "pending-insert") {
                        writes.push({ op: "delete", key });
                        newStatus = "no-group";
                    } else if (rec) {
                        // اگر کد نگاشت دیگری روی همین حساب هست، فقط گروه را خالی کن
                        newStatus = hasOtherCodes(rec) ? "pending-update" : "pending-delete";
                        writes.push({
                            op: "put",
                            rec: Object.assign({}, rec, others, {
                                key: key, codehesab: key, companyCode: currentCompanyCode,
                                groupId: "", code_soratmali_sh: "",
                                status: newStatus, lastModified: Date.now()
                            })
                        });
                    } else {
                        newStatus = "no-group";
                    }
                } else {
                    newStatus = (rec && rec.status && rec.status !== "pending-insert") ? "pending-update" : "pending-insert";
                    writes.push({
                        op: "put",
                        rec: Object.assign({}, rec || {}, others, {
                            key: key, codehesab: key, companyCode: currentCompanyCode,
                            kol_code: row.Kol_Code,
                            moien_code: row.Moien_Code,
                            tafsil_code: row.Tafsil_Code,
                            groupId: cleanGroup,
                            code_soratmali_sh: cleanGroup,
                            karbord: "صورت مالی",
                            status: newStatus,
                            lastModified: Date.now()
                        })
                    });
                }

                row._groupId = cleanGroup;
                row._status = newStatus;
                row.GroupTitle = cleanGroup ? (groupNameMap.get(cleanGroup) || ("کد " + cleanGroup)) : "— بدون گروه —";
                row.StatusLabel = statusToPersian(newStatus);
                updatesForGrid.push({
                    __id: row.__id,
                    _groupId: row._groupId,
                    _status: row._status,
                    GroupTitle: row.GroupTitle,
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
                    tx.onerror = () => rej(tx.error);
                });
            }

            if (updatesForGrid.length) {
                await grid.table.updateData(updatesForGrid);
                for (const u of updatesForGrid) {
                    const r = grid.table.getRow(u.__id);
                    if (r) r.reformat();
                }
                grid._toast(updatesForGrid.length + " حساب به‌روزرسانی شد ✓");
            }
        } catch (err) {
            console.error("❌ applyGroupToKeys:", err);
            alert("❌ خطا در ذخیرهٔ محلی نگاشت: " + err.message);
        } finally {
            updateStats();
        }
    }

    // ─── ۷. ارسال تغییرات به سرور ───
    pushToServerBtn.onclick = async () => {
        const pendingRows = allRows.filter(r => r._status && r._status !== "synced" && r._status !== "no-group");
        if (!pendingRows.length) return;

        try {
            const compDb = await dbManager._companyDB(currentCompanyCode);

            const existingMap = new Map();
            await new Promise((res, rej) => {
                const tx = compDb.transaction("coding_index", "readonly");
                const store = tx.objectStore("coding_index");
                for (const r of pendingRows) {
                    const req = store.get(r._key);
                    req.onsuccess = () => { if (req.result) existingMap.set(r._key, req.result); };
                }
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });

            const payload = [];
            for (const r of pendingRows) {
                const old = existingMap.get(r._key) || {};
                const others = otherCodeValues(old);
                const group = String(r._groupId || old.groupId || old.code_soratmali_sh || "").trim();
                const hasOther = !!(others.code_soratmali_st || others.code_gozareshat_sh || others.code_gozareshat_st);
                const effectiveStatus = r._status === "pending-delete" && hasOther ? "pending-update" : r._status;

                payload.push({
                    key: r._key,
                    codehesab: r._key,
                    companyCode: currentCompanyCode,
                    kol_code: r.Kol_Code,
                    moien_code: r.Moien_Code,
                    tafsil_code: r.Tafsil_Code,
                    groupId: group,
                    code_soratmali_sh: group,
                    code_soratmali_st: others.code_soratmali_st,
                    code_gozareshat_sh: others.code_gozareshat_sh,
                    code_gozareshat_st: others.code_gozareshat_st,
                    karbord: "صورت مالی",
                    status: effectiveStatus,
                    lastModified: Date.now()
                });
            }

            pushToServerBtn.disabled = true;
            pushToServerBtn.textContent = "در حال ارسال...";

            const endpoint = localStorage.getItem("bina_manager_endpoint") || "http://localhost/FastDataHandler.ashx";
            const res = await fetch(endpoint + "?mode=save_coding_index", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyCode: currentCompanyCode, mappings: payload })
            });
            const text = await res.text();
            let result;
            try { result = JSON.parse(text); }
            catch (_) { throw new Error("پاسخ غیر JSON از سرور (" + res.status + "): " + text.slice(0, 220)); }
            if (!res.ok || result.ok === false) throw new Error(result.error || result.message || ("خطای سرور (" + res.status + ")"));

            await new Promise((res2, rej2) => {
                const writeTx = compDb.transaction("coding_index", "readwrite");
                const store = writeTx.objectStore("coding_index");
                for (const r of pendingRows) {
                    const old = existingMap.get(r._key) || {};
                    const others = otherCodeValues(old);
                    if (r._status === "pending-delete") {
                        if (hasOtherCodes(old)) {
                            store.put(Object.assign({}, old, others, {
                                key: r._key, codehesab: r._key, companyCode: currentCompanyCode,
                                groupId: "", code_soratmali_sh: "",
                                status: "synced", lastModified: Date.now()
                            }));
                        } else {
                            store.delete(r._key);
                        }
                        r._status = "no-group";
                        r._groupId = "";
                        r.GroupTitle = "— بدون گروه —";
                    } else {
                        r._status = r._groupId ? "synced" : "no-group";
                        store.put(Object.assign({}, old, others, {
                            key: r._key, codehesab: r._key, companyCode: currentCompanyCode,
                            kol_code: r.Kol_Code,
                            moien_code: r.Moien_Code,
                            tafsil_code: r.Tafsil_Code,
                            groupId: r._groupId,
                            code_soratmali_sh: r._groupId,
                            karbord: "صورت مالی",
                            status: "synced", lastModified: Date.now()
                        }));
                    }
                    r.StatusLabel = statusToPersian(r._status);
                }
                writeTx.oncomplete = res2;
                writeTx.onerror = () => rej2(writeTx.error);
            });

            const after = pendingRows.map(r => ({
                __id: r.__id,
                _groupId: r._groupId,
                _status: r._status,
                GroupTitle: r.GroupTitle,
                StatusLabel: r.StatusLabel
            }));
            await grid.table.updateData(after);
            for (const u of after) {
                const rr = grid.table.getRow(u.__id);
                if (rr) rr.reformat();
            }
            grid._toast("✅ " + (result.saved ?? payload.length) + " نگاشت ثبت و " + (result.deleted ?? 0) + " حذف شد");
        } catch (err) {
            console.error("❌ pushToServer error:", err);
            alert("❌ خطا در ارسال: " + err.message);
        } finally {
            updateStats();
        }
    };

    // ─── ۸. اتصال دکمه‌ها ───
    // ─── ۸. اتصال دکمه‌ها (ایمن در برابر null) ───
    // ─── ۸. اتصال دکمه‌ها ───
    if (applyGroupBtn) {
        applyGroupBtn.onclick = () => {
            const groupCode = assignGroupSelect?.value;
            if (!groupCode) return alert("لطفاً ابتدا یک گروه صورت مالی انتخاب کنید.");
            const selected = grid?.getSelectedData() || [];
            if (!selected.length) return;
            applyGroupToKeys(selected.map(r => r._key), groupCode);
        };
    }

    if (clearGroupBtn) {
        clearGroupBtn.onclick = () => {
            const selected = grid?.getSelectedData() || [];
            if (!selected.length) return;
            applyGroupToKeys(selected.map(r => r._key), "");
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

    // ─── ۹. همگام‌سازی زبان با سایدبار اصلی ───
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