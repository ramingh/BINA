(async function () {
    "use strict";

    // ─── عناصر DOM ───
    const companySelect = document.getElementById("companySelect");
    const loadAndSyncBtn = document.getElementById("loadAndSyncBtn");
    const pushToServerBtn = document.getElementById("pushToServerBtn");
    const unifiedTableBody = document.querySelector("#unifiedTable tbody");
    const searchInput = document.getElementById("searchInput");
    const filterGroup = document.getElementById("filterGroup");
    const filterStatus = document.getElementById("filterStatus");
    const recordInfo = document.getElementById("recordInfo");
    const paginationDiv = document.getElementById("pagination");

    const statTotal = document.getElementById("statTotal");
    const statSynced = document.getElementById("statSynced");
    const statPending = document.getElementById("statPending");
    const statNoGroup = document.getElementById("statNoGroup");

    // ─── State & Cache ───
    let dbManager = null;
    let standardGroups = [];
    let groupOptionsHTML = ""; // کش HTML گزینه‌های منو برای رندر آنی
    let allRows = [];          // آرایه اصلی حساب‌ها در RAM
    let rowIndexMap = new Map(); // نگاشت O(1) از key به آبجکت ردیف در allRows
    let filteredRows = [];
    let currentCompanyCode = null;
    let currentPage = 1;
    const pageSize = 50;

    // ─── ۱. راه‌اندازی اولیه ───
    async function init() {
        try {
            const endpoint = localStorage.getItem('bina_manager_endpoint') || "http://localhost/FastDataHandler.ashx";
            dbManager = new Index_db({
                webservice: new window.webservice({ endpoint })
            });
            await dbManager.initialize();

            const codes = await dbManager.getCompanyCodes();
            companySelect.innerHTML = '<option value="">انتخاب شرکت...</option>' +
                codes.map(c => `<option value="${c}">${c}</option>`).join('');

            await loadStandardGroups();
        } catch (err) {
            console.error("❌ خطا در راه‌اندازی:", err);
            alert("خطا: " + err.message);
        }
    }

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

            filterGroup.innerHTML = '<option value="">همه گروه‌های صورت مالی</option>' +
                standardGroups.map(g => `<option value="${g.id || g.key}">${g.onvan || g.Onvan || '—'}</option>`).join('');

            // ساخت یک‌باره‌ی لیست گزینه‌ها برای سرعت بالا در رندر جدول
            groupOptionsHTML = '<option value="">— بدون گروه —</option>' +
                standardGroups.map(g => `<option value="${g.id || g.key}">${g.onvan || g.Onvan || '—'}</option>`).join('');
        } catch (err) {
            console.error("خطا در بارگذاری گروه‌ها:", err);
        }
    }

    // ─── ۲. خواندن حساب‌های Coding (فقط یک‌بار از gzip باز می‌شود) ───
    async function fetchAllCodingRows(companyCode) {
        const all = [];
        let afterId = -1;
        const BATCH = 10000; // استفاده از سقف بالاتر برای کاهش دفعات تراکنش
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

    // ─── ۳. ترکیب و ساخت ساختار در RAM ───
    async function loadAllData() {
        const [codingRows, mappingRows] = await Promise.all([
            fetchAllCodingRows(currentCompanyCode),
            dbManager.getCodingIndex(currentCompanyCode)
        ]);

        const mappingMap = new Map(mappingRows.map(r => [r.key, r]));
        rowIndexMap.clear();

        allRows = codingRows.map(r => {
            const kol = String(r.kol_code || "").trim();
            const moien = String(r.moien_code || "").trim();
            const tafsil = String(r.tafsil_code || "").trim();
            const key = `${currentCompanyCode}_${kol}_${moien}_${tafsil}`;
            const mapping = mappingMap.get(key);

            const item = {
                key,
                kol_code: kol,
                kol_onvan: r.kol_onvan || '',
                moien_code: moien,
                moien_onvan: r.moien_onvan || '',
                tafsil_code: tafsil,
                tafsil_onvan: r.tafsil_onvan || '',
                groupId: mapping ? String(mapping.groupId || "") : "",
                status: mapping ? (mapping.status || "synced") : "no-group",
                searchText: `${kol} ${moien} ${tafsil} ${r.kol_onvan || ''} ${r.moien_onvan || ''} ${r.tafsil_onvan || ''}`.toLowerCase()
            };
            rowIndexMap.set(key, item);
            return item;
        });

        updateGlobalStats();
        applyFilters(true);
    }

    // ─── ۴. محاسبه آمار کل شرکت (نه فقط صفحه فعلی) ───
    function updateGlobalStats() {
        let synced = 0, pending = 0, noGroup = 0;
        for (const r of allRows) {
            if (r.status === 'synced') synced++;
            else if (r.status === 'no-group') noGroup++;
            else pending++;
        }
        statTotal.textContent = allRows.length.toLocaleString("fa-IR");
        statSynced.textContent = synced.toLocaleString("fa-IR");
        statPending.textContent = pending.toLocaleString("fa-IR");
        statNoGroup.textContent = noGroup.toLocaleString("fa-IR");

        pushToServerBtn.disabled = pending === 0;
        pushToServerBtn.textContent = `ارسال تغییرات به سرور (${pending})`;
    }

    // ─── ۵. فیلتر سریع با حفظ صفحه در صورت نیاز ───
    function applyFilters(resetPage = true) {
        const term = (searchInput.value || "").trim().toLowerCase();
        const gf = filterGroup.value;
        const sf = filterStatus.value;

        filteredRows = allRows.filter(r => {
            if (term && !r.searchText.includes(term)) return false;
            if (gf && String(r.groupId) !== String(gf)) return false;
            if (sf === 'synced' && r.status !== 'synced') return false;
            if (sf === 'no-group' && r.status !== 'no-group') return false;
            if (sf === 'pending' && (r.status === 'synced' || r.status === 'no-group')) return false;
            return true;
        });

        if (resetPage) currentPage = 1;
        else {
            const maxPage = Math.max(1, Math.ceil(filteredRows.length / pageSize));
            if (currentPage > maxPage) currentPage = maxPage;
        }
        renderTable();
    }

    // ─── ۶. رندر سریع جدول با DocumentFragment ───
    function renderTable() {
        const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
        const start = (currentPage - 1) * pageSize;
        const page = filteredRows.slice(start, start + pageSize);

        recordInfo.textContent = `نمایش ${filteredRows.length ? start + 1 : 0} تا ${Math.min(start + pageSize, filteredRows.length)} از ${filteredRows.length.toLocaleString("fa-IR")}`;

        const rowsHtml = page.map((r, i) => {
            const rowClass = r.status === 'synced' ? 'row-synced'
                : r.status === 'no-group' ? 'row-no-group'
                : 'row-changed';

            const badge = r.status === 'synced' ? '<span class="badge badge-synced">همگام</span>'
                : r.status === 'no-group' ? '<span class="badge badge-nogroup">بدون گروه</span>'
                : '<span class="badge badge-pending">در انتظار</span>';

            // انتخاب گزینه فعال بدون بازسازی کل رشته
            const selectHtml = r.groupId
                ? groupOptionsHTML.replace(`value="${r.groupId}"`, `value="${r.groupId}" selected`)
                : groupOptionsHTML;

            return `<tr class="${rowClass}" data-key="${r.key}">
                <td style="text-align:center; color:var(--muted)">${start + i + 1}</td>
                <td><select class="group-select" data-key="${r.key}">${selectHtml}</select></td>
                <td class="code-cell">${r.kol_code}</td><td>${r.kol_onvan}</td>
                <td class="code-cell">${r.moien_code}</td><td>${r.moien_onvan}</td>
                <td class="code-cell">${r.tafsil_code}</td><td>${r.tafsil_onvan}</td>
                <td style="text-align:center">${badge}</td>
            </tr>`;
        }).join('');

        unifiedTableBody.innerHTML = rowsHtml;
        renderPagination(totalPages);
    }

    // Event Delegation: فقط یک لیسنر روی کل جدول به جای ۵۰ لیسنر جداگانه
    unifiedTableBody.onchange = (e) => {
        if (e.target && e.target.classList.contains("group-select")) {
            updateGroupFast(e.target.dataset.key, e.target.value, e.target.closest("tr"));
        }
    };

    function renderPagination(totalPages) {
        if (totalPages <= 1) { paginationDiv.innerHTML = ''; return; }
        let html = `<button ${currentPage === 1 ? 'disabled' : ''} data-p="${currentPage - 1}">◀ قبلی</button>`;
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
                html += `<button class="${i === currentPage ? 'active' : ''}" data-p="${i}">${i}</button>`;
            } else if (Math.abs(i - currentPage) === 3) {
                html += `<span style="color:var(--muted)">…</span>`;
            }
        }
        html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-p="${currentPage + 1}">بعدی ▶</button>`;
        paginationDiv.innerHTML = html;
    }

    paginationDiv.onclick = (e) => {
        const btn = e.target.closest("button[data-p]");
        if (btn && !btn.disabled) {
            currentPage = Number(btn.dataset.p);
            renderTable();
        }
    };

    // ─── ۷. آپدیت آنی بدون خواندن مجدد gzip ───
    async function updateGroupFast(key, newGroupId, trElement) {
        const row = rowIndexMap.get(key);
        if (!row) return;

        const compDb = await dbManager._companyDB(currentCompanyCode);
        const tx = compDb.transaction("coding_index", "readwrite");
        const store = tx.objectStore("coding_index");

        const existing = await new Promise(res => {
            const req = store.get(key);
            req.onsuccess = () => res(req.result);
        });

        let newStatus = "no-group";
        if (!newGroupId) {
            if (existing) {
                if (existing.status === "pending-insert") {
                    store.delete(key); // هنوز در سرور نبوده، پس کلاً حذف شود
                } else {
                    existing.status = 'pending-delete';
                    existing.lastModified = Date.now();
                    store.put(existing);
                    newStatus = 'pending-delete';
                }
            }
        } else {
            newStatus = (existing && existing.status !== 'pending-insert') ? 'pending-update' : 'pending-insert';
            store.put({
                key,
                companyCode: currentCompanyCode,
                kol_code: row.kol_code,
                moien_code: row.moien_code,
                tafsil_code: row.tafsil_code,
                groupId: newGroupId,
                karbord: "صورت مالی",
                lastModified: Date.now(),
                status: newStatus
            });
        }

        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

        // آپدیت فوری آبجکت در RAM و ظاهر همان ردیف (بدون reload کل جدول)
        row.groupId = newGroupId;
        row.status = newStatus;

        if (trElement) {
            trElement.className = newStatus === 'no-group' ? 'row-no-group' : 'row-changed';
            const badgeCell = trElement.lastElementChild;
            badgeCell.innerHTML = newStatus === 'no-group'
                ? '<span class="badge badge-nogroup">بدون گروه</span>'
                : '<span class="badge badge-pending">در انتظار</span>';
        }

        updateGlobalStats();
        // اگر فیلتر وضعیت فعال است، لیست را بدون پرش به صفحه ۱ به‌روز کن
        if (filterStatus.value || filterGroup.value) applyFilters(false);
    }

    // ─── ۸. ارسال به سرور ───
    pushToServerBtn.onclick = async () => {
        const pending = allRows.filter(r => r.status !== 'synced' && r.status !== 'no-group');
        if (!pending.length) return;

        pushToServerBtn.disabled = true;
        pushToServerBtn.textContent = "در حال ارسال...";
        try {
            const endpoint = localStorage.getItem('bina_manager_endpoint') || "http://localhost/FastDataHandler.ashx";
            const res = await fetch(`${endpoint}?mode=save_coding_index`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyCode: currentCompanyCode, mappings: pending })
            });
            const result = await res.json();
            if (!result.ok) throw new Error(result.error || "خطای سرور");

            const compDb = await dbManager._companyDB(currentCompanyCode);
            const writeTx = compDb.transaction("coding_index", "readwrite");
            const store = writeTx.objectStore("coding_index");

            for (const r of pending) {
                if (r.status === 'pending-delete') {
                    store.delete(r.key);
                    r.status = 'no-group';
                    r.groupId = "";
                } else {
                    r.status = 'synced';
                    store.put({
                        key: r.key,
                        companyCode: currentCompanyCode,
                        kol_code: r.kol_code,
                        moien_code: r.moien_code,
                        tafsil_code: r.tafsil_code,
                        groupId: r.groupId,
                        karbord: "صورت مالی",
                        status: "synced",
                        lastModified: Date.now()
                    });
                }
            }
            await new Promise((res2, rej) => { writeTx.oncomplete = res2; writeTx.onerror = () => rej(writeTx.error); });

            updateGlobalStats();
            applyFilters(false);
            alert("✅ تغییرات با موفقیت در سرور ثبت شد.");
        } catch (err) {
            alert("❌ خطا در ارسال: " + err.message);
        } finally {
            updateGlobalStats();
        }
    };

    // ─── ۹. رویدادهای کنترلی و Debounce جستجو ───
    let searchTimer = null;
    searchInput.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => applyFilters(true), 180);
    };

    filterGroup.onchange = () => applyFilters(true);
    filterStatus.onchange = () => applyFilters(true);

    companySelect.onchange = () => {
        if (companySelect.value) loadAndSyncBtn.click();
    };

    loadAndSyncBtn.onclick = async () => {
        if (!companySelect.value) return alert("لطفاً یک شرکت انتخاب کنید.");
        currentCompanyCode = companySelect.value;
        loadAndSyncBtn.disabled = true;
        loadAndSyncBtn.textContent = "در حال همگام‌سازی...";
        try {
            // استفاده مستقیم از متد بهینه dbManager به جای کد تکراری
            await dbManager.syncCodingIndex(currentCompanyCode);
            await loadAllData();
        } catch (err) {
            alert("خطا: " + err.message);
        } finally {
            loadAndSyncBtn.disabled = false;
            loadAndSyncBtn.textContent = "بارگذاری و همگام‌سازی";
        }
    };

    await init();
})();