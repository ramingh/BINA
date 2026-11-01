const assert=require('node:assert/strict');
global.window=globalThis;
global.document={baseURI:'http://127.0.0.1:5500/'};
const requested=[];
global.fetch=async u=>{
 const url=new URL(u);requested.push(url.href);
 const mode=url.searchParams.get('mode');
 if(mode==='stats')return {ok:true,json:async()=>({count:3,columns:[{name:'ID',type:'int'},{name:'amount',type:'float'}],idIndex:0})};
 if(mode==='data'){
  const after=Number(url.searchParams.get('lastId'));
  const data=[[1,10],[2,20],[3,30]].filter(x=>x[0]>after);
  return {ok:true,json:async()=>data};
 }
 return {ok:true,json:async()=>[]};
};
require('../manager/bina-db-manager.js');
const idx=new Index_db({webservice:{fetchTable:async function*(){}}});
assert.equal(idx._tableInfo('Sanad_1395_1000').table,'sanad_1395_1000');
assert.equal(idx._tableInfo('CODING_1000').table,'coding_1000');
(async()=>{
 const ws=new webservice({endpoint:'http://example.invalid/service.ashx'});
 let results=[];
 for await(const pack of ws.fetchTable({table:'Sanad_1395_1000',afterId:2,batchSize:15000}))results.push(...pack.rows);
 assert.deepEqual(results,[[3,30]]);
 assert(requested.some(x=>x.includes('lastId=2')));
 assert.equal(idx.batchSize,15000);
 console.log('PASS lower-case table names, resume lastId, default batch 15000');
})().catch(e=>{console.error(e);process.exitCode=1});
