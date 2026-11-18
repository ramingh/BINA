(async function() {
  "use strict";

  const companySelect = document.getElementById("companySelect");
  const loadDataBtn = document.getElementById("loadDataBtn");
  const standardGroupsBody = document.querySelector("#standardGroupsTable tbody");
  const companyAccountsBody = document.querySelector("#companyAccountsTable tbody");
  const mappedIndexBody = document.querySelector("#mappedIndexTable tbody");
  const mapSelectedBtn = document.getElementById("mapSelectedBtn");
  const searchAccountInput = document.getElementById("searchAccount");
  const selectAllAccountsCheckbox = document.getElementById("selectAllAccounts");

  let dbManager = null;
  let standardGroups = [];
  let companyCodingRows = [];
  let currentCompanyCode = null;
 
  try {
    // ✅ ابتدا مطمئن شو webservice وجود دارد
    if (typeof webservice === "undefined") {
      throw new Error("کلاس webservice بارگذاری نشده. فایل bina-db-manager.js را بررسی کنید.");
    }
    const endpoint = localStorage.getItem('bina_manager_endpoint') || "http://localhost/FastDataHandler.ashx";
    const ws = new webservice({ endpoint });
    dbManager = new Index_db({ webservice: ws });
    await dbManager.initialize();

    // بارگذاری لیست شرکت‌ها از متادیتای لوکال
    const codes = await dbManager.getCompanyCodes();
    companySelect.innerHTML = '<option value="">انتخاب شرکت...</option>' + 
      codes.map(c => `<option value="${c}">${c}</option>`).join('');

    // بارگذاری گروه‌های استاندارد از دیتابیس عمومی (public)
    await loadStandardGroups();

  } catch (err) {
    console.error("خطا در راه‌اندازی اولیه:", err);
  }

  async function loadStandardGroups() {
    try {
      const pubDb = await dbManager._publicDB();
      if (pubDb.objectStoreNames.contains("tk_g_soratmali_sherkat")) {
        const tx = pubDb.transaction("tk_g_soratmali_sherkat", "readonly");
        const store = tx.objectStore("tk_g_soratmali_sherkat");
        standardGroups = await new Promise((res, rej) => {
          const req = store.getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        renderStandardGroups();
      }
    } catch (e) {
      console.error("خطا در خواندن گروه‌های استاندارد:", e);
    }
  }

  function renderStandardGroups() {
    standardGroupsBody.innerHTML = standardGroups.map((g, idx) => `
      <tr>
        <td><input type="radio" name="stdGroupRadio" value="${g.id || g.key}" ${idx === 0 ? 'checked' : ''}></td>
        <td>${g.onvan || g.Onvan || '—'}</td>
        <td>${g.karbord || g.Karbord || '—'}</td>
        <td>${g.mahiat || g.Mahiat || '—'}</td>
      </tr>
    `).join('');
  }

loadDataBtn.onclick = async () => {
    currentCompanyCode = companySelect.value;
    if (!currentCompanyCode) {
      alert("لطفاً یک شرکت انتخاب کنید.");
      return;
    }

    try {
      // ۱. همگام‌سازی هوشمند جدول coding_index با سرور در زمان بارگذاری
      console.log("در حال بررسی و همگام‌سازی coding_index...");
      await dbManager.syncCodingIndex(currentCompanyCode);

      // ۲. خواندن کدهای حسابینگ از استور coding شرکت
      companyCodingRows = await dbManager.getRows({ 
        companyCode: currentCompanyCode, 
        family: "coding", 
        limit: 1000 
      });

      renderCompanyAccounts(companyCodingRows);
      await loadMappedIndex();

    } catch (err) {
      console.error("خطا در بارگذاری و همگام‌سازی اطلاعات شرکت:", err);
      alert("خطا در خواندن اطلاعات: " + err.message);
    }
  };

  // ایجاد پویای استور coding_index در دیتابیس شرکت اگر ساخته نشده باشد
 // هر زمان شرکت تغییر کرد یا صفحه لود شد، بررسی پس‌زمینه اجرا شود:
companySelect.onchange = () => {
    const selectedCompany = companySelect.value;
    if (selectedCompany) {
        initBackgroundSync(selectedCompany);
    }
};

function initBackgroundSync(companyCode) {
    setTimeout(async () => {
        try {
            console.log("[Background Sync] در حال بررسی تغییرات در پس‌زمینه...");
            await dbManager.syncCodingIndex(companyCode);
        } catch (err) {
            console.warn("[Background Sync] خطا:", err.message);
        }
    }, 2000);
}

  function renderCompanyAccounts(rows) {
    companyAccountsBody.innerHTML = rows.map(r => `
      <tr data-kol="${r.kol_code || ''}" data-moien="${r.moien_code || ''}" data-tafsil="${r.tafsil_code || ''}">
        <td><input type="checkbox" class="cb-account"></td>
        <td>${r.kol_code || ''}</td>
        <td>${r.kol_onvan || ''}</td>
        <td>${r.moien_code || ''}</td>
        <td>${r.moien_onvan || ''}</td>
        <td>${r.tafsil_code || '—'}</td>
      </tr>
    `).join('');
  }

  selectAllAccountsCheckbox.onchange = function() {
    document.querySelectorAll(".cb-account").forEach(cb => cb.checked = this.checked);
  };

  searchAccountInput.oninput = function() {
    const term = this.value.toLowerCase();
    const filtered = companyCodingRows.filter(r => 
      String(r.kol_code || '').includes(term) ||
      String(r.kol_onvan || '').toLowerCase().includes(term) ||
      String(r.moien_code || '').includes(term) ||
      String(r.moien_onvan || '').toLowerCase().includes(term)
    );
    renderCompanyAccounts(filtered);
  };

  mapSelectedBtn.onclick = async () => {
    if (!currentCompanyCode) return;
    const selectedGroupRadio = document.querySelector('input[name="stdGroupRadio"]:checked');
    if (!selectedGroupRadio) {
      alert("لطفاً یک گروه استاندارد صورت مالی انتخاب کنید.");
      return;
    }
    const groupId = selectedGroupRadio.value;
    const checkedRows = document.querySelectorAll(".cb-account:checked");
    if (!checkedRows.length) {
      alert("هیچ حسابی انتخاب نشده است.");
      return;
    }

    try {
      const compDb = await dbManager._companyDB(currentCompanyCode);
      const tx = compDb.transaction("coding_index", "readwrite");
      const store = tx.objectStore("coding_index");

      for (const cb of checkedRows) {
        const tr = cb.closest("tr");
        const kol = tr.dataset.kol;
        const moien = tr.dataset.moien;
        const tafsil = tr.dataset.tafsil || "";

        // کلید ترکیبی ۴ فیلدی برای نگاشت
        const mappingKey = `${currentCompanyCode}_${kol}_${moien}_${tafsil}`;
        const record = {
          key: mappingKey,
          companyCode: currentCompanyCode,
          kol_code: kol,
          moien_code: moien,
          tafsil_code: tafsil,
          groupId: groupId,
          karbord: "صورت مالی"
        };
        store.put(record);
      }

      await new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });

      alert("نگاشت حساب‌ها با موفقیت در کدینگ-ایندکس ثبت شد.");
      await loadMappedIndex();
    } catch (err) {
      console.error("خطا در ذخیره نگاشت:", err);
      alert("خطا در ثبت نگاشت: " + err.message);
    }
  };

  async function loadMappedIndex() {
    const compDb = await dbManager._companyDB(currentCompanyCode);
    if (!compDb.objectStoreNames.contains("coding_index")) {
      mappedIndexBody.innerHTML = '<tr><td colspan="4">استور coding_index ایجاد نشده است.</td></tr>';
      return;
    }
    
    const tx = compDb.transaction("coding_index", "readonly");
    const store = tx.objectStore("coding_index");
    const records = await new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });

    mappedIndexBody.innerHTML = records.map(r => {
      const group = standardGroups.find(g => String(g.id || g.key) === String(r.groupId));
      return `
        <tr>
          <td>${r.kol_code} - ${r.moien_code} ${r.tafsil_code ? '- ' + r.tafsil_code : ''}</td>
          <td>${group ? (group.onvan || group.Onvan) : 'شناسه گروه: ' + r.groupId}</td>
          <td>${r.karbord || '—'}</td>
          <td><button class="danger" onclick="window.deleteMapping('${r.key}')">حذف</button></td>
        </tr>
      `;
    }).join('');
  }

  window.deleteMapping = async function(key) {
    if (!currentCompanyCode) return;
    try {
      const compDb = await dbManager._companyDB(currentCompanyCode);
      const tx = compDb.transaction("coding_index", "readwrite");
      tx.objectStore("coding_index").delete(key);
      await new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      await loadMappedIndex();
    } catch (e) {
      console.error("خطا در حذف نگاشت:", e);
    }
  };
// افزودن دکمه یا رویداد ارسال به سرور در بخش کلاینت
// دکمه ارسال به سرور
const syncServerBtn = document.getElementById("syncServerBtn");
  
  if (syncServerBtn) {
    syncServerBtn.onclick = async () => {
      if (!currentCompanyCode) {
        alert("لطفاً ابتدا یک شرکت را انتخاب و بارگذاری کنید.");
        return;
      }

      try {
        const compDb = await dbManager._companyDB(currentCompanyCode);
        if (!compDb.objectStoreNames.contains("coding_index")) {
          alert("استور coding_index در پایگاه داده محلی یافت نشد.");
          return;
        }

        // ۱. خواندن تمام نگاشت‌ها از IndexedDB محلی
        const tx = compDb.transaction("coding_index", "readonly");
        const store = tx.objectStore("coding_index");
        const mappings = await new Promise((res, rej) => {
          const req = store.getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });

        if (!mappings.length) {
          alert("هیچ نگاشتی برای ارسال به سرور ثبت نشده است.");
          return;
        }

        const endpoint = localStorage.getItem('bina_manager_endpoint') || "http://localhost/FastDataHandler.ashx";
        const targetUrl = `${endpoint}?mode=save_coding_index`;

        console.log(`📤 در حال ارسال ${mappings.length} نگاشت به آدرس: ${targetUrl}`);
        console.log("📦 محتوای ارسالی (Payload):", { companyCode: currentCompanyCode, mappings });

        // ۲. ارسال پکیج به وب‌سرویس سرور
        const response = await fetch(targetUrl, {
          method: "POST", // اکنون سرور این متد را پشتیبانی خواهد کرد
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ 
            companyCode: currentCompanyCode, 
            mappings: mappings 
          })
        });

        console.log(`📥 وضعیت پاسخ سرور (Status): ${response.status} ${response.statusText}`);

        // خواندن متن خام پاسخ برای دیباگ دقیق در صورت بروز خطا
        const responseText = await response.text();
        console.log("📄 متن پاسخ سرور:", responseText);

        let result;
        try {
          result = JSON.parse(responseText);
        } catch (parseErr) {
          throw new Error("پاسخ سرور فرمت JSON معتبری ندارد: " + responseText);
        }

        if (result && result.ok) {
          alert("✅ نگاشت‌ها با موفقیت روی سرور (SQL Server) ذخیره و همگام‌سازی شدند.");
        } else {
          throw new Error(result.error || "خطای ناشناخته در سرور");
        }

      } catch (err) {
        console.error("❌ خطا در همگام‌سازی با سرور:", err);
        alert("❌ خطا در ارتباط با سرور: " + err.message + "\n(جزئیات بیشتر را در Console مرورگر بررسی کنید)");
      }
    };
  }


})();