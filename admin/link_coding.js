(async function () {
    "use strict";

    // ─── چهار نگاشت جدول coding_index (سرویس جدید) ───
    // key       : کلید داخلی/محلی
    // col       : نام ستون در BinaGrid
    // server    : نام فیلد در API  (mode=save_coding_index)
    // table     : جدول مرجع گروه‌ها
    // code/title: ستون کد و عنوان در جدول مرجع
    const MAP_FIELDS = [
        {
            key: "sm_sh", col: "SM_sh", label: "صورت مالی (شرکتی)",
            server: "Code_SoratMali_sh",
            table: "tk_g_soratmali_sh", code: "Code_SoratMali_sh", title: "Onvan", tartib: "TartibNamayesh"
        },
        {
            key: "sm_st", col: "SM_st", label: "صورت مالی (استاندارد)",
            server: "Code_SoratMali_st",
            table: "tk_g_soratmali_st", code: "Code_SoratMali_st", title: "Onvan", tartib: "TartibNamayesh"
        },
        {
            key: "gm_sh", col: "GM_sh", label: "گزارش مالی (شرکتی)",
            server: "Code_Gozareshat_sh",
            table: "tk_g_GozareshMali_sh", code: "Code_Gozareshat_sh", title: "OnvanGozaresh", tartib: "TartibNamayesh"
        },
        {
            key: "gm_st", col: "GM_st", label: "گزارش (استاندارد)",
            server: "Code_Gozareshat_st",
            table: "tk_c_Gozareshat_st", code: "Id", title: null, tartib: null
        }
    ];
    const emptyMapping = () => {
        const m = {};
        MAP_FIELDS.forEach(f => { m[f.key] = ""; });
        return m;
    };
    const hasMapping = (m) => MAP_FIELDS.some(f => String((m && m[f.key]) || "").trim() !== "");

    // ─── عناصر DOM ───
    const companySelect = document.getElementById("companySelect");
    const loadAndSyncBtn = document.getElementById("loadAndSyncBtn");
    const pushToServerBtn = document.getElementById("pushToServerBtn");
    const applyGroupBtn = document.getElementById("applyGroupBtn");
    const clearGroupBtn = document.getElementById("clearGroupBtn");
    const statTotal = document.getElementById("statTotal");
    const statSynced = document.getElementById("statSynced");
    const statPending = document.getElementById("statPending");
    const statNoGroup = document.getElementById("statNoGroup");
    const assignSelects = {};
    MAP_FIELDS.forEach(f => {
        assignSelects[f.key] = document.getElementById("assign_" + f.key);
    });

    // ─── State ───
    let dbManager = null;
    let grid = null;
    const groupOptions = {}; // key -> HTML گزینه‌ها (سلول)
    const groupLabels = {};  // key -> Map(value -> label)
    let allRows = [];
    const rowByKey = new Map();
    let currentCompanyCode = null;

    const endpoint = () => localStorage.getItem("bina_manager_endpoint") || "http://localhost/FastDataHandler.ashx";

    // ─── ابزارهای عمومی ───
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

    const num = (v) => {
        const n = Number(String(v === null || v === undefined ? "" : v).trim());
        return Number.isFinite(n) ? n : 0;
    };

    function statusToPersian(st) {
        if (st === "synced") return "🟢 همگام";
        if (st === "no-group") return "🔴 بدون نگاشت";
        if (st === "pending-delete") return "🟠 حذف در انتظار";
        return "🟡 در انتظار ارسال";
    }

    // ─── خواندن جداول مرجع ───
    // ۱) از سرور (جداول کم‌حجم‌اند) ۲) در صورت آفلاین بودن، از IndexedDB عمومی
    async function fetchTableObjects(tableName) {
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

    async function readPublicStore(storeName) {
        const pubDb = await dbManager._publicDB();
        if (!pubDb.objectStoreNames.contains(storeName)) return null;
        return await new Promise((res, rej) => {
            const req = pubDb.transaction(storeName, "readonly").objectStore(storeName).getAll();
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => rej(req.error);
        });
    }

    function buildLabel(field, row) {
        const value = pick(row, field.code);
        if (!value) return null;
        if (field.key === "gm_st") {
            const k = pick(row, "KOl_Code_st");
            const m = pick(row, "MOien_Code_st");
            const t = pick(row, "Tafsil_Code_st");
            const path = [k, m, t].filter(x => x && x !== "0").join("/") || "0";
            const title = pick(row, "Tafsil_Onvan_st") || pick(row, "MOien_Onvan_st") || pick(row, "KOl_Onvan_st");
            return { value, label: `${value} - ${path}${title ? " · " + title : ""}`, tartib: 0 };
        }
        const tartib = field.tartib ? num(pick(row, field.tartib)) : 0;
        const title = pick(row, field.title) || "—";
        return { value, label: `${value} - ${title}`, tartib };
    }

    async function loadGroups() {
        for (const field of MAP_FIELDS) {
            let rows = null;
            try {
                rows = await fetchTableObjects(field.table);
            } catch (err) {
                console.warn(`⚠️ خواندن ${field.table} از سرور نشد، تلاش از حافظه محلی:`, err.message);
                try { rows = await readPublicStore(field.table); } catch (err2) { rows = null; }
            }
            const items = [];
            for (const row of (rows || [])) {
                if (!row || typeof row !== "object") continue;
                const item = buildLabel(field, row);
                if (item) items.push(item);
            }
            items.sort((a, b) => (a.tartib - b.tartib) ||
                a.value.localeCompare(b.value, "en", { numeric: true }));

            const labels = new Map();
            const cellOpts = ['<option value="">— بدون گروه —</option>'];
            for (const it of items) {
                labels.set(it.value, it.label);
                cellOpts.push(`<option value="${it.value}">${it.label}</option>`);
            }
            groupLabels[field.key] = labels;
            groupOptions[field.key] = cellOpts.join("");

            const top = assignSelects[field.key];
            if (top) {
                top.innerHTML = ['<option value="">— بدون تغییر —</option>'].concat(cellOpts.slice(1)).join("");
            }
            console.log(`گروه‌های ${field.table}: ${items.length}`);
        }
    }

    // ─── ۱. راه‌اندازی BinaGrid و دیتابیس ───
    async function init() {
        grid = new BinaGrid("#gridContainer", {
            height: "640px",
            pageSize: 100,
            pageSizeOptions: [100, 500, 1000, 5000, true],
            rowSelector: true,
            storagePrefix: "BinaCodingIndexV2",
            captions: {
                SM_sh: "صورت مالی (شرکتی)",
                SM_st: "صورت مالی (استاندارد)",
                GM_sh: "گزارش مالی (شرکتی)",
                GM_st: "گزارش (استاندارد)",
                StatusLabel: "وضعیت",
                Kol_Code: "کد کل",
                Kol_Onvan: "عنوان کل",
                Moien_Code: "کد معین",
                Moien_Onvan: "عنوان معین",
                Tafsil_Code: "کد تفصیلی",
                Tafsil_Onvan: "عنوان تفصیلی"
            },
            presetcolumns: {
                SM_sh: { width: 210, minWidth: 150, kind: "text" },
                SM_st: { width: 210, minWidth: 150, kind: "text" },
                GM_sh: { width: 210, minWidth: 150, kind: "text" },
                GM_st: { width: 230, minWidth: 160, kind: "text" },
                StatusLabel: { width: 120, minWidth: 95, kind: "text" },
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

        dbManager = new Index_db({ webservice: new window.webservice({ endpoint: endpoint() }) });
        await dbManager.initialize();

        const codes = await dbManager.getCompanyCodes();
        if (companySelect) {
            companySelect.innerHTML = '<option value="">انتخاب شرکت...</option>' +
                codes.map(c => `<option value="${c}">${c}</option>`).join("");
        }

        await loadGroups();

        if (codes.length > 0) {
            companySelect.value = codes[0];
            await syncAndLoadCompany(codes[0]);
        } else if (grid) {
            await loadAllData();
        }
    }

    // ─── ۲. همگام‌سازی با سرور و نمایش داده محلی ───
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
            console.warn("⚠️ سرور در دسترس نیست (اجرای آفلاین):", err.message);
            if (grid) grid._toast("⚠️ حالت آفلاین: " + err.message);
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

    // ─── ۳. خواندن تمام حساب‌های coding شرکت ───
    async function fetchAllCodingRows(companyCode) {
        const all = [];
        let afterId = -1;
        const BATCH = 10000;
        while (true) {
            const batch = await dbManager.getRows({ companyCode, family: "coding", afterId, limit: BATCH });
            if (!batch.length) break;
            all.push(...batch);
            afterId = batch[batch.length - 1].id;
            if (batch.length < BATCH) break;
        }
        return all;
    }

    // ─── ۴. تبدیل رکورد محلی coding_index به چهار نگاشت ───
    function mappingOf(rec) {
        const m = emptyMapping();
        if (!rec) return m;
        m.sm_sh = String(rec.code_soratmali_sh ?? rec.Code_SoratMali_sh ?? "").trim();
        m.sm_st = String(rec.code_soratmali_st ?? rec.Code_SoratMali_st ?? "").trim();
        m.gm_sh = String(rec.code_gozareshat_sh ?? rec.Code_Gozareshat_sh ?? "").trim();
        m.gm_st = String(rec.code_gozareshat_st ?? rec.Code_Gozareshat_st ?? "").trim();
        // سازگاری با رکوردهای قدیمی که فقط groupId داشتند
        if (!hasMapping(m)) {
            const legacy = String(rec.groupId ?? "").trim();
            if (legacy) m.sm_sh = legacy;
        }
        return m;
    }

    function displayOf(field, value) {
        const v = String(value || "").trim();
        if (!v) return "";
        const labels = groupLabels[field.key];
        return (labels && labels.get(v)) || `کد ${v}`;
    }

    // ─── ۵. ترکیب داده‌ها و تزریق به BinaGrid ───
    async function loadAllData() {
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
            const m = mappingOf(rec);
            const status = rec && hasMapping(m) ? (rec.status || "synced") : "no-group";

            const rowObj = {
                __id: idx + 1,
                _key: key,
                _m: m,
                _status: status,
                StatusLabel: statusToPersian(status),
                Kol_Code: kol,
                Kol_Onvan: r.kol_onvan || "",
                Moien_Code: moien,
                Moien_Onvan: r.moien_onvan || "",
                Tafsil_Code: tafsil,
                Tafsil_Onvan: r.tafsil_onvan || ""
            };
            MAP_FIELDS.forEach(f => { rowObj[f.col] = displayOf(f, m[f.key]); });
            rowByKey.set(key, rowObj);
            return rowObj;
        });

        await grid.setData(allRows, `CodingIndex4_${currentCompanyCode}`, { own: true });

        ["_key", "_m", "_status"].forEach(c => {
            const col = grid.table.getColumn(c);
            if (col) col.hide();
        });

        for (const field of MAP_FIELDS) await setupMappingColumn(field);

        updateStats();
    }

    // ─── ۶. کمبوباکس داخل ستون هر نگاشت ───
    async function setupMappingColumn(field) {
        const col = grid.table.getColumn(field.col);
        if (!col) return;

        await col.updateDefinition({
            formatter: (cell) => {
                const rowData = cell.getRow().getData();
                const current = String((rowData._m && rowData._m[field.key]) || "");

                const select = document.createElement("select");
                select.style.cssText = "width:100%; padding:3px 6px; font-family:inherit; font-size:12px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; cursor:pointer;";
                select.innerHTML = groupOptions[field.key] || '<option value="">— بدون گروه —</option>';
                select.value = current;

                select.addEventListener("pointerdown", (e) => e.stopPropagation());
                select.addEventListener("click", (e) => e.stopPropagation());
                select.addEventListener("change", async (e) => {
                    e.stopPropagation();
                    const patch = {};
                    patch[field.key] = select.value;
                    await applyMappings([rowData._key], patch);
                });

                return select;
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
            pushToServerBtn.textContent = `ثبت دایم (${pending})`;
        }
    }

    // ─── ۷. اعمال/پاک کردن نگاشت روی ردیف‌های انتخاب‌شده ───
    async function applyMappings(keys, patch) {
        if (!keys.length) return;

        const compDb = await dbManager._companyDB(currentCompanyCode);

        // خواندن رکوردهای موجود در یک تراکنش (بدون await داخل حلقه)
        const existing = new Map();
        {
            const tx = compDb.transaction("coding_index", "readonly");
            const store = tx.objectStore("coding_index");
            await Promise.all(keys.map(key => new Promise(res => {
                const req = store.get(key);
                req.onsuccess = () => { if (req.result) existing.set(key, req.result); res(); };
                req.onerror = () => res();
            })));
        }

        const writes = [];
        const updatesForGrid = [];

        for (const key of keys) {
            const row = rowByKey.get(key);
            if (!row) continue;
            const rec = existing.get(key);
            const next = mappingOf(rec);

            for (const field of MAP_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(patch, field.key)) {
                    next[field.key] = String(patch[field.key] || "").trim();
                }
            }

            let status;
            if (!hasMapping(next)) {
                if (rec && rec.status === "pending-insert") {
                    writes.push({ op: "delete", key });
                    status = "no-group";
                } else if (rec) {
                    writes.push({ op: "put", rec: { ...rec, status: "pending-delete", lastModified: Date.now() } });
                    status = "pending-delete";
                } else {
                    status = "no-group";
                }
            } else {
                status = (rec && rec.status && rec.status !== "pending-insert") ? "pending-update" : "pending-insert";
                writes.push({
                    op: "put", rec: {
                        key, codehesab: key, companyCode: currentCompanyCode,
                        kol_code: row.Kol_Code, moien_code: row.Moien_Code, tafsil_code: row.Tafsil_Code,
                        code_soratmali_sh: next.sm_sh,
                        code_soratmali_st: next.sm_st,
                        code_gozareshat_sh: next.gm_sh,
                        code_gozareshat_st: next.gm_st,
                        status, lastModified: Date.now()
                    }
                });
            }

            row._m = hasMapping(next) ? next : emptyMapping();
            row._status = status;
            MAP_FIELDS.forEach(f => { row[f.col] = displayOf(f, row._m[f.key]); });
            row.StatusLabel = statusToPersian(status);

            const patchData = { __id: row.__id, _m: row._m, _status: status, StatusLabel: row.StatusLabel };
            MAP_FIELDS.forEach(f => { patchData[f.col] = row[f.col]; });
            updatesForGrid.push(patchData);
        }

        if (writes.length) {
            const tx = compDb.transaction("coding_index", "readwrite");
            const store = tx.objectStore("coding_index");
            for (const w of writes) {
                if (w.op === "delete") store.delete(w.key);
                else store.put(w.rec);
            }
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        }

        if (updatesForGrid.length) await grid.table.updateData(updatesForGrid);
        updateStats();
        if (updatesForGrid.length && grid._toast) grid._toast(`${updatesForGrid.length} حساب به‌روزرسانی شد ✓`);
    }

    // ─── ۸. ارسال تغییرات به سرور (چهار فیلد) ───
    async function pushToServer() {
        const pendingRows = allRows.filter(r => r._status !== "synced" && r._status !== "no-group");
        if (!pendingRows.length) return;

        const payload = pendingRows.map(r => ({
            key: r._key,
            codehesab: r._key,
            companyCode: currentCompanyCode,
            kol_code: r.Kol_Code,
            moien_code: r.Moien_Code,
            tafsil_code: r.Tafsil_Code,
            Code_SoratMali_sh: r._m.sm_sh || null,
            Code_SoratMali_st: r._m.sm_st || null,
            Code_Gozareshat_sh: r._m.gm_sh || null,
            Code_Gozareshat_st: r._m.gm_st || null,
            status: r._status,
            lastModified: Date.now()
        }));

        if (pushToServerBtn) {
            pushToServerBtn.disabled = true;
            pushToServerBtn.textContent = "در حال ارسال...";
        }

        try {
            const res = await fetch(`${endpoint()}?mode=save_coding_index`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyCode: currentCompanyCode, mappings: payload })
            });
            const result = await res.json();
            if (!result.ok) throw new Error(result.error || "خطای سرور");

            const compDb = await dbManager._companyDB(currentCompanyCode);
            const tx = compDb.transaction("coding_index", "readwrite");
            const store = tx.objectStore("coding_index");
            const updatesForGrid = [];

            for (const r of pendingRows) {
                if (r._status === "pending-delete") {
                    store.delete(r._key);
                    r._status = "no-group";
                    r._m = emptyMapping();
                } else {
                    r._status = "synced";
                    store.put({
                        key: r._key, codehesab: r._key, companyCode: currentCompanyCode,
                        kol_code: r.Kol_Code, moien_code: r.Moien_Code, tafsil_code: r.Tafsil_Code,
                        code_soratmali_sh: r._m.sm_sh,
                        code_soratmali_st: r._m.sm_st,
                        code_gozareshat_sh: r._m.gm_sh,
                        code_gozareshat_st: r._m.gm_st,
                        status: "synced", lastModified: Date.now()
                    });
                }
                MAP_FIELDS.forEach(f => { r[f.col] = displayOf(f, r._m[f.key]); });
                r.StatusLabel = statusToPersian(r._status);
                const patchData = { __id: r.__id, _m: r._m, _status: r._status, StatusLabel: r.StatusLabel };
                MAP_FIELDS.forEach(f => { patchData[f.col] = r[f.col]; });
                updatesForGrid.push(patchData);
            }

            await new Promise((res2, rej2) => { tx.oncomplete = res2; tx.onerror = () => rej2(tx.error); });
            await grid.table.updateData(updatesForGrid);
            updateStats();
            if (grid._toast) {
                grid._toast(`✅ ${result.saved ?? 0} نگاشت ثبت و ${result.deleted ?? 0} حذف شد`);
            }
        } catch (err) {
            alert("❌ خطا در ارسال: " + err.message);
        } finally {
            updateStats();
        }
    }

    // ─── ۹. اتصال دکمه‌ها و رویدادها ───
    if (loadAndSyncBtn) {
        loadAndSyncBtn.onclick = () => {
            if (!companySelect || !companySelect.value) return alert("لطفاً یک شرکت انتخاب کنید.");
            syncAndLoadCompany(companySelect.value);
        };
    }

    if (companySelect) {
        companySelect.onchange = async () => {
            if (!companySelect.value) return;
            currentCompanyCode = companySelect.value;
            await loadAllData();
        };
    }

    if (applyGroupBtn) {
        applyGroupBtn.onclick = async () => {
            const patch = {};
            let any = false;
            for (const field of MAP_FIELDS) {
                const sel = assignSelects[field.key];
                const value = sel ? String(sel.value || "").trim() : "";
                if (value) { patch[field.key] = value; any = true; }
            }
            if (!any) return alert("حداقل یکی از چهار گروه را انتخاب کنید.");
            const selected = (grid && grid.getSelectedData && grid.getSelectedData()) || [];
            if (!selected.length) return alert("ابتدا ردیف‌ها را انتخاب کنید.");
            await applyMappings(selected.map(r => r._key), patch);
        };
    }

    if (clearGroupBtn) {
        clearGroupBtn.onclick = async () => {
            const selected = (grid && grid.getSelectedData && grid.getSelectedData()) || [];
            if (!selected.length) return;
            const patch = {};
            MAP_FIELDS.forEach(f => { patch[f.key] = ""; });
            await applyMappings(selected.map(r => r._key), patch);
        };
    }

    if (pushToServerBtn) pushToServerBtn.onclick = () => pushToServer();

    // ─── ۱۰. همگام‌سازی زبان با سایدبار اصلی ───
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
 