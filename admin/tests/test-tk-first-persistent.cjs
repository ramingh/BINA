/* تست بدون وابستگی: ترتیب اجباری دریافت داده پایه و ماندگاری مرورگر */
const assert=require('node:assert/strict');
global.window=globalThis;global.document={baseURI:'http://localhost/'};
require('../manager/bina-db-manager.js');
const sources=[
 {table:'sanad_1395_1300',count:2},
 {table:'tk_Extra',count:1},
 {table:'tk_dic_FieldName',count:2},
 {table:'tk_esmsherkatholding',count:1},
 {table:'coding_1300',count:2}
];
(async()=>{
 const order=[];
 const ws={fetchTable:async function*(){},
  listTableNames:async()=>{order.push('list');return sources},
  discoverTables:async()=>{order.push('discover-stats');return sources.map(x=>({key:x.table,value:{count:x.count,columns:[]}}))}
 };
 const manager=new BinaDBManager({webservice:ws});
 manager.initialize=async()=>({});
 manager.getservertables=async()=>[];
 manager._ensureTKStores=async()=>order.push('create-tk-stores');
 manager._fetchTK=async(store,table,count)=>{order.push('tk-data:'+table);return count;};
 manager._saveservertables=async()=>order.push('save-tables');
 manager._updateSharedSchemas=async()=>order.push('save-shared-schema');
 const r=await manager.bootstrap();
 assert.equal(r.tkTables.length,3);
 assert.equal(r.tkdic,2);assert.equal(r.tkSherkat,1);
 assert.equal(order.filter(x=>x.startsWith('tk-data:')).length,3);
 assert(order.lastIndexOf('tk-data:tk_Extra') < order.indexOf('discover-stats'),'TK باید قبل از stats سند تمام شده باشد');
 assert(!order.some(x=>x.startsWith('sync:')));
 // اگر TK ناقص/خطادار باشد، دریافت سند متوقف می‌شود.
 const failed=new BinaDBManager({webservice:ws});
 failed.initialize=async()=>{};failed.getservertables=async()=>[];
 failed._ensureTKStores=async()=>{};
 failed._fetchTK=async()=>{throw Error('TK incomplete')};
 failed._syncOne=async()=>{throw Error('FATAL: started sanad before TK')};
 await assert.rejects(()=>failed.syncTables(['sanad_1395_1300']),/TK incomplete/);
 // متد ماندگاری: پذیرش باید با persisted() تأیید شود و درخواست خودکار فقط یک بار باشد.
 let calls=0;let persisted=false;
 Object.defineProperty(global,'navigator',{configurable:true,value:{storage:{
  persisted:async()=>persisted,
  persist:async()=>{calls++;persisted=true;return true},
  estimate:async()=>({usage:1048576,quota:104857600})
 }}});
 const p=new BinaDBManager({webservice:ws});
 assert.equal(await p._requestPersistence(),true);
 assert.equal(await p._requestPersistence(),true);
 assert.equal(calls,1);
 const state=await p.requestPersistence();
 assert.equal(state.persisted,true);assert.equal(state.usageMB,'1.00');
 console.log('PASS TK FIRST, block on TK failure, persistent storage verified, no repeated permission requests');
})().catch(e=>{console.error(e);process.exitCode=1});
