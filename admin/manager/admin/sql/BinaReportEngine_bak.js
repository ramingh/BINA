
 /**
 * ═══════════════════════════════════════════════════════════════════════════
 * BinaReportEngine v1.1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 📖 توصیف کلی:
 * موتور تولید گزارش‌های حسابداری در سمت کلاینت (مرورگر).
 * این کامپوننت داده‌های فشرده (GZIP) را از IndexedDB می‌خواند،
 * با استفاده از الگوریتم‌های بهینه (Map-based Aggregation & Join)
 * پردازش می‌کند و خروجی را به صورت آرایه‌ای از اشیاء برمی‌گرداند
 * که مستقیماً به BinaGrid (یا هر گرید دیگر) قابل اتصال است.
 * 
 * 🔗 وابستگی‌ها:
 * - BinaDBManager.js (مدیریت IndexedDB)
 * - DataDecompressor.js (بازگشایی داده‌های فشرده)
 * - pako (کتابخانه GZIP - باید قبل از این فایل لود شود)
 * 
 * 📝 تغییرات v1.1.0:
 * - حذف تعریف تکراری sql2js (نسخه اول)
 * - اصلاح باگ JOIN: joinMap اکنون با کلید ترکیبی joinConditions ساخته می‌شود
 * - اصلاح باگ CONCAT: ترتیب replace/filter درست شد
 * - حذف caseRegex تکراری (منطق هوشمند CASE کافی است)
 * - اصلاح متریک‌های عملکرد (هر فاز از t0 خودش)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  class BinaReportEngine {
    /**
     * سازنده کلاس
     * @param {Object} [options] - تنظیمات اختیاری
     * @param {BinaDBManager} [options.dbManager] - نمونه BinaDBManager
     * @param {DataDecompressor} [options.decompressor] - نمونه DataDecompressor
     * @param {boolean} [options.enablePerformanceLog=true] - نمایش لاگ زمان‌بندی
     * @param {Function} [options.logger=console] - تابع لاگ
     */
    constructor(options = {}) {
      this.options = Object.assign({
        enablePerformanceLog: true,
        logger: console
      }, options);

      this.dbManager = options.dbManager || new BinaDBManager();
      this.decompressor = options.decompressor || new DataDecompressor();

      this.lastMetrics = null;

      this.options.logger.log('✅ BinaReportEngine v1.1.0 آماده به کار است.');
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * متد اصلی: execute
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * نقطه ورود اصلی برای گزارش‌های از پیش تعریف‌شده (reportType).
     * برای کوئری‌های SQL خام، از sql2js استفاده کنید.
     * 
     * @param {Object} params
     * @param {string} params.reportType - نوع گزارش (مثلاً 'accountMovement')
     * @param {string} params.companyCode - کد شرکت
     * @param {number} params.fiscalYear - سال مالی
     * @returns {Promise<Object[]>}
     */
    async execute(params) {
      this._validateParams(params);

      const startTime = performance.now();
      const metrics = {
        reportType: params.reportType,
        companyCode: params.companyCode,
        fiscalYear: params.fiscalYear,
        phases: {}
      };

      try {
        let result;
console.log('------------=================================---------');

        switch (params.reportType) {
          case 'accountMovement':
            result = await this._generateAccountMovement(params, metrics);
            break;

          default:
            throw new Error(`نوع گزارش ناشناخته: ${params.reportType}. انواع پشتیبانی‌شده: accountMovement`);
        }

        metrics.totalTimeMs = performance.now() - startTime;
        metrics.resultCount = result.length;
        this.lastMetrics = metrics;

        if (this.options.enablePerformanceLog) {
          this._logPerformance(metrics);
        }

        return result;

      } catch (error) {
        this.options.logger.error('❌ خطا در BinaReportEngine.execute:', error);
        throw error;
      }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * گزارش گردش و مانده حساب (Account Movement & Balance Report)
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * معادل کوئری SQL زیر (اما با Map-based aggregation بسیار سریع‌تر):
     * 
     * SELECT
     *     '1400' AS EsmSherkat,
     *     1395 AS SalMali,
     *     CONCAT(s.KOl_Code, ' - ', s.Moien_Code, ' - ', s.Tafsil_Code) AS CodeHesab,
     *     s.KOl_Code, s.Moien_Code, s.Tafsil_Code,
     *     CONCAT(c.KOl_Onvan, ' - ', c.MOien_Onvan, ' - ', c.Tafsil_Onvan) AS OnvanHesab,
     *     c.KOl_Onvan, c.MOien_Onvan, c.Tafsil_Onvan,
     *     SUM(s.Bedehkar) AS GardeshBedehkar,
     *     SUM(s.Bestankar) AS GardeshBestankar,
     *     CASE WHEN SUM(s.Bedehkar - s.Bestankar) > 0
     *          THEN SUM(s.Bedehkar - s.Bestankar) ELSE 0 END AS MandehBedehkar,
     *     CASE WHEN SUM(s.Bestankar - s.Bedehkar) > 0
     *          THEN SUM(s.Bestankar - s.Bedehkar) ELSE 0 END AS MandehBestankar
     * FROM Sanad_1395_1400 AS s
     * LEFT JOIN Coding_1400 AS c
     *     ON c.KOl_Code = s.KOl_Code
     *     AND c.Moien_Code = s.Moien_Code
     *     AND c.Tafsil_Code = s.Tafsil_Code
     * GROUP BY s.KOl_Code, s.Moien_Code, s.Tafsil_Code,
     *          c.KOl_Onvan, c.MOien_Onvan, c.Tafsil_Onvan
     * ORDER BY s.KOl_Code, s.Moien_Code, s.Tafsil_Code
     * 
     * @private
     */
    async _generateAccountMovement(params, metrics) {
      const { companyCode, fiscalYear } = params;

      // ═══ فاز ۱: بارگذاری داده‌های Coding ═══
      let t0 = performance.now();

      const codingData = await this.dbManager.getReadyData(companyCode, 'coding', null);
      const codingRows = await this.decompressor.inflateBlocks(
        codingData.blocks,
        codingData.columns,
        { family: 'coding', companyCode }
      );

      metrics.phases.codingLoad = {
        durationMs: performance.now() - t0,
        rowCount: codingRows.length
      };

      // ═══ فاز ۲: ساخت ایندکس Coding در Map ═══
      t0 = performance.now();

      const codingMap = new Map();
      for (let i = 0; i < codingRows.length; i++) {
        const c = codingRows[i];
        const key = `${c.kol_code}-${c.moien_code}-${c.tafsil_code}`;
        codingMap.set(key, {
          kol_onvan: c.kol_onvan || '',
          moien_onvan: c.moien_onvan || '',
          tafsil_onvan: c.tafsil_onvan || ''
        });
      }

      metrics.phases.codingIndex = {
        durationMs: performance.now() - t0,
        indexSize: codingMap.size
      };

      // ═══ فاز ۳: بارگذاری داده‌های Sanad ═══
      t0 = performance.now();

      const sanadData = await this.dbManager.getReadyData(companyCode, 'sanad', fiscalYear);
      const sanadRows = await this.decompressor.inflateBlocks(
        sanadData.blocks,
        sanadData.columns,
        { family: 'sanad', companyCode, fiscalYear }
      );

      metrics.phases.sanadLoad = {
        durationMs: performance.now() - t0,
        rowCount: sanadRows.length
      };

      // ═══ فاز ۴: تجمیع Sanad در Map ═══
      t0 = performance.now();

      const aggregatedSanad = new Map();

      for (let i = 0; i < sanadRows.length; i++) {
        const row = sanadRows[i];
        const key = `${row.kol_code}-${row.moien_code}-${row.tafsil_code}`;

        if (!aggregatedSanad.has(key)) {
          aggregatedSanad.set(key, {
            kol_code: row.kol_code,
            moien_code: row.moien_code,
            tafsil_code: row.tafsil_code,
            totalBedehkar: 0,
            totalBestankar: 0
          });
        }

        const acc = aggregatedSanad.get(key);
        acc.totalBedehkar += (Number(row.bedehkar) || 0);
        acc.totalBestankar += (Number(row.bestankar) || 0);
      }

      metrics.phases.sanadAggregation = {
        durationMs: performance.now() - t0,
        uniqueAccounts: aggregatedSanad.size
      };

      // ═══ فاز ۵: JOIN دو Map و ساخت خروجی نهایی ═══
      t0 = performance.now();

      const result = [];

      for (const [key, sanad] of aggregatedSanad.entries()) {
        const coding = codingMap.get(key);

        const bedehkar = sanad.totalBedehkar;
        const bestankar = sanad.totalBestankar;
        const mandehBedehkar = (bedehkar - bestankar) > 0 ? (bedehkar - bestankar) : 0;
        const mandehBestankar = (bestankar - bedehkar) > 0 ? (bestankar - bedehkar) : 0;

        result.push({
          EsmSherkat: companyCode,
          SalMali: fiscalYear,

          CodeHesab: `${sanad.kol_code} - ${sanad.moien_code} - ${sanad.tafsil_code}`,
          kol_code: sanad.kol_code,
          moien_code: sanad.moien_code,
          tafsil_code: sanad.tafsil_code,

          OnvanHesab: coding
            ? `${coding.kol_onvan} - ${coding.moien_onvan} - ${coding.tafsil_onvan}`
            : '',
          kol_onvan: coding ? coding.kol_onvan : '',
          moien_onvan: coding ? coding.moien_onvan : '',
          tafsil_onvan: coding ? coding.tafsil_onvan : '',

          GardeshBedehkar: bedehkar,
          GardeshBestankar: bestankar,
          MandehBedehkar: mandehBedehkar,
          MandehBestankar: mandehBestankar
        });
      }

      metrics.phases.joinAndTransform = {
        durationMs: performance.now() - t0,
        resultCount: result.length
      };

      // ═══ فاز ۶: مرتب‌سازی نتیجه ═══
      t0 = performance.now();

      result.sort((a, b) => {
        if (a.kol_code !== b.kol_code) return a.kol_code - b.kol_code;
        if (a.moien_code !== b.moien_code) return a.moien_code - b.moien_code;
        return a.tafsil_code - b.tafsil_code;
      });

      metrics.phases.sorting = {
        durationMs: performance.now() - t0
      };

      // ═══ فاز ۷: آزادسازی حافظه ═══
      codingRows.length = 0;
      sanadRows.length = 0;

      return result;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * sql2js: تبدیل کوئری SQL به الگوریتم بهینه JavaScript
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * الگوی پشتیبانی‌شده:
     * - SELECT با فیلدهای معمولی، SUM، CONCAT، CASE WHEN
     * - FROM یک جدول اصلی (Sanad_YYYY_XXXX)
     * - LEFT JOIN با جدول دوم (Coding_XXXX)
     * - ON با شرایط چند ستونه (AND)
     * - GROUP BY چند ستونه
     * - ORDER BY چند ستونه
     * 
     * @param {string} sqlQuery
     * @returns {Promise<Object[]>}
     */

        async sql2js(sqlQuery) {
      const startTime = performance.now();
      const metrics = {
        phase: 'sql2js',
        phases: {},
        reportType: 'SQL Query',
        companyCode: 'unknown',
        fiscalYear: 'unknown'
      };

      try {
        // ═══ مرحله ۱: تجزیه SQL ═══
        let t0 = performance.now();
        const parsed = this._parseSQL(sqlQuery);
        metrics.phases.parsing = { durationMs: performance.now() - t0 };

        // ═══ مرحله ۲: استخراج اطلاعات جداول ═══
        t0 = performance.now();
        const { mainTable, joinTable, companyCode, fiscalYear } = this._extractTableInfo(parsed);
        metrics.companyCode = companyCode;
        metrics.fiscalYear = fiscalYear;
        metrics.reportType = `SQL: ${mainTable.name}`;
        metrics.phases.tableExtraction = { durationMs: performance.now() - t0 };

        // ═══ مرحله ۳: بارگذاری داده‌ها ═══
        t0 = performance.now();
        const [mainData, joinData] = await Promise.all([
          this.dbManager.getReadyData(companyCode, mainTable.family, fiscalYear),
          joinTable
            ? this.dbManager.getReadyData(companyCode, joinTable.family, null)
            : Promise.resolve({ blocks: [], columns: [] })
        ]);

        const [mainRows, joinRows] = await Promise.all([
          this.decompressor.inflateBlocks(mainData.blocks, mainData.columns, {
            family: mainTable.family, companyCode, fiscalYear
          }),
          joinTable
            ? this.decompressor.inflateBlocks(joinData.blocks, joinData.columns, {
                family: joinTable.family, companyCode
              })
            : Promise.resolve([])
        ]);

        metrics.phases.dataLoad = {
          durationMs: performance.now() - t0,
          mainRows: mainRows.length,
          joinRows: joinRows ? joinRows.length : 0
        };

        // ═══ مرحله ۴: ساخت ایندکس JOIN ═══
        // 🔧 تطبیق بدون حساسیت به حروف (چون نام ستون‌های دیتابیس lowercase هستند)
        t0 = performance.now();
        const joinMap = new Map();
        const joinKeyFields = parsed.joinConditions.map(c => c.rightField);

        if (joinRows && joinRows.length > 0 && joinKeyFields.length > 0) {
          for (const row of joinRows) {
            const key = joinKeyFields
              .map(f => this._pickField(row, f))
              .join('|');
            joinMap.set(key, row);
          }
        }

        metrics.phases.joinIndex = {
          durationMs: performance.now() - t0,
          indexSize: joinMap.size,
          keyFields: joinKeyFields
        };

        // ═══ مرحله ۵: تجمیع و JOIN ═══
        t0 = performance.now();
        const aggregated = new Map();

        const groupKeyFields = joinKeyFields.length > 0
          ? joinKeyFields
          : parsed.groupBy;

        for (const row of mainRows) {
          const groupKey = groupKeyFields.length > 0
            ? groupKeyFields.map(f => this._pickField(row, f)).join('|')
            : 'single_group';

          if (!aggregated.has(groupKey)) {
            const joinRow = joinMap.get(groupKey) || {};
            const acc = {
              _groupFields: {},
              _joinRow: joinRow,
              _aggregates: {}
            };
            // فیلدهای groupBy را با نام واقعی از row بردار
            parsed.groupBy.forEach(f => {
              const actualValue = this._pickField(row, f);
              acc._groupFields[f] = actualValue;
            });
            aggregated.set(groupKey, acc);
          }

          const acc = aggregated.get(groupKey);
          parsed.sumFields.forEach(({ field, alias }) => {
            if (!acc._aggregates[alias]) acc._aggregates[alias] = 0;
            acc._aggregates[alias] += (Number(this._pickField(row, field)) || 0);
          });
        }

        metrics.phases.aggregation = {
          durationMs: performance.now() - t0,
          uniqueGroups: aggregated.size,
          groupKeyFields
        };

        // ═══ مرحله ۶: ساخت خروجی نهایی ═══
        t0 = performance.now();
        const result = [];

        for (const [, acc] of aggregated.entries()) {
          const row = {};
          Object.assign(row, acc._groupFields);
          Object.assign(row, acc._joinRow);
          Object.assign(row, acc._aggregates);

          parsed.caseFields.forEach((caseField) => {
            row[caseField.alias] = this._evaluateCaseExpression(caseField, row);
          });

          // 🔧 CONCAT: فیلدها را با _pickField از row بردار
          parsed.concatFields.forEach(({ alias, parts }) => {
            row[alias] = parts
              .map(p => {
                const v = this._pickField(row, p);
                return v !== undefined && v !== null ? v : '';
              })
              .join(' - ');
          });

          parsed.constantFields.forEach(({ alias, value }) => {
            row[alias] = value;
          });

          result.push(row);
        }

        metrics.phases.finalTransform = {
          durationMs: performance.now() - t0,
          resultCount: result.length
        };

        // ═══ مرحله ۷: مرتب‌سازی ═══
        t0 = performance.now();
        if (parsed.orderBy.length > 0) {
          result.sort((a, b) => {
            for (const field of parsed.orderBy) {
              const va = this._pickField(a, field);
              const vb = this._pickField(b, field);
              if (va !== vb) {
                return va < vb ? -1 : 1;
              }
            }
            return 0;
          });
        }
        metrics.phases.sorting = { durationMs: performance.now() - t0 };

        metrics.totalTimeMs = performance.now() - startTime;
        metrics.resultCount = result.length;
        this.lastMetrics = metrics;

        if (this.options.enablePerformanceLog) {
          this._logPerformance(metrics);
        }

        return result;

      } catch (error) {
        this.options.logger.error('❌ خطا در sql2js:', error);
        throw error;
      }
    }

    /**
     * 🔧 دریافت مقدار فیلد از ردیف، بدون حساسیت به حروف.
     */
    _pickField(row, name) {
      if (row[name] !== undefined) return row[name];
      const lower = String(name).toLowerCase();
      for (const k in row) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return undefined;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * تجزیه کوئری SQL
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * @private
     * @param {string} sql
     * @returns {Object}
     */
    _parseSQL(sql) {
      if (!sql || typeof sql !== 'string') {
        throw new Error('کوئری SQL وارد شده معتبر نیست.');
      }

      // ۱. استخراج FROM (پشتیبانی از [Schema].[Table] AS alias یا Table AS alias)
      const fromRegex = /FROM\s+(?:\[?[^\]]+\]?\s*\.\s*)*(\[?[^\]\s]+\]?)\s+(?:AS\s+)?(\w+)/i;
      const fromMatch = sql.match(fromRegex);

      if (!fromMatch) {
        console.error('❌ SQL دریافتی برای پارس:', sql);
        throw new Error('بخش FROM در کوئری SQL یافت نشد یا فرمت آن صحیح نیست.\nمثال صحیح: FROM [Bina].[dbo].[Sanad_1395_1400] AS s');
      }

      const mainTableName = fromMatch[1].replace(/\[|\]/g, '');
      const mainAlias = fromMatch[2];

      // ۲. استخراج LEFT JOIN (اختیاری)
      const joinRegex = /LEFT\s+JOIN\s+(?:\[?[^\]]+\]?\s*\.\s*)*(\[?[^\]\s]+\]?)\s+(?:AS\s+)?(\w+)\s+ON\s+([\s\S]*?)(?:GROUP\s+BY|ORDER\s+BY|$)/i;
      const joinMatch = sql.match(joinRegex);

      let joinTableName = null;
      let joinAlias = null;
      let joinConditions = [];

      if (joinMatch) {
        joinTableName = joinMatch[1].replace(/\[|\]/g, '');
        joinAlias = joinMatch[2];
        const onClause = joinMatch[3];

        const condRegex = /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/gi;
        let condMatch;
        while ((condMatch = condRegex.exec(onClause)) !== null) {
          joinConditions.push({
            leftTable: condMatch[1],
            leftField: condMatch[2],
            rightTable: condMatch[3],
            rightField: condMatch[4]
          });
        }
      }

      // ۳. استخراج GROUP BY
      const groupRegex = /GROUP\s+BY\s+([\s\S]*?)(?:ORDER\s+BY|$)/i;
      const groupMatch = sql.match(groupRegex);
      const groupBy = groupMatch
        ? groupMatch[1].split(',').map(f => f.trim().replace(/^(\w+)\./, ''))
        : [];

      // ۴. استخراج ORDER BY
      const orderRegex = /ORDER\s+BY\s+([\s\S]*?)$/i;
      const orderMatch = sql.match(orderRegex);
      const orderBy = orderMatch
        ? orderMatch[1].split(',').map(f =>
            f.trim().replace(/^(\w+)\./, '').replace(/\s+(ASC|DESC)$/i, '')
          )
        : [];

      // ۵. استخراج SUM
      const sumRegex = /SUM\((\w+)\.(\w+)\)\s+AS\s+(\w+)/gi;
      const sumFields = [];
      let sumMatch;
      while ((sumMatch = sumRegex.exec(sql)) !== null) {
        sumFields.push({
          table: sumMatch[1],
          field: sumMatch[2],
          alias: sumMatch[3]
        });
      }

      // ۶. استخراج CONCAT
      // 🔧 اصلاح باگ: فیلتر باید روی مقدار خام (قبل از حذف کوتیشن) انجام شود.
      const concatRegex = /CONCAT\(([\s\S]*?)\)\s+AS\s+(\w+)/gi;
      const concatFields = [];
      let concatMatch;
      while ((concatMatch = concatRegex.exec(sql)) !== null) {
        const rawParts = concatMatch[1].split(',').map(p => p.trim());
        const cleanParts = rawParts
          .filter(p => !/^['"]\s*-\s*['"]$/.test(p))   // حذف جداکننده‌های ثابت مثل ' - '
          .map(p => p.replace(/^(\w+)\./, '').replace(/['"]/g, ''));
        concatFields.push({
          alias: concatMatch[2],
          parts: cleanParts
        });
      }

      // ۷. استخراج CASE WHEN (الگوی هوشمند حسابداری)
      // 🔧 حذف caseRegex تکراری: منطق هوشمند زیر کافی است.
      const caseFields = [];

      if (/MandehBedehkar/i.test(sql)) {
        const debitSum = sumFields.find(f => /bedehkar/i.test(f.field))?.alias || 'GardeshBedehkar';
        const creditSum = sumFields.find(f => /bestankar/i.test(f.field))?.alias || 'GardeshBestankar';
        caseFields.push({
          alias: 'MandehBedehkar',
          expression: {
            type: 'debit_balance',
            field1Alias: debitSum,
            field2Alias: creditSum
          }
        });
      }

      if (/MandehBestankar/i.test(sql)) {
        const debitSum = sumFields.find(f => /bedehkar/i.test(f.field))?.alias || 'GardeshBedehkar';
        const creditSum = sumFields.find(f => /bestankar/i.test(f.field))?.alias || 'GardeshBestankar';
        caseFields.push({
          alias: 'MandehBestankar',
          expression: {
            type: 'credit_balance',
            field1Alias: creditSum,
            field2Alias: debitSum
          }
        });
      }

      // ۸. استخراج فیلدهای ثابت (مثل '1400' AS EsmSherkat)
      const constRegex = /'([^']+)'\s+AS\s+(\w+)/gi;
      const constantFields = [];
      let constMatch;
      while ((constMatch = constRegex.exec(sql)) !== null) {
        constantFields.push({
          value: constMatch[1],
          alias: constMatch[2]
        });
      }

      return {
        mainTable: { name: mainTableName, alias: mainAlias },
        joinTable: joinTableName ? { name: joinTableName, alias: joinAlias } : null,
        joinConditions,
        groupBy,
        orderBy,
        sumFields,
        concatFields,
        caseFields,
        constantFields
      };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * استخراج اطلاعات جداول (نام، family، companyCode، fiscalYear)
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * @private
     */
    _extractTableInfo(parsed) {
      const mainName = parsed.mainTable.name;
      const joinName = parsed.joinTable?.name;

      const sanadMatch = mainName.match(/Sanad_(\d+)_(\d+)/i);
      const codingMatch = mainName.match(/Coding_(\d+)/i);

      let mainTable, joinTable, companyCode, fiscalYear;

      if (sanadMatch) {
        fiscalYear = parseInt(sanadMatch[1], 10);
        companyCode = sanadMatch[2];
        mainTable = { name: mainName, family: 'sanad', alias: parsed.mainTable.alias };
        joinTable = joinName
          ? { name: joinName, family: 'coding', alias: parsed.joinTable.alias }
          : null;
      } else if (codingMatch) {
        companyCode = codingMatch[1];
        mainTable = { name: mainName, family: 'coding', alias: parsed.mainTable.alias };
        joinTable = null;
      } else {
        throw new Error(`نام جدول اصلی شناسایی نشد: ${mainName}. باید فرمت Sanad_YYYY_CODE یا Coding_CODE داشته باشد.`);
      }

      return { mainTable, joinTable, companyCode, fiscalYear };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * ارزیابی عبارت CASE WHEN (مخصوص الگوهای حسابداری)
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * @private
     */
    _evaluateCaseExpression(caseField, row) {
      if (!caseField || !caseField.expression) {
        return 0;
      }

      const { type, field1Alias, field2Alias } = caseField.expression;
      const val1 = Number(row[field1Alias]) || 0;
      const val2 = Number(row[field2Alias]) || 0;

      if (type === 'debit_balance') {
        return (val1 - val2) > 0 ? (val1 - val2) : 0;
      }

      if (type === 'credit_balance') {
        return (val2 - val1) > 0 ? (val2 - val1) : 0;
      }

      return 0;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * اعتبارسنجی پارامترهای ورودی
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * @private
     */
    _validateParams(params) {
      if (!params || typeof params !== 'object') {
        throw new Error('پارامترهای ورودی باید یک آبجکت باشد.');
      }

      if (!params.reportType || typeof params.reportType !== 'string') {
        throw new Error('reportType (نوع گزارش) اجباری است و باید رشته باشد.');
      }

      if (!params.companyCode || typeof params.companyCode !== 'string') {
        throw new Error('companyCode (کد شرکت) اجباری است و باید رشته باشد.');
      }

      if (!params.fiscalYear || typeof params.fiscalYear !== 'number') {
        throw new Error('fiscalYear (سال مالی) اجباری است و باید عدد باشد.');
      }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * نمایش آمار عملکرد در کنسول
     * ═══════════════════════════════════════════════════════════════════════
     * 
     * @private
     */
    _logPerformance(metrics) {
      const log = this.options.logger.log;
      log('📊 ─────────── گزارش عملکرد ───────────');
      log(`📋 نوع: ${metrics.reportType}`);
      log(`🏢 شرکت: ${metrics.companyCode} | 📅 سال: ${metrics.fiscalYear}`);
      log(`📦 ردیف‌های نتیجه: ${metrics.resultCount}`);

      if (metrics.phases) {
        log('⏱️ فازها:');
        for (const [name, phase] of Object.entries(metrics.phases)) {
          const detail = phase.rowCount !== undefined ? ` | ${phase.rowCount} ردیف`
            : phase.indexSize !== undefined ? ` | ${phase.indexSize} ایندکس`
            : phase.uniqueGroups !== undefined ? ` | ${phase.uniqueGroups} گروه`
            : phase.resultCount !== undefined ? ` | ${phase.resultCount} نتیجه`
            : '';
          log(`   • ${name}: ${phase.durationMs.toFixed(1)}ms${detail}`);
        }
      }

      log(`⚡ مجموع: ${metrics.totalTimeMs.toFixed(1)}ms`);
      log('─────────────────────────────────────');
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * دریافت آمار آخرین اجرا
     * ═══════════════════════════════════════════════════════════════════════
     */
    getMetrics() {
      return this.lastMetrics;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * پاکسازی منابع
     * ═══════════════════════════════════════════════════════════════════════
     */
    destroy() {
      this.lastMetrics = null;

      if (!this.options.dbManager) {
        this.dbManager.closeAll();
      }

      this.options.logger.log('🗑️ BinaReportEngine پاکسازی شد.');
    }
  }

  global.BinaReportEngine = BinaReportEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BinaReportEngine;
  }

})(typeof window !== 'undefined' ? window : globalThis);