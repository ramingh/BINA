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

        // ۱. تلاش برای دریافت تغییرات از سرور (در صورت قطعی شبکه متوقف نمی‌شود)
        try {
            dbManager._tkReady = true;
            await dbManager.syncCodingIndex(currentCompanyCode);
            if (!silentOffline && grid) grid._toast("✅ با سرور همگام شد");
        } catch (err) {
            console.warn("⚠️ سرور در دسترس نیست (اجرا در حالت آفلاین):", err.message);
            if (grid) {
                grid._toast("⚠️ حالت آفلاین: سرور در دسترس نیست (نمایش اطلاعات محلی)");
            }
        }

        // ۲. در هر شرایطی (چه آنلاین چه آفلاین) داده‌های IndexedDB را نمایش بده
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
    // ─── ۲. خواندن جدول پایه tk_g_soratmali_sherkat بر اساس CodeGorohSoratMali ───
    async function loadStandardGroups() {
        try {
            const pubDb = await dbManager._publicDB();
            if (!pubDb.objectStoreNames.contains("tk_g_soratmali_sherkat")) return;

            const tx = pubDb.transaction("tk_g_soratmali_sherkat", "readonly");
            standardGroups = await new Promise((res, rej) => {
                const req = tx.objectStore("tk_g_soratmali_sherkat").getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });

            // مرتب‌سازی بر اساس TartibNamayesh و CodeGorohSoratMali
            standardGroups.sort((a, b) => {
                const ta = Number(a.tartibnamayesh ?? a.TartibNamayesh ?? 999);
                const tb = Number(b.tartibnamayesh ?? b.TartibNamayesh ?? 999);
                return ta - tb;
            });

            groupNameMap.clear();
            const topOpts = ['<option value="">— انتخاب گروه صورت مالی —</option>'];
            const cellOpts = ['<option value="">— بدون گروه —</option>'];

            for (const g of standardGroups) {
                // ✅ استفاده از CodeGorohSoratMali به جای Id
                const code = String(g.codegorohsoratmali ?? g.CodeGorohSoratMali ?? "").trim();
                const title = String(g.onvan ?? g.Onvan ?? "—").trim();
                if (!code) continue;

                const label = `${code} - ${title}`;
                groupNameMap.set(code, label);
                topOpts.push(`<option value="${code}">${label}</option>`);
                cellOpts.push(`<option value="${code}">${label}</option>`);
            }

            assignGroupSelect.innerHTML = topOpts.join("");
            groupOptionsHTML = cellOpts.join("");
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
    async function fetchAllCodingRows(companyCode) {
        const all = [];
        let afterId = -1;
        const BATCH = 10000;
        while (true) {
            const batch = await dbManager.getRows({
                companyCode, family: "coding", afterId, limit: BATCH
            });
            if (!batch.length) break;
            all.push(...batch);
            afterId = batch[batch.length - 1].id;
            if (batch.length < BATCH) break;
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

            const groupCode = mapping ? String(mapping.groupId || "").trim() : "";
            const status = mapping ? (mapping.status || "synced") : "no-group";

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

    // ─── ۶. تخصیص گروه (ذخیره CodeGorohSoratMali در فیلد groupId) ───
    async function applyGroupToKeys(keys, newGroupCode) {
        if (!keys.length) return;

        const compDb = await dbManager._companyDB(currentCompanyCode);
        const tx = compDb.transaction("coding_index", "readwrite");
        const store = tx.objectStore("coding_index");

        const updatesForGrid = [];

        for (const key of keys) {
            const row = rowByKey.get(key);
            if (!row) continue;

            const existing = await new Promise(res => {
                const req = store.get(key);
                req.onsuccess = () => res(req.result);
            });

            let newStatus = "no-group";
            if (!newGroupCode) {
                if (existing) {
                    if (existing.status === "pending-insert") {
                        store.delete(key);
                    } else {
                        existing.status = "pending-delete";
                        existing.lastModified = Date.now();
                        store.put(existing);
                        newStatus = "pending-delete";
                    }
                }
            } else {
                newStatus = (existing && existing.status !== "pending-insert") ? "pending-update" : "pending-insert";
                store.put({
                    key,
                    companyCode: currentCompanyCode,
                    kol_code: row.Kol_Code,
                    moien_code: row.Moien_Code,
                    tafsil_code: row.Tafsil_Code,
                    groupId: newGroupCode, // ✅ مقدار CodeGorohSoratMali ذخیره می‌شود
                    karbord: "صورت مالی",
                    lastModified: Date.now(),
                    status: newStatus
                });
            }

            row._groupId = newGroupCode || "";
            row._status = newStatus;
            row.GroupTitle = newGroupCode ? (groupNameMap.get(newGroupCode) || `کد ${newGroupCode}`) : "— بدون گروه —";
            row.StatusLabel = statusToPersian(newStatus);

            updatesForGrid.push({
                __id: row.__id,
                _groupId: row._groupId,
                _status: row._status,
                GroupTitle: row.GroupTitle,
                StatusLabel: row.StatusLabel
            });
        }

        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

        if (updatesForGrid.length) {
            await grid.table.updateData(updatesForGrid);
        }

        updateStats();
        grid._toast(`${updatesForGrid.length} حساب به‌روزرسانی شد ✓`);
    }

    // ─── ۷. ارسال تغییرات به سرور ───
    pushToServerBtn.onclick = async () => {
        const pendingRows = allRows.filter(r => r._status !== "synced" && r._status !== "no-group");
        if (!pendingRows.length) return;

        const payload = pendingRows.map(r => ({
            key: r._key,
            companyCode: currentCompanyCode,
            kol_code: r.Kol_Code,
            moien_code: r.Moien_Code,
            tafsil_code: r.Tafsil_Code,
            groupId: r._groupId, // ارسال CodeGorohSoratMali به سرور
            karbord: "صورت مالی",
            status: r._status,
            lastModified: Date.now()
        }));

        pushToServerBtn.disabled = true;
        pushToServerBtn.textContent = "در حال ارسال...";
        try {
            const endpoint = localStorage.getItem("bina_manager_endpoint") || "http://localhost/FastDataHandler.ashx";
            const res = await fetch(`${endpoint}?mode=save_coding_index`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyCode: currentCompanyCode, mappings: payload })
            });
            const result = await res.json();
            if (!result.ok) throw new Error(result.error || "خطای سرور");

            const compDb = await dbManager._companyDB(currentCompanyCode);
            const writeTx = compDb.transaction("coding_index", "readwrite");
            const store = writeTx.objectStore("coding_index");
            const updatesForGrid = [];

            for (const r of pendingRows) {
                if (r._status === "pending-delete") {
                    store.delete(r._key);
                    r._status = "no-group";
                    r._groupId = "";
                    r.GroupTitle = "— بدون گروه —";
                } else {
                    r._status = "synced";
                    store.put({
                        key: r._key,
                        companyCode: currentCompanyCode,
                        kol_code: r.Kol_Code,
                        moien_code: r.Moien_Code,
                        tafsil_code: r.Tafsil_Code,
                        groupId: r._groupId,
                        karbord: "صورت مالی",
                        status: "synced",
                        lastModified: Date.now()
                    });
                }
                r.StatusLabel = statusToPersian(r._status);
                updatesForGrid.push({
                    __id: r.__id,
                    _groupId: r._groupId,
                    _status: r._status,
                    GroupTitle: r.GroupTitle,
                    StatusLabel: r.StatusLabel
                });
            }

            await new Promise((res2, rej) => { writeTx.oncomplete = res2; writeTx.onerror = () => rej(writeTx.error); });

            await grid.table.updateData(updatesForGrid);
            updateStats();
            grid._toast("✅ تغییرات با موفقیت در سرور ثبت شد");
        } catch (err) {
            alert("❌ خطا در ارسال: " + err.message);
        } finally {
            updateStats();
        }
    };

    // ─── ۸. اتصال دکمه‌ها ───
   // ─── ۸. اتصال دکمه‌ها (ایمن در برابر null) ───
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
            // ✅ فقط خواندن از IndexedDB محلی (بدون هیچ درخواستی به سرور)
            await loadAllData();
        };
    }

if (loadAndSyncBtn) {
        loadAndSyncBtn.onclick = async () => {
            if (!companySelect?.value) return alert("لطفاً یک شرکت انتخاب کنید.");
            currentCompanyCode = companySelect.value;
            loadAndSyncBtn.disabled = true;
            loadAndSyncBtn.textContent = "در حال همگام‌سازی...";
            try {
                // ✅ جلوگیری از استعلام مجدد جداول پایه TK_* در این فرم
                dbManager._tkReady = true;
                await dbManager.syncCodingIndex(currentCompanyCode);
                await loadAllData();
            } catch (err) {
                alert("خطا: " + err.message);
            } finally {
                loadAndSyncBtn.disabled = false;
                loadAndSyncBtn.textContent = "بارگذاری و همگام‌سازی";
            }
        };
    }

    await init();
 
})();