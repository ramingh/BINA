/* =========================================
   taraz.js - منطق و کامپوننت فرم تراز
   ========================================= */
window.BinaTarazApp = (function() {
  'use strict';
  
  
let grid = null;
let modalGrid = null;
const engine = new BinaReportEngine();
const dbManager = engine.dbManager;

// ==========================================
// ۱. توابع بارگذاری کمبوها (شرکت‌ها و سال‌ها)
// ==========================================
async function loadCompanies() {
  console.log('🚀 [loadCompanies] شروع...');
  const select = document.getElementById('companyCode');
  try {
    const companies = await dbManager.getCompanies();
    select.innerHTML = '';
    if (!companies || companies.length === 0) {
      select.innerHTML = '<option value="">شرکتی یافت نشد</option>';
      return;
    }
    companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.Codesherkat;
      opt.textContent = c.EsmSherkat + ' (' + c.Codesherkat + ')';
      select.appendChild(opt);
    });
    // بارگذاری سال‌های اولین شرکت
    await loadYears(companies[0].Codesherkat);
  } catch (err) {
    console.error('❌ [loadCompanies] خطا:', err);
    select.innerHTML = '<option value="">خطا در بارگذاری</option>';
  }
}

async function loadYears(companyCode) {
  console.log(`🚀 [loadYears] شروع برای شرکت: ${companyCode}`);
  const select = document.getElementById('fiscalYear');
  if (!companyCode) {
    select.innerHTML = '<option value="">--</option>';
    return;
  }
  select.innerHTML = '<option value="">در حال بارگذاری...</option>';
  try {
    const years = await dbManager.getAvailableYears(companyCode);
    select.innerHTML = '';
    if (!years || years.length === 0) {
      select.innerHTML = '<option value="">سالی یافت نشد</option>';
      return;
    }
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    });
    select.value = years[years.length - 1];
  } catch (err) {
    console.error('❌ [loadYears] خطا:', err);
    select.innerHTML = '<option value="">خطا</option>';
  }
}

// ==========================================
// ۲. تابع اصلی نمایش گرید تراز
// ==========================================
async function runTaraz() {
  const level = document.querySelector('input[name="level"]:checked').value;
  const companyCode = document.getElementById('companyCode').value;
  const fiscalYear = Number(document.getElementById('fiscalYear').value);

  if (!companyCode || !fiscalYear) return;

  try {
    const rows = await engine.execute({
      reportType: 'taraz',
      companyCode: companyCode,
      fiscalYear: fiscalYear,
      level: level
    });

    if (grid) grid.destroy();
    document.getElementById('gridContainer').innerHTML = '';
    
    // پاک کردن رنگ‌های باقی‌مانده
    document.querySelectorAll('.bina-sel, .bina-active, .bina-row-sel').forEach(el => {
      el.classList.remove('bina-sel', 'bina-active', 'bina-row-sel');
    });

    const captions = {
      CodeHesab: 'کد حساب', OnvanHesab: 'عنوان حساب',
      GardeshBedehkar: 'بدهکار', GardeshBestankar: 'بستانکار',
      MandehBedehkar: 'مانده بد', MandehBestankar: 'مانده بس'
    };

    grid = new BinaGrid('#gridContainer', {
      pageSize: 500,
      height: 'calc(100vh - 250px)',
      captions: captions,
      columnCalcs: 'table'
    });

    await grid.setData(rows, `Taraz_${level}`, { own: true });
    
    // فعال‌سازی Drill-down
    if (level === 'kol' || level === 'moien' || level === 'tafsil') {
      grid.on('rowClick', (e) => {
        const nextLevel = level === 'kol' ? 'moien' : (level === 'moien' ? 'tafsil' : 'daftar');
        openDrillDown(e.data, nextLevel, companyCode, fiscalYear);
      });
    }

  } catch (err) {
    document.getElementById('gridContainer').innerHTML = '<div style="padding:20px;color:red;">خطا: ' + err.message + '</div>';
    console.error(err);
  }
}

// ==========================================
// ۳. تابع باز کردن پنجره Drill-down
// ==========================================
  async function openDrillDown(parentRow, nextLevel, companyCode, fiscalYear) {
    // 🔧 استخراج کدها از CodeHesab
    const parts = String(parentRow.CodeHesab).split('-').map(s => s.trim());
    
    // همیشه کد کل را داریم
    const filter = { KOl_Code: Number(parts[0]) };
    
    // فقط اگر سطح معین یا بالاتر بود، کد معین را اضافه کن
    if (nextLevel === 'tafsil' || nextLevel === 'daftar') {
      if (parts[1] !== undefined) filter.Moien_Code = Number(parts[1]);
    }
    
    // فقط اگر سطح دفتر بود، کد تفصیل را اضافه کن
    if (nextLevel === 'daftar') {
      if (parts[2] !== undefined) filter.Tafsil_Code = Number(parts[2]);
    }

    let title = '';
    let reportType = 'taraz';
    
    if (nextLevel === 'daftar') {
        title = `دفتر تفصیل: ${parentRow.CodeHesab} — ${parentRow.OnvanHesab}`;
        reportType = 'daftarTafsil';
    } else {
        title = `جزئیات: ${parentRow.CodeHesab} — ${parentRow.OnvanHesab} (سطح ${nextLevel === 'moien' ? 'معین' : 'تفصیل'})`;
    }

    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalOverlay').classList.add('open');
    
    try {
      const rows = await engine.execute({
        reportType: reportType, 
        companyCode: companyCode, 
        fiscalYear: fiscalYear,
        level: nextLevel === 'daftar' ? 'tafsil' : nextLevel,
        filter: filter
      });
      
      if (modalGrid) { modalGrid.destroy(); document.getElementById('modalGrid').innerHTML = ''; }
      
      let captions = {};
      if (nextLevel === 'daftar') {
          captions = {
              ShomarehSanad: 'شماره سند', Tarikh: 'تاریخ', SharhSanad: 'شرح سند',
              Bedehkar: 'بدهکار', Bestankar: 'بستانکار', Mandeh: 'مانده', Vaziat: 'وضعیت'
          };
      } else {
          captions = { 
              CodeHesab: 'کد حساب', OnvanHesab: 'عنوان حساب', 
              GardeshBedehkar: 'بدهکار', GardeshBestankar: 'بستانکار', 
              MandehBedehkar: 'مانده بد', MandehBestankar: 'مانده بس' 
          };
      }
      
      modalGrid = new BinaGrid('#modalGrid', {
        pageSize: 500, height: '100%', captions: captions
      });
      
      await modalGrid.setData(rows, `Drill_${nextLevel}`, { own: true });
      
      // فعال‌سازی Drill-down برای سطوح بعدی
      if (nextLevel === 'moien') {
        modalGrid.on('rowClick', (e) => openDrillDown(e.data, 'tafsil', companyCode, fiscalYear));
      } else if (nextLevel === 'tafsil') {
        modalGrid.on('rowClick', (e) => openDrillDown(e.data, 'daftar', companyCode, fiscalYear));
      }
      
    } catch (err) {
      console.error(err);
      document.getElementById('modalGrid').innerHTML = '<p style="color:red;padding:10px;">خطا: ' + err.message + '</p>';
    }
  }
// ==========================================
// ۴. بستن پنجره Modal
// ==========================================
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  if (modalGrid) { modalGrid.destroy(); modalGrid = null; }
  document.getElementById('modalGrid').innerHTML = '';
}

// ==========================================
// ۵. رویدادهای اولیه (شروع به کار)
// ==========================================
document.getElementById('companyCode').addEventListener('change', async (e) => {
  await loadYears(e.target.value);
  runTaraz();
});

document.getElementById('fiscalYear').addEventListener('change', () => {
  runTaraz();
});

// ==========================================
// ۵. رویدادهای اولیه (شروع به کار)
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  // ۱. وصل کردن رویدادها (بعد از اینکه HTML لود شد)
  const companyEl = document.getElementById('companyCode');
  const yearEl = document.getElementById('fiscalYear');

  if (companyEl) {
    companyEl.addEventListener('change', async (e) => {
      await loadYears(e.target.value);
      runTaraz();
    });
  }

  if (yearEl) {
    yearEl.addEventListener('change', () => {
      runTaraz();
    });
  }

  // ۲. شروع به کار
  await loadCompanies();
  runTaraz();
});

  // در دسترس قرار دادن توابع برای HTML
  return {
    runTaraz: runTaraz,
    openDrillDown: openDrillDown,
    closeModal: closeModal,
    loadCompanies: loadCompanies
  };
})();