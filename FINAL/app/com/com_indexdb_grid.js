/* BinaIndexGrid v1.0.0 — نمایش یک جدول (object store) از IndexedDB در گرید استاندارد
 *
 * پیش‌نیازها (به همین ترتیب در صفحه لود شوند):
 *   css/tabulator.min.css, css/com_grid.css, app/com/tabulator.min.js, app/com/com_grid.js
 *
 * استفاده:
 *   const viewer = new BinaIndexGrid({ container: "#gridContainer", dbName: "1100" });
 *   await viewer.show("coding_index");          // نام جدول؛ دیتابیس از dbName
 *   await viewer.show("tk_sherkat", "public");  // یا هردو با هم
 *
 * اگر dbName داده نشود، کامپوننت خودش دیتابیسی را که این جدول را دارد پیدا می‌کند
 * (نیازمند indexedDB.databases؛ در مرورگرهای بدون آن باید dbName بدهید).
 *
 * API:
 *   show(store, dbName?)  → Promise<{ dbName, store, rows, columns }>
 *   listStores(dbName)    → Promise<string[]>
 *   listDatabases()       → Promise<string[]>
 *   getRows() / getGrid() / destroy()
 */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";

  var DEFAULT_CAPTIONS = {
    _key: "کلید",
    _bytes: "حجم (بایت)",
    _value: "مقدار",
  };

  var DEFAULT_PRESETS = {
    _key: { width: 260, minWidth: 120, kind: "text" },
    _bytes: { width: 110, minWidth: 90, kind: "number" },
    _value: { width: 260, minWidth: 120, kind: "text" },
  };

  // ─── کمکی‌های IndexedDB ───

  function openDatabase(name) {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = indexedDB.open(name);
      } catch (err) {
        reject(err);
        return;
      }
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(
          new Error("باز کردن دیتابیس «" + name + "» ممکن نشد: " + (request.error?.message || request.error)),
        );
      };
      request.onblocked = function () {
        reject(new Error("دیتابیس «" + name + "» قفل است؛ ابتدا صفحه‌های دیگر را ببندید."));
      };
    });
  }

  function listDatabaseNames() {
    if (typeof indexedDB.databases !== "function") return Promise.resolve(null);
    return indexedDB
      .databases()
      .then(function (list) {
        return (list || []).map(function (db) {
          return db && db.name;
        }).filter(Boolean);
      })
      .catch(function () {
        return null;
      });
  }

  function findStoreName(db, store) {
    var wanted = String(store || "").toLowerCase();
    var names = Array.from(db.objectStoreNames || []);
    for (var i = 0; i < names.length; i++) {
      if (String(names[i]).toLowerCase() === wanted) return names[i];
    }
    return null;
  }

  function readAll(db, storeName, maxRows) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction([storeName], "readonly");
      } catch (err) {
        reject(err);
        return;
      }
      var store = tx.objectStore(storeName);
      var keysRequest = store.getAllKeys(null, maxRows);
      var valuesRequest = store.getAll(null, maxRows);
      tx.oncomplete = function () {
        resolve({
          keys: keysRequest.result || [],
          values: valuesRequest.result || [],
        });
      };
      tx.onerror = function () {
        reject(new Error("خواندن جدول «" + storeName + "» ممکن نشد: " + (tx.error?.message || tx.error)));
      };
      tx.onabort = function () {
        reject(new Error("خواندن جدول «" + storeName + "» لغو شد."));
      };
    });
  }

  // ─── کمکی‌های تبدیل مقدار به سلول ───

  function isBinary(value) {
    return (
      value instanceof ArrayBuffer ||
      (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value))
    );
  }

  function byteLengthOf(value) {
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) return value.byteLength;
    return 0;
  }

  function keyText(key) {
    if (key === undefined || key === null) return "";
    if (Array.isArray(key)) {
      return key
        .map(function (part) {
          return part === null || part === undefined ? "" : String(part);
        })
        .join(" | ");
    }
    if (typeof key === "object") {
      try {
        return JSON.stringify(key);
      } catch (_) {
        return String(key);
      }
    }
    return String(key);
  }

  function cellValue(value) {
    if (value === null || value === undefined) return "";
    var type = typeof value;
    if (type === "number" || type === "boolean") return value;
    if (type === "string") return value;
    if (value instanceof Date) return value.toISOString();
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  // ─── کلاس اصلی ───

  class BinaIndexGrid {
    constructor(options) {
      options = options || {};
      if (typeof global.BinaGrid !== "function") {
        throw new Error(
          "BinaGrid بارگذاری نشده — ابتدا tabulator.min.css/js و com_grid.js را ضمیمه کنید.",
        );
      }
      var container =
        typeof options.container === "string"
          ? document.querySelector(options.container)
          : options.container;
      if (!container) {
        throw new Error("کانتینر گرید پیدا نشد: " + options.container);
      }

      this.container = container;
      this.options = options;
      this.captions = Object.assign({}, DEFAULT_CAPTIONS, options.captions || {});
      this.presets = Object.assign({}, DEFAULT_PRESETS, options.presetcolumns || {});
      this.maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : 100000;
      this.dbName = options.dbName || null;
      this.storeName = options.store || null;
      this.rows = [];
      this.grid = null;
    }

    static get version() {
      return VERSION;
    }

    /** نام جدول (استور) را می‌گیرد و در گرید نمایش می‌دهد. */
    async show(store, dbName) {
      var storeArg = store || this.storeName;
      if (!storeArg) throw new Error("نام جدول IndexedDB را بدهید.");
      var target = dbName || this.dbName;
      var opened = await this._openForStore(storeArg, target);
      try {
        var real = findStoreName(opened.db, storeArg);
        if (!real) {
          throw new Error(
            "جدول «" +
              storeArg +
              "» در دیتابیس «" +
              opened.name +
              "» نیست. جدول‌های موجود: " +
              Array.from(opened.db.objectStoreNames || []).join(", "),
          );
        }
        var data = await readAll(opened.db, real, this.maxRows);
        this.rows = this._buildRows(data.keys, data.values);
        this.dbName = opened.name;
        this.storeName = real;
        await this._render();
        return {
          dbName: opened.name,
          store: real,
          rows: this.rows.length,
          columns: this.rows.length ? Object.keys(this.rows[0]).filter(function (k) { return k !== "__id"; }) : [],
        };
      } finally {
        try {
          opened.db.close();
        } catch (_) {}
      }
    }

    async listStores(dbName) {
      var target = dbName || this.dbName;
      if (!target) throw new Error("نام دیتابیس را بدهید.");
      var available = await listDatabaseNames();
      if (available && available.indexOf(target) < 0) {
        throw new Error("دیتابیس «" + target + "» وجود ندارد.");
      }
      var db = await openDatabase(target);
      try {
        return Array.from(db.objectStoreNames || []);
      } finally {
        try {
          db.close();
        } catch (_) {}
      }
    }

    listDatabases() {
      return listDatabaseNames().then(function (names) {
        return names || [];
      });
    }

    getRows() {
      return this.rows;
    }

    getGrid() {
      return this.grid;
    }

    destroy() {
      if (this.grid && typeof this.grid.destroy === "function") this.grid.destroy();
      this.grid = null;
      this.rows = [];
    }

    async _openForStore(store, dbName) {
      if (dbName) {
        var available = await listDatabaseNames();
        if (available && available.indexOf(dbName) < 0) {
          throw new Error(
            "دیتابیس «" + dbName + "» وجود ندارد. دیتابیس‌های موجود: " + (available.join(", ") || "—"),
          );
        }
        var db = await openDatabase(dbName);
        if (!db.objectStoreNames.length) {
          try {
            db.close();
          } catch (_) {}
          throw new Error("دیتابیس «" + dbName + "» هیچ جدولی ندارد.");
        }
        return { db: db, name: dbName };
      }

      var names = await listDatabaseNames();
      if (!names) {
        throw new Error("این مرورگر فهرست دیتابیس‌ها را نمی‌دهد؛ نام دیتابیس را (dbName) بدهید.");
      }
      for (var i = 0; i < names.length; i++) {
        var candidate = await openDatabase(names[i]);
        if (findStoreName(candidate, store)) {
          return { db: candidate, name: names[i] };
        }
        try {
          candidate.close();
        } catch (_) {}
      }
      throw new Error(
        "جدول «" + store + "» در هیچ دیتابیسی پیدا نشد. دیتابیس‌های موجود: " + (names.join(", ") || "—"),
      );
    }

    _buildRows(keys, values) {
      var raw = [];
      for (var i = 0; i < values.length; i++) {
        var key = keys[i];
        var value = values[i];
        var row = { __id: i + 1 };
        if (key !== undefined && key !== null) row._key = keyText(key);
        if (isBinary(value)) {
          row._bytes = byteLengthOf(value);
          row._value = "باینری — " + row._bytes + " بایت";
        } else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
          var fields = Object.keys(value);
          for (var f = 0; f < fields.length; f++) {
            if (fields[f] === "__id") continue;
            row[fields[f]] = cellValue(value[fields[f]]);
          }
        } else {
          row._value = cellValue(value);
        }
        raw.push(row);
      }
      return this._normalizeColumns(raw);
    }

    // همهٔ ردیف‌ها باید یک مجموعهٔ ستون یکسان داشته باشند، چون BinaGrid
    // ستون‌ها را از کلیدهای اولین ردیف می‌سازد.
    _normalizeColumns(rows) {
      var order = [];
      var seen = Object.create(null);
      rows.forEach(function (row) {
        Object.keys(row).forEach(function (key) {
          if (key === "__id" || seen[key]) return;
          seen[key] = true;
          order.push(key);
        });
      });
      return rows.map(function (row) {
        var out = { __id: row.__id };
        for (var i = 0; i < order.length; i++) {
          var key = order[i];
          out[key] = row[key] === undefined ? "" : row[key];
        }
        return out;
      });
    }

    async _render() {
      if (!this.grid) {
        var gridOptions = {
          height: this.options.height || "640px",
          pageSize: this.options.pageSize || 100,
          pageSizeOptions: this.options.pageSizeOptions || [100, 500, 1000, 5000, true],
          storagePrefix: this.options.storagePrefix || "BinaIndexGrid",
          captions: this.captions,
          presetcolumns: this.presets,
        };
        if (this.options.rowSelector !== undefined) gridOptions.rowSelector = this.options.rowSelector;
        if (this.options.showToolbar !== undefined) gridOptions.showToolbar = this.options.showToolbar;
        this.grid = new global.BinaGrid(this.container, gridOptions);
      }
      await this.grid.setData(
        this.rows,
        "IndexedDB:" + this.dbName + "/" + this.storeName,
        { own: true },
      );
    }
  }

  global.BinaIndexGrid = BinaIndexGrid;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = BinaIndexGrid;
  }
})(typeof window !== "undefined" ? window : globalThis);
