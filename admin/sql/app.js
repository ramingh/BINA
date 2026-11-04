'use strict';
const el = id => document.getElementById(id);
const queryEngine = new BinaQuery({
  maxRowsPerTable: 500000,
  maxTotalRows: 1000000,
  maxJoinRows: 150000,
  onProgress: e => {
    if (e.type === 'loading') {
      el('summary').textContent = `در حال خواندن ${e.table}: ${e.rows} رکورد`;
    }
  }
});
let available = [],
  lastResult = null,
  working = false;
el('origin').textContent = location.origin;
function log(msg) {
  const l = el('log');
  l.textContent += `[${new Date().toLocaleTimeString('en-GB')}] ${msg}\n`;
  l.scrollTop = l.scrollHeight;
}
function setBusy(v) {
  working = v;
  ['load', 'refresh', 'run', 'reset', 'cols'].forEach(id => el(id).disabled = v);
}
async function safe(fn) {
  if (working) return;
  setBusy(true);
  try {
    await fn();
  } catch (e) {
    console.error(e);
    el('summary').textContent = 'خطا: ' + e.message;
    log('ERROR ' + e.message);
  } finally {
    setBusy(false);
  }
}
function quote(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function loadedText() {
  const list = queryEngine.listLoaded();
  el('loaded').textContent = list.length ? 'جدول‌های بارگذاری‌شده: ' + list.map(x => `${x.table} (${x.rows.toLocaleString('en-US')}${x.partial?'؛ ناقص':''})`).join(' | ') : 'هیچ جدولی بارگذاری نشده است.';
  return list;
}
function render(r) {
  lastResult = r;
  const target = el('result');
  target.replaceChildren();
  el('result-note').textContent = `${r.totalResultRows.toLocaleString('en-US')} سطر نتیجه (پیش از محدودیت نمایش). ${r.truncated?'خروجی محدود شده است. ':''}${r.note}`;
  const table = document.createElement('table'),
    head = document.createElement('thead'),
    tr = document.createElement('tr');
  r.columns.forEach(k => {
    const th = document.createElement('th');
    th.textContent = k;
    tr.append(th);
  });
  head.append(tr);
  table.append(head);
  const body = document.createElement('tbody');
  for (const item of r.rows) {
    const row = document.createElement('tr');
    r.columns.forEach(k => {
      const td = document.createElement('td');
      const v = item[k];
      td.textContent = v == null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      row.append(td);
    });
    body.append(row);
  }
  table.append(body);
  target.append(table);
}
el('refresh').onclick = () => safe(async () => {
  available = (await queryEngine.listTables()).filter(x => x.available);
  el('tables').replaceChildren();
  available.forEach(x => {
    const o = document.createElement('option');
    o.value = x.table;
    o.textContent = `${x.table}  (${x.received.toLocaleString('en-US')})`;
    el('tables').append(o);
  });
  el('summary').textContent = `${available.length} جدول در IndexedDB همین Origin: ${location.origin}`;
  log('LOCAL CATALOG: ' + available.length + ' available tables');
         console.log('=8888====');
});
el('load').onclick = () => safe(async () => {
  const table = el('tables').value;
  if (!table) throw Error('ابتدا فهرست و جدول را انتخاب کنید.');
  const maxRows = Number(el('maxrows').value);
  log(`LOAD ${table} cap=${maxRows}`);
  const res = await queryEngine.loadTable({
    table,
    maxRows,
    allowPartial: el('partial').checked
  });
  loadedText();
  el('summary').textContent = `${res.rows.toLocaleString('en-US')} رکورد بارگذاری شد${res.partial?'؛ نمونه ناقص':''}`;
  log(`LOADED ${table} rows=${res.rows} known=${res.known} partial=${res.partial}`);
  el('sql').value = `SELECT * FROM ${quote(table)} LIMIT 20;`;
});
el('cols').onclick = () => safe(async () => {
  const table = el('tables').value;
  if (!table) throw Error('جدول انتخاب نشده است.');
  const s = await queryEngine.getSchema({
    table
  });
  el('summary').textContent = s.columns.map(x => `${x.name} (${x.type})`).join(' | ');
  log('SCHEMA ' + table + ' columns=' + s.columns.length);
});
el('run').onclick = () => safe(async () => {
  const sql = el('sql').value;
  // Auto-load each referenced FROM/JOIN table if it is not already in memory.
  // This is a bounded sample, NOT a scan of all 20-30 million records.
  const rowCap = Number(el('maxrows').value);
  if (!Number.isSafeInteger(rowCap) || rowCap < 1 || rowCap > 500000)
    throw Error('تعداد رکورد باید بین ۱ و ۵۰۰۰۰ باشد.');
  const t0 = performance.now();
  const prepared = await queryEngine.ensureTablesForSQL({
    sql,
    maxRows: rowCap,
    allowPartial: el('partial').checked
  });
  for (const x of prepared.loaded) log(`AUTOLOAD ${x.table} rows=${x.rows} known=${x.known} partial=${x.partial}`);
  for (const x of prepared.reused) log(`REUSE ${x} (already loaded)`);
  loadedText();
  const r = queryEngine.query({
    sql,
    maxResultRows: Number(el('resultlimit').value)
  });
  render(r);
  const totalMs = Math.round((performance.now() - t0) * 10) / 10;
  el('timing').textContent = `SQL ${r.elapsedMs} ms | همراه بارگذاری ${totalMs} ms`;
  log(`QUERY sqlMs=${r.elapsedMs} totalMs=${totalMs} result=${r.totalResultRows}`);
  if (queryEngine.listLoaded().some(x => x.partial)) {
    el('summary').textContent = 'توجه: نتیجه SQL فقط روی نمونه بارگذاری‌شده است، نه تمام رکوردهای بانک اصلی.';
  }
});
el('reset').onclick = () => safe(async () => {
  queryEngine.clear();
  loadedText();
  lastResult = null;
  el('result').textContent = 'فضای آزمایش خالی شد؛ IndexedDB اصلی دست‌نخورده است.';
  el('result-note').textContent = '';
  log('RESET in-memory sample only');
});
el('clearlog').onclick = () => {
  el('log').textContent = '';
};
el('csv').onclick = () => {
  if (!lastResult) {
    log('ابتدا SQL اجرا کنید.');
    return;
  }
  const fields = lastResult.columns;
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [fields.map(cell).join(','), ...lastResult.rows.map(row => fields.map(k => cell(row[k])).join(','))];
  const u = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8'
  }));
  const a = document.createElement('a');
  a.href = u;
  a.download = 'BINA_SQL_Result.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
};
el('sql').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    el('run').click();
  }
});
const findName = (schema, names) => {
  const fields = schema.columns.map(x => x.name);
  return names.map(v => fields.find(n => n.toLowerCase() === v.toLowerCase())).find(Boolean);
};
document.querySelectorAll('[data-example]').forEach(btn => btn.onclick = () => safe(async () => {
  const list = loadedText();
  if (!list.length) throw Error('ابتدا جدول بارگذاری کنید.');
  const a = list[0].table,
    mode = btn.dataset.example;
  if (mode === 'case') {
    el('sql').value = `SELECT A.ID, CASE WHEN A.ID > 10 THEN 'large' ELSE 'small' END AS Label FROM ${quote(a)} A LIMIT 20;`;
    return;
  }
  if (mode === 'union') {
    el('sql').value = `SELECT ID FROM ${quote(a)} WHERE ID = 1 UNION SELECT ID FROM ${quote(a)} WHERE ID = 2;`;
    return;
  }
  if (mode === 'temp') {
    el('sql').value = 'CREATE TABLE tmp_sample (id INTEGER, amount REAL);';
    return;
  }
  if (mode === 'select') {
    el('sql').value = `SELECT * FROM ${quote(a)} LIMIT 20;`;
    return;
  }
  if (mode === 'running') {
    const s = await queryEngine.getSchema({
      table: a
    });
    const debt = findName(s, ['bedm', 'bedehkar', 'bed', 'debit']);
    const id = findName(s, ['ID', 'id']);
    if (!debt || !id) throw Error('برای جمع تجمعی، فیلد ID و bedm (بدهکار) در جدول لازم است.');
    el('sql').value = `SELECT A.*, SUM(COALESCE(A.${quote(debt)}, 0)) OVER (ORDER BY A.${quote(id)} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS JamBed\nFROM ${quote(a)} AS A\nORDER BY A.${quote(id)}\nLIMIT 100;`;
    return;
  }
  if (mode === 'group') {
    const s = await queryEngine.getSchema({
      table: a
    });
    const group = findName(s, ['codetm', 'sal', 'id']) || s.columns[0].name;
    const sum = findName(s, ['bedm', 'besm', 'jam', 'mande']);
    el('sql').value = `SELECT ${quote(group)}, COUNT(*) AS N${sum?`, SUM(${quote(sum)}) AS Total`:''}\nFROM ${quote(a)}\nGROUP BY ${quote(group)}\nORDER BY N DESC\nLIMIT 20;`;
    return;
  }
  if (list.length < 2) throw Error('برای JOIN دو جدول مختلف بارگذاری کنید.');
  const b = list[1].table,
    sa = await queryEngine.getSchema({
      table: a
    }),
    sb = await queryEngine.getSchema({
      table: b
    });
  const col = findName(sa, ['codetm', 'ID']);
  const cb = col ? findName(sb, [col]) : null;
  if (!cb) throw Error('ستون مشترک codetm یا ID پیدا نشد؛ شرط JOIN را دستی بنویسید.');
  el('sql').value = `SELECT a.${quote(col)}, COUNT(*) AS N\nFROM ${quote(a)} a\n${mode==='left'?'LEFT':'INNER'} JOIN ${quote(b)} b ON a.${quote(col)} = b.${quote(cb)}\nGROUP BY a.${quote(col)}\nORDER BY N DESC\nLIMIT 20;`;
}));
log('BINA JS SQL v4.0 ready; AUTO LOAD FROM/JOIN; NO SQLite/WASM; Origin=' + location.origin);