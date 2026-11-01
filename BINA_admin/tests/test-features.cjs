const assert=require('node:assert/strict');
const {BinaQuery}=require('../sql/bina-query.js');
const q=new BinaQuery();
q.loaded.set('sanad_1395_1300',{table:'sanad_1395_1300',rows:[
 {ID:1,Kol_Code:1,Moien_Code:2,Tafsil_Code:3,Bedehkar:100},
 {ID:2,Kol_Code:1,Moien_Code:2,Tafsil_Code:4,Bedehkar:150}],known:2,partial:false});
q.loaded.set('coding_1300',{table:'coding_1300',rows:[
 {ID:11,Kol_Code:'1',Moien_Code:'2',Tafsil_Code:'3',Tafsil_Onvan:'A'},
 {ID:12,Kol_Code:'1',Moien_Code:'2',Tafsil_Code:'4',Tafsil_Onvan:'B'}],known:2,partial:false});
const join=q.query({sql:'SELECT s.ID, c.Tafsil_Onvan FROM sanad_1395_1300 s INNER JOIN coding_1300 c ON s.Kol_Code=c.Kol_Code AND s.Moien_Code=c.Moien_Code AND s.Tafsil_Code=c.Tafsil_Code ORDER BY s.ID'});
assert.deepEqual(join.rows.map(r=>r.Tafsil_Onvan),['A','B']);
assert.equal(q.query({sql:'SELECT SUM(Bedehkar) AS Jam FROM sanad_1395_1300'}).rows[0].Jam,250);
assert.deepEqual(q.query({sql:'SELECT CASE WHEN ID=1 THEN 10 ELSE 20 END AS Label FROM sanad_1395_1300 ORDER BY ID'}).rows.map(x=>x.Label),[10,20]);
assert.equal(q.query({sql:'SELECT ID FROM sanad_1395_1300 WHERE ID>0 UNION SELECT ID FROM sanad_1395_1300 WHERE ID=1'}).rows.length,2);
q.query({sql:'DECLARE @limit INT = 1'});
assert.equal(q.query({sql:'SELECT ID FROM sanad_1395_1300 WHERE ID=@limit'}).rows[0].ID,1);
q.query({sql:'CREATE TABLE tmp_sums (id INTEGER, amount REAL)'});
q.query({sql:'INSERT INTO tmp_sums (id,amount) VALUES(1,5),(2,10)'});
q.query({sql:'UPDATE tmp_sums SET amount=7 WHERE id=1'});
assert.equal(q.query({sql:'SELECT SUM(amount) AS Jam FROM tmp_sums'}).rows[0].Jam,17);
q.query({sql:'DELETE FROM tmp_sums WHERE id=2'});
assert.equal(q.query({sql:'SELECT COUNT(*) AS N FROM tmp_sums'}).rows[0].N,1);
console.log('PASS SQL composite JOIN, CASE, UNION, variables and in-memory CRUD');
