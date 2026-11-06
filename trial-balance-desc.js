window.BinaPages = window.BinaPages || {};

window.BinaPages['trial-balance'] = {
    family: 'Sanad',
    params: ['company', 'year'],
    id: 'id', // کلید یکتای ترکیبی ساخته شده در SQL
    labels: {
        company: 'شرکت',
        year: 'سال مالی',
        search: 'محاسبه تراز',
        rows: 'حساب'
    },
    sql: `
        SELECT 
            CONCAT(code_sherkat, '_', SalMali, '_', kol_code, '_', moien_code, '_', tafsil_code) AS id,
            code_sherkat, 
            SalMali, 
            CONCAT(kol_code, ' - ', moien_code, ' - ', tafsil_code) AS 'کد حساب', 
            kol_code, 
            moien_code, 
            tafsil_code,
            SUM(bedehkar) AS gardesh_bedehkar, 
            SUM(bestankar) AS gardesh_bestankar,
            CASE 
                WHEN SUM(bedehkar - bestankar) > 0 
                THEN SUM(bedehkar - bestankar) 
                ELSE 0 
            END AS mandeh_bedehkar,
            CASE 
                WHEN SUM(bestankar - bedehkar) > 0 
                THEN SUM(bestankar - bedehkar) 
                ELSE 0 
            END AS mandeh_bestankar
        FROM Sanad_{year}_{company}
        GROUP BY code_sherkat, SalMali, kol_code, moien_code, tafsil_code
        ORDER BY kol_code, moien_code, tafsil_code;
    `,
    gridOptions: {
        columns: [
            { title: "کد حساب", field: "CodeHesab", width: 190 },
            { title: "کل", field: "kol_code", width: 80 },
            { title: "معین", field: "moien_code", width: 90 },
            { title: "تفصیلی", field: "tafsil_code", width: 110 },
            { title: "گردش بدهکار", field: "gardesh_bedehkar", width: 140, formatter: "money" },
            { title: "گردش بستانکار", field: "gardesh_bestankar", width: 140, formatter: "money" },
            { title: "مانده بدهکار", field: "mandeh_bedehkar", width: 140, formatter: "money" },
            { title: "مانده بستانکار", field: "mandeh_bestankar", width: 140, formatter: "money" }
        ]
    }
};