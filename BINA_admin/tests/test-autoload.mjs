import { createRequire } from 'module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {BinaQuery}=require('./bina-query.js');
const q=new BinaQuery();
let loads=0;
q.listTables=async()=>[
  {table:'Sanad_1395_1500',received:50000,available:true},
  {table:'Coding_1500',received:100,available:true}
];
q.loadTable=async({table,maxRows,allowPartial})=>{
  loads++;
  assert.equal(maxRows,5000);
  assert.equal(allowPartial,true);
  const rows=table.toLowerCase().startsWith('sanad')
    ?[{ID:1,codetm:100,bedm:20},{ID:2,codetm:200,bedm:50}]
    :[{ID:11,codetm:100,name:'ABC'},{ID:22,codetm:200,name:'DEF'}];
  q.loaded.set(table.toLowerCase(),{table,rows,known:50000,partial:true});
  return {table,rows:rows.length,known:50000,partial:true};
};
let res=await q.ensureTablesForSQL({sql:'SELECT * FROM Sanad_1395_1500;',maxRows:5000,allowPartial:true});
assert.equal(loads,1);assert.equal(res.loaded.length,1);
assert.equal(q.query({sql:'SELECT * FROM Sanad_1395_1500 LIMIT 20;'}).rows.length,2);
res=await q.ensureTablesForSQL({sql:'SELECT s.ID, c.name FROM Sanad_1395_1500 s INNER JOIN Coding_1500 c ON s.codetm = c.codetm',maxRows:5000,allowPartial:true});
assert.equal(loads,2);assert.equal(res.reused.length,1);
assert.equal(q.query({sql:'SELECT s.ID,c.name FROM Sanad_1395_1500 s INNER JOIN Coding_1500 c ON s.codetm=c.codetm'}).rows.length,2);
res=await q.ensureTablesForSQL({sql:'SELECT * FROM sanad_1395_1500',maxRows:5000,allowPartial:true});
assert.equal(loads,2);assert.equal(res.reused.length,1);
try{await q.ensureTablesForSQL({sql:'SELECT * FROM Sanad_1395_9999',maxRows:5000});assert.fail('Expected absent table error');}
catch(e){assert.match(e.message,/Public\.Catalog/);}
console.log('AUTO LOAD TESTS PASSED');
