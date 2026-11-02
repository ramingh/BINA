-- BINA SQL — نمونه‌ها
-- توجه: اینها را جداگانه اجرا کنید؛ موتور فعلی فقط یک عبارت در هر بار اجرا می‌پذیرد.
SELECT * FROM sanad_1395_1300 LIMIT 20;
SELECT s.ID, s.Bedehkar, c.Tafsil_Onvan
FROM sanad_1395_1300 s
INNER JOIN coding_1300 c
  ON s.Kol_Code=c.Kol_Code
 AND s.Moien_Code=c.Moien_Code
 AND s.Tafsil_Code=c.Tafsil_Code
ORDER BY s.ID LIMIT 100;
SELECT Tafsil_Code, COUNT(*) AS N, SUM(Bedehkar) AS Jam
FROM sanad_1395_1300
GROUP BY Tafsil_Code HAVING COUNT(*) > 1
ORDER BY Jam DESC LIMIT 100;
SELECT a.ID, a.Bedehkar,
 SUM(COALESCE(a.Bedehkar,0)) OVER (
   ORDER BY a.ID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
 ) AS JamBed
FROM sanad_1395_1300 a ORDER BY a.ID LIMIT 100;
SELECT ID, CASE WHEN Bedehkar>0 THEN 'debit' ELSE 'other' END AS status
FROM sanad_1395_1300 LIMIT 100;
SELECT ID FROM sanad_1395_1300 WHERE ID<10
UNION
SELECT ID FROM sanad_1395_1300 WHERE ID>100 LIMIT 10;
-- فضای کاری موقت (هر خط جداگانه اجرا شود)
CREATE TABLE tmp_example (id INTEGER, amount REAL);
INSERT INTO tmp_example(id,amount) VALUES(1,20),(2,50);
UPDATE tmp_example SET amount=30 WHERE id=1;
SELECT SUM(amount) AS total FROM tmp_example;
DELETE FROM tmp_example WHERE id=2;
DROP TABLE tmp_example;
