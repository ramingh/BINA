// Run with: node test-composite-join.cjs (optional developer test)
const assert = require('node:assert/strict');
const {Parser,runSelect} = require('./bina-query.js');
const sql=`SELECT S.ID,C.Tafsil_Onvan FROM Sanad_1395_1300 S INNER JOIN Coding_1300 C ON S.Kol_Code=C.Kol_Code AND S.Moien_Code=C.Moien_Code AND S.Tafsil_Code=C.Tafsil_Code ORDER BY S.ID`;
const ss=Array.from({length:5000},(_,i)=>({ID:i+1,Kol_Code:1,Moien_Code:2,Tafsil_Code:i+1}));
const cc=Array.from({length:5000},(_,i)=>({ID:i+1,Kol_Code:'1',Moien_Code:'2',Tafsil_Code:String(i+1),Tafsil_Onvan:'MATCH'}));
const mk=()=>new Map([['s',{table:'Sanad_1395_1300',rows:ss}],['c',{table:'Coding_1300',rows:cc}]]);
assert.equal(runSelect(new Parser(sql).parse(),mk(),150000).total,5000);
assert.throws(()=>runSelect(new Parser(sql.replace('S.Moien_Code','S.WrongField')).parse(),mk(),150000),/WrongField/);
console.log('OK: 5000-row composite JOIN, numeric/string equality, typo detection');
