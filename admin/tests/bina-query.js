/*
 * BINA Query — v3.3 — standalone, pure JavaScript, MIT-style example.
 * No SQLite, WASM, CDN, installation, WebService or write to source IndexedDB.
 *
 * Public API:
 *   new BinaQuery({maxRowsPerTable, maxTotalRows, maxJoinRows, onProgress})
 *   await listTables()
 *   await getSchema({table})
 *   await loadTable({table,maxRows,allowPartial})
 *   await ensureTablesForSQL({sql,maxRows,allowPartial})  // auto-detect FROM and JOIN
 *   query({sql,maxResultRows})
 *   listLoaded(), unloadTable(name), clear(), stop(), storageEstimate()
 *
 * Supported SELECT subset: INNER/LEFT JOIN, WHERE, GROUP BY, HAVING,
 * ORDER BY, LIMIT/OFFSET, DISTINCT, COUNT/SUM/AVG/MIN/MAX, arithmetic,
 * AND/OR/NOT, LIKE, IN, BETWEEN, IS NULL, COALESCE, ROUND, ABS.
 * Not full SQL. All computation runs over explicitly loaded sample rows.
 * No mutation queries, no CTE, no UNION. Supports running SUM() OVER.
 */
(function (root) {
  'use strict';
  const PUBLIC = 'public', MAX_ID = Number.MAX_SAFE_INTEGER;
  const sleep = () => new Promise(ok => setTimeout(ok, 0));
  const decoder = new TextDecoder();
  const reqValue = req => new Promise((ok, bad) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => bad(req.error || Error('IndexedDB request failed'));
  });
  const canonical = name => String(name??'').trim().toLowerCase();
  function storeName(db, desired) {
    return Array.from(db.objectStoreNames).find(x=>canonical(x)===canonical(desired)) || desired;
  }
  async function publicName(){
    if (typeof indexedDB.databases !== 'function') return 'Public';
    const dbs=await indexedDB.databases();
    const names=dbs.map(x=>x.name);
    return names.includes('Public')?'Public':names.includes('public')?'public':'public';
  }
  async function openExisting(name, requiredStore) {
    if(canonical(name)==='public') name=await publicName();
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      if (!dbs.some(x => x.name === name)) throw Error(`IndexedDB «${name}» در این Origin وجود ندارد.`);
    }
    return new Promise((ok, bad) => {
      const r = indexedDB.open(name); // open at existing version, never hardcode a version
      r.onupgradeneeded = () => r.transaction.abort(); // never create an absent source
      r.onerror = () => bad(r.error || Error(`IndexedDB «${name}» باز نشد.`));
      r.onblocked = () => bad(Error(`IndexedDB «${name}» در تب دیگری قفل است.`));
      r.onsuccess = () => {
        const db = r.result;
        if (requiredStore && !Array.from(db.objectStoreNames).some(x=>canonical(x)===canonical(requiredStore))) {
          db.close(); bad(Error(`Object Store «${requiredStore}» در دیتابیس «${name}» موجود نیست.`)); return;
        }
        db.onversionchange = () => db.close();
        ok(db);
      };
    });
  }
  function get(db, store, key) {
    return reqValue(db.transaction(storeName(db,store), 'readonly').objectStore(storeName(db,store)).get(key));
  }
  function getAll(db, store) {
    return reqValue(db.transaction(storeName(db,store), 'readonly').objectStore(storeName(db,store)).getAll());
  }
  function tkStoreName(table){
    return /sherkat/i.test(table)?'tk_sherkat':'tk_dic';
  }
  function parseBinaName(name) {
    const n = canonical(name);
    let m = /^coding_(\d+)$/i.exec(n);
    if (m) return {table:n, family:'coding', company:m[1], year:null};
    m = /^sanad_(\d{4})_(\d+)$/i.exec(n);
    if (m) return {table:n, family:'sanad', company:m[2], year:Number(m[1])};
    if (/^tk_/i.test(n)) return {table:n,family:'tk',company:null,year:null};
    throw Error(`نام جدول «${n}» مطابق نام‌گذاری BINA نیست.`);
  }
  function sourceRange(info, after) {
    if (info.family === 'tk') {
      const prefix = 'TK:'+info.table+':';
      return IDBKeyRange.bound(after === null ? prefix : after, prefix+'\uffff', after !== null, false);
    }
    const prefix = info.family === 'coding' ? [info.company] : [info.year,info.company];
    const from = after === null ? [...prefix,0] : after;
    return IDBKeyRange.bound(from, [...prefix,MAX_ID], after !== null, false);
  }
  function entriesChunk(db, storeName, range, cap = 50) {
    return new Promise((ok,bad) => {
      const out = []; let last = null, settled = false;
      const real = Array.from(db.objectStoreNames).find(x=>canonical(x)===canonical(storeName))||storeName;
      const tx = db.transaction(real, 'readonly');
      const req = tx.objectStore(real).openCursor(range);
      const fail = e => {if(!settled){settled=true;bad(e);}};
      tx.onabort = () => fail(tx.error || Error('Cursor transaction aborted'));
      req.onerror = () => fail(req.error || Error('IndexedDB cursor failed'));
      req.onsuccess = () => {
        if(settled) return;
        const cur = req.result;
        if (!cur) {settled=true;ok({entries:out,last});return;}
        out.push({key:cur.key,value:cur.value});last=cur.key;
        if(out.length>=cap) {settled=true;ok({entries:out,last});return;}
        cur.continue();
      };
    });
  }
  async function gunzip(blob) {
    if (typeof DecompressionStream === 'undefined') throw Error('Chrome جدید با پشتیبانی DecompressionStream لازم است.');
    const bytes = blob instanceof ArrayBuffer ? new Uint8Array(blob) : blob;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(decoder.decode(await new Response(stream).arrayBuffer()));
  }
  function infoFromValue(table, value, catalog) {
    const info = parseBinaName(table);
    return {table, family:info.family, company:info.company, year:info.year,
      received:Number(catalog?.received)||0, finished:!!catalog?.finished,
      storageMode:catalog?.storageMode||'unknown',available:!!catalog&&Number(catalog.received)>0};
  }
  function toObject(id, vals, schema, info) {
    if (!Array.isArray(vals) || vals.length !== schema.columns.length-1)
      throw Error(`${info.table}: تعداد مقادیر رکورد با Schema سازگار نیست.`);
    const row={}; let j=0;
    schema.columns.forEach((c,i)=>{row[c.name]=i===schema.idIndex?id:vals[j++];});
    if (info.company !== null && !Object.hasOwn(row,'__CompanyCode')) row.__CompanyCode=info.company;
    if (info.family==='sanad' && !Object.hasOwn(row,'__FiscalYear')) row.__FiscalYear=info.year;
    return row;
  }

  // SQL tokenizer: quotations, escapes, comments, numbers and operators.
  function lex(sql) {
    const out=[];let i=0;
    while (i<sql.length) {
      const ch=sql[i];
      if(ch==='@') {
        const m=/^@[a-zA-Z_]\w*/.exec(sql.slice(i));
        if(!m)throw Error('متغیر SQL نامعتبر است.');
        out.push({kind:'var',value:m[0].slice(1)});i+=m[0].length;continue;
      }
      if (/\s/.test(ch)) {i++;continue;}
      if (sql.slice(i,i+2)==='--') {while(i<sql.length&&sql[i]!=='\n')i++;continue;}
      if (sql.slice(i,i+2)==='/*') {const j=sql.indexOf('*/',i+2);if(j<0)throw Error('کامنت SQL بسته نشده است.');i=j+2;continue;}
      if (ch==='\'' || ch==='"' || ch==='`' || ch==='[') {
        const end=ch==='['?']':ch, kind=ch==='\''?'str':'id'; let value='';i++;
        let closed=false;
        while(i<sql.length){
          if(sql[i]===end){if(ch!=='['&&sql[i+1]===end){value+=end;i+=2;continue;}i++;closed=true;break;}
          value+=sql[i++];
        }
        if(!closed) throw Error('رشته یا نام ستون بسته نشده است.');
        out.push({kind,value});continue;
      }
      const num= /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?/.exec(sql.slice(i));
      if(num){out.push({kind:'num',value:Number(num[0])});i+=num[0].length;continue;}
      const id=/^[\p{L}_][\p{L}\p{N}_$]*/u.exec(sql.slice(i));
      if(id){out.push({kind:'id',value:id[0]});i+=id[0].length;continue;}
      const op=sql.slice(i,i+2);
      if(['>=','<=','!=','<>','||'].includes(op)){out.push({kind:'op',value:op});i+=2;continue;}
      if('(),.*;+-/%=<>'.includes(ch)){out.push({kind:'op',value:ch});i++;continue;}
      throw Error('نشانه ناشناخته SQL: '+ch);
    }
    out.push({kind:'eof',value:'EOF'});return out;
  }
  const RESERVED=new Set(('CASE WHEN THEN ELSE END UNION ALL CREATE TABLE INSERT INTO VALUES UPDATE SET DELETE DROP SELECT DISTINCT FROM WHERE INNER LEFT RIGHT FULL JOIN ON AS GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET AND OR NOT NULL IS LIKE IN BETWEEN TRUE FALSE COUNT SUM MIN MAX AVG OVER PARTITION ROWS RANGE UNBOUNDED PRECEDING CURRENT ROW').split(' '));
  class Parser {
    constructor(sql,vars=new Map()){this.t=lex(sql);this.i=0;this.vars=vars;}
    cur(){return this.t[this.i];}
    upper(){return String(this.cur().value).toUpperCase();}
    match(v){if(this.upper()===v.toUpperCase()){this.i++;return true;}return false;}
    expect(v){if(!this.match(v))throw Error(`در SQL انتظار «${v}» بود؛ «${this.cur().value}» دیده شد.`);}
    ident(){const x=this.cur();if(x.kind!=='id')throw Error('نام جدول یا ستون مورد انتظار است: '+x.value);this.i++;return String(x.value);}
    parse(){
      const parts=[this.selectStatement()], all=[];
      while(this.match('UNION')) {all.push(this.match('ALL'));parts.push(this.selectStatement());}
      this.match(';');
      if(this.cur().kind!=='eof')throw Error('بخش SQL پشتیبانی نمی‌شود: '+this.cur().value);
      return parts.length===1?parts[0]:{kind:'union',parts,all};
    }
    selectStatement(){
      this.expect('SELECT');const distinct=this.match('DISTINCT');
      const items=this.itemList();this.expect('FROM');const from=this.table();const joins=[];
      while(['INNER','LEFT','JOIN'].includes(this.upper())){
        const type=this.match('LEFT')?'left':(this.match('INNER')?'inner':'inner');
        this.expect('JOIN');const table=this.table();this.expect('ON');
        joins.push({type,table,on:this.expression(0)});
      }
      const where=this.match('WHERE')?this.expression(0):null;
      const groupBy=this.match('GROUP')?(this.expect('BY'),this.expressions()):[];
      const having=this.match('HAVING')?this.expression(0):null;
      const orderBy=[];
      if(this.match('ORDER')){this.expect('BY');do{const expr=this.expression(0);const desc=this.match('DESC');if(!desc)this.match('ASC');orderBy.push({expr,desc});}while(this.match(','));}
      let limit=null,offset=0;
      if(this.match('LIMIT')){limit=this.positiveNumber();if(this.match('OFFSET'))offset=this.positiveNumber();}
      if(limit===null&&this.match('OFFSET')) offset=this.positiveNumber();
      return {distinct,items,from,joins,where,groupBy,having,orderBy,limit,offset};
    }
    positiveNumber(){const t=this.cur();if(t.kind!=='num'||!Number.isSafeInteger(t.value)||t.value<0)throw Error('عدد غیرمنفی لازم است.');this.i++;return t.value;}
    table(){const n=this.ident();let alias=n;if(this.match('AS'))alias=this.ident();else if(this.cur().kind==='id'&&!RESERVED.has(this.upper()))alias=this.ident();return {name:n,alias};}
    expressions(){const x=[this.expression(0)];while(this.match(','))x.push(this.expression(0));return x;}
    itemList(){
      const items=[];do{
        let expr;
        if(this.match('*'))expr={kind:'star'};
        else if(this.cur().kind==='id'&&this.t[this.i+1]?.value==='.'&&this.t[this.i+2]?.value==='*'){
          const table=this.ident();this.expect('.');this.expect('*');expr={kind:'star',table};
        }else expr=this.expression(0);
        let alias=null;if(this.match('AS'))alias=this.ident();
        else if(this.cur().kind==='id'&&!RESERVED.has(this.upper()))alias=this.ident();
        items.push({expr,alias});
      }while(this.match(','));return items;
    }
    expression(min=0){
      let left=this.atom();
      while(true){
        const raw=this.upper();let op=raw;
        if(raw==='IS'){
          if(3<min)break;this.i++;const not=this.match('NOT');this.expect('NULL');left={kind:'isnull',item:left,not};continue;
        }
        if(raw==='NOT'&&['IN','LIKE','BETWEEN'].includes(String(this.t[this.i+1]?.value).toUpperCase())){
          if(3<min)break;this.i++;op='NOT '+this.upper();
        }
        const precedence=op==='OR'?1:op==='AND'?2:['=','<>','!=','<','>','<=','>=','LIKE','IN','BETWEEN','NOT LIKE','NOT IN','NOT BETWEEN'].includes(op)?3:['+','-','||'].includes(op)?4:['*','/','%'].includes(op)?5:-1;
        if(precedence<min||precedence<0)break;
        this.i++;
        if(op.endsWith('IN')){
          this.expect('(');const vals=[];if(!this.match(')')){do{vals.push(this.expression(0));}while(this.match(','));this.expect(')');}
          left={kind:'in',item:left,values:vals,not:op.startsWith('NOT')};continue;
        }
        if(op.endsWith('BETWEEN')){
          const start=this.expression(precedence+1);this.expect('AND');const end=this.expression(precedence+1);
          left={kind:'between',item:left,start,end,not:op.startsWith('NOT')};continue;
        }
        left={kind:'binary',op,left,right:this.expression(precedence+1)};
      }
      return left;
    }
    atom(){
      const t=this.cur(),u=this.upper();
      if(this.match('CASE')) {
        const branches=[];
        while(this.match('WHEN')) {
          const when=this.expression(0);this.expect('THEN');
          const then=this.expression(0);branches.push({when,then});
        }
        const otherwise=this.match('ELSE')?this.expression(0):{kind:'lit',value:null};
        this.expect('END');
        return {kind:'case',branches,otherwise};
      }
      if(this.match('NOT'))return {kind:'unary',op:'NOT',expr:this.expression(3)};
      if(this.match('-'))return {kind:'unary',op:'-',expr:this.expression(6)};
      if(this.match('+'))return {kind:'unary',op:'+',expr:this.expression(6)};
      if(this.match('(')){const expr=this.expression(0);this.expect(')');return expr;}
      if(t.kind==='var'){
        this.i++;const key=t.value.toLowerCase();
        if(!this.vars.has(key))throw Error('متغیر @'+t.value+' تعریف نشده است.');
        return {kind:'lit',value:this.vars.get(key)};
      }
      if(t.kind==='num'||t.kind==='str'){this.i++;return {kind:'lit',value:t.value};}
      if(this.match('NULL'))return {kind:'lit',value:null};
      if(this.match('TRUE'))return {kind:'lit',value:true};
      if(this.match('FALSE'))return {kind:'lit',value:false};
      if(t.kind==='id'){
        const name=this.ident();
        if(this.match('(')){
          const args=[];let distinct=false;
          if(!this.match(')')){
            distinct=this.match('DISTINCT');
            if(this.match('*'))args.push({kind:'star'});else{
              do{args.push(this.expression(0));}while(this.match(','));
            }
            this.expect(')');
          }
          // Window aggregate: SUM(expr) OVER (ORDER BY ID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
          // Optional PARTITION BY is supported. RANGE and other frames are intentionally rejected.
          let over=null;
          if(this.match('OVER')){
            this.expect('(');
            let partitionBy=[];
            if(this.match('PARTITION')){this.expect('BY');partitionBy=this.expressions();}
            this.expect('ORDER');this.expect('BY');
            const orderBy=[];
            do{const expr=this.expression(0);const desc=this.match('DESC');if(!desc)this.match('ASC');orderBy.push({expr,desc});}while(this.match(','));
            if(this.match('ROWS')){
              this.expect('BETWEEN');this.expect('UNBOUNDED');this.expect('PRECEDING');
              this.expect('AND');this.expect('CURRENT');this.expect('ROW');
            }
            this.expect(')');
            over={partitionBy,orderBy};
          }
          return {kind:'func',name:name.toUpperCase(),args,distinct,over};
        }
        if(this.match('.'))return {kind:'column',table:name,name:this.ident()};
        return {kind:'column',table:null,name};
      }
      throw Error(`عبارت SQL نامعتبر: ${u}`);
    }
  }
  function ciGet(obj,key){
    const target=String(key).toLowerCase();
    const k=Object.keys(obj).find(x=>x.toLowerCase()===target);
    return k===undefined?undefined:obj[k];
  }
  function cmp(a,b){
    if(a==null&&b==null)return 0;
    if(a==null)return -1;if(b==null)return 1;
    if(typeof a==='number'&&typeof b==='number')return a<b?-1:a>b?1:0;
    const x=String(a),y=String(b);return x<y?-1:x>y?1:0;
  }
  const truth = x => x!=null && x!==false && x!==0 && x!=='';
  function num(x){if(x==null||x==='')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
  function evalExpr(ast,context,group=null,output=null){
    if(!ast)return null;
    if(ast.kind==='lit')return ast.value;
    if(ast.kind==='case') {
      for(const branch of ast.branches)if(truth(evalExpr(branch.when,context,group,output)))
        return evalExpr(branch.then,context,group,output);
      return evalExpr(ast.otherwise,context,group,output);
    }
    if(ast.kind==='column'){
      if(!ast.table&&output){const v=ciGet(output,ast.name);if(v!==undefined)return v;}
      const aliases=Object.keys(context||{});
      if(ast.table){const alias=aliases.find(x=>x.toLowerCase()===ast.table.toLowerCase());
        if(!alias)throw Error(`نام جدول یا Alias «${ast.table}» یافت نشد.`);
        const r=context[alias];return r==null?null:ciGet(r,ast.name)??null;
      }
      let value;let matches=0;
      for(const alias of aliases){const row=context[alias];if(row==null)continue;
        const v=ciGet(row,ast.name);if(v!==undefined){value=v;matches++;}}
      if(matches>1)throw Error(`ستون «${ast.name}» در JOIN مبهم است؛ نام جدول را مشخص کنید.`);
      return matches?value:null;
    }
    if(ast.kind==='unary'){
      const x=evalExpr(ast.expr,context,group,output);
      return ast.op==='NOT'?!truth(x):ast.op==='-'?(num(x)==null?null:-num(x)):num(x);
    }
    if(ast.kind==='isnull')return (evalExpr(ast.item,context,group,output)==null)!==ast.not;
    if(ast.kind==='in'){
      const x=evalExpr(ast.item,context,group,output);
      const found=ast.values.some(v=>cmp(x,evalExpr(v,context,group,output))===0);
      return ast.not?!found:found;
    }
    if(ast.kind==='between'){
      const x=evalExpr(ast.item,context,group,output),a=evalExpr(ast.start,context,group,output),b=evalExpr(ast.end,context,group,output);
      const ok=x!=null&&a!=null&&b!=null&&cmp(x,a)>=0&&cmp(x,b)<=0;
      return ast.not?!ok:ok;
    }
    if(ast.kind==='binary'){
      if(ast.op==='AND')return truth(evalExpr(ast.left,context,group,output))&&truth(evalExpr(ast.right,context,group,output));
      if(ast.op==='OR')return truth(evalExpr(ast.left,context,group,output))||truth(evalExpr(ast.right,context,group,output));
      const a=evalExpr(ast.left,context,group,output),b=evalExpr(ast.right,context,group,output);
      switch(ast.op){
        case '=':return a!=null&&b!=null&&cmp(a,b)===0;
        case '!=':case '<>':return a!=null&&b!=null&&cmp(a,b)!==0;
        case '<':return a!=null&&b!=null&&cmp(a,b)<0;
        case '>':return a!=null&&b!=null&&cmp(a,b)>0;
        case '<=':return a!=null&&b!=null&&cmp(a,b)<=0;
        case '>=':return a!=null&&b!=null&&cmp(a,b)>=0;
        case '+':return num(a)==null||num(b)==null?null:num(a)+num(b);
        case '-':return num(a)==null||num(b)==null?null:num(a)-num(b);
        case '*':return num(a)==null||num(b)==null?null:num(a)*num(b);
        case '/':return num(a)==null||num(b)==null||num(b)===0?null:num(a)/num(b);
        case '%':return num(a)==null||num(b)==null||num(b)===0?null:num(a)%num(b);
        case '||':return String(a??'')+String(b??'');
        case 'LIKE':case 'NOT LIKE':{
          const pattern=String(b??'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');
          const ok=a!=null&&b!=null&&new RegExp('^'+pattern+'$','i').test(String(a));
          return ast.op==='LIKE'?ok:!ok;
        }
        default:throw Error('عملگر پیاده‌سازی نشده: '+ast.op);
      }
    }
    if(ast.kind==='func'){
      if(ast.over)throw Error('Window Function فقط در فهرست SELECT پشتیبانی می‌شود.');
      const name=ast.name;
      if(['COUNT','SUM','AVG','MIN','MAX'].includes(name)){
        if(!group)throw Error(`تابع تجمیعی ${name} فقط در SELECT گروهی قابل اجراست.`);
        let seq=group.map(ctx=>ast.args[0]?.kind==='star'?1:evalExpr(ast.args[0],ctx,null));
        if(ast.distinct)seq=Array.from(new Map(seq.map(v=>[JSON.stringify(v),v])).values());
        const valid=seq.filter(v=>v!=null);
        if(name==='COUNT')return ast.args[0]?.kind==='star'?seq.length:valid.length;
        if(name==='SUM'||name==='AVG'){
          const nums=valid.map(num).filter(x=>x!==null);
          if(!nums.length)return null;const sum=nums.reduce((a,b)=>a+b,0);
          return name==='SUM'?sum:sum/nums.length;
        }
        if(!valid.length)return null;
        return valid.reduce((a,b)=>cmp(a,b)*(name==='MIN'?1:-1)<=0?a:b);
      }
      const args=ast.args.map(a=>evalExpr(a,context,group,output));
      if(name==='COALESCE')return args.find(v=>v!=null)??null;
      if(name==='ROUND')return num(args[0])==null?null:Number(num(args[0]).toFixed(Math.max(0,Math.min(15,Number(args[1]??0)))));
      if(name==='ABS')return num(args[0])==null?null:Math.abs(num(args[0]));
      if(name==='LOWER')return args[0]==null?null:String(args[0]).toLowerCase();
      if(name==='UPPER')return args[0]==null?null:String(args[0]).toUpperCase();
      if(name==='LENGTH')return args[0]==null?null:String(args[0]).length;
      if(name==='IFNULL')return args[0]??args[1]??null;
      if(name==='IIF')return truth(args[0])?args[1]:args[2];
      throw Error(`تابع ${name} در نسخه JavaScript پشتیبانی نمی‌شود.`);
    }
    throw Error('عبارت SQL قابل محاسبه نیست: '+ast.kind);
  }
  function hasAgg(a){if(!a)return false;if(a.kind==='func'&&a.over)return false;
    if(a.kind==='func'&&['COUNT','SUM','AVG','MIN','MAX'].includes(a.name))return true;
    return Object.values(a).some(v=>Array.isArray(v)?v.some(hasAgg):typeof v==='object'&&v!==null&&hasAgg(v));}
  function nameOf(item,i){const e=item.expr;if(item.alias)return item.alias;
    if(e.kind==='column')return e.name;
    if(e.kind==='func')return e.name;
    if(e.kind==='star')return '*';return 'Expr'+(i+1);
  }
  function keyOf(value){return JSON.stringify(value,(_,v)=>v===undefined?null:v);}
  function makeProjection(items,ctx,group,aliases,windowValues=null){
    const out={};
    items.forEach((item,i)=>{
      const e=item.expr;
      if(e.kind==='star'){
        const list=e.table?[e.table]:aliases;
        for(const name of list){const alias=aliases.find(x=>x.toLowerCase()===name.toLowerCase());
          if(!alias)throw Error('Alias '+name+' ناشناخته است.');
          for(const [k,v] of Object.entries(ctx[alias]||{})) out[k]=v;
        }
      }else if(e.kind==='func'&&e.over){
        out[nameOf(item,i)]=windowValues?.get(e)?.get(ctx)??null;
      }else out[nameOf(item,i)]=evalExpr(e,ctx,group);
    });return out;
  }
  /**
   * Calculate running SUM in O(n log n) sorting + O(n) accumulation per window.
   * The Map uses context object identity, so ORDER BY of output can differ from
   * ORDER BY inside OVER without corrupting the cumulative value.
   * Only SUM(x) OVER ([PARTITION BY ...] ORDER BY ... ROWS UNBOUNDED...) is supported.
   */
  function computeRunningSum(func,contexts){
    if(func.name!=='SUM'||func.distinct||func.args.length!==1||func.args[0].kind==='star')
      throw Error('در این نسخه فقط SUM(expression) OVER پشتیبانی می‌شود.');
    const parts=new Map();
    for(const ctx of contexts){
      const key=keyOf(func.over.partitionBy.map(e=>evalExpr(e,ctx)));
      if(!parts.has(key))parts.set(key,[]);
      parts.get(key).push(ctx);
    }
    const values=new WeakMap();
    for(const group of parts.values()){
      // slice before sort: do not change the order of source data.
      const sorted=group.slice().sort((a,b)=>{
        for(const order of func.over.orderBy){
          const c=cmp(evalExpr(order.expr,a),evalExpr(order.expr,b));
          if(c)return order.desc?-c:c;
        }
        return 0;
      });
      let sum=0, nonNull=0;
      for(const ctx of sorted){
        const value=evalExpr(func.args[0],ctx);
        if(value!=null){
          const n=num(value);
          if(n===null)throw Error('مقدار غیرعددی در SUM OVER یافت شد.');
          sum+=n;nonNull++;
        }
        values.set(ctx,nonNull?sum:null);
      }
    }
    return values;
  }
  function findJoinEqui(ast,leftAliases,rightAlias){
    if(ast.kind!=='binary'||ast.op!=='=')return null;
    const a=ast.left,b=ast.right;
    if(a.kind!=='column'||b.kind!=='column'||!a.table||!b.table)return null;
    if(a.table.toLowerCase()===rightAlias.toLowerCase()&&leftAliases.some(x=>x.toLowerCase()===b.table.toLowerCase()))return {right:a,left:b};
    if(b.table.toLowerCase()===rightAlias.toLowerCase()&&leftAliases.some(x=>x.toLowerCase()===a.table.toLowerCase()))return {right:b,left:a};
    return null;
  }
  // Find ALL safe equality predicates inside AND branches of an ON condition.
  // Remaining ON conditions are still evaluated afterwards, preserving semantics.
  function findJoinEquis(ast,leftAliases,rightAlias){
    const equis=[];
    function walk(node){
      if(node?.kind==='binary' && node.op==='AND'){
        walk(node.left); walk(node.right); return;
      }
      const eq=node && findJoinEqui(node,leftAliases,rightAlias);
      if(eq)equis.push(eq);
    }
    walk(ast);
    return equis;
  }
  // Same equality semantics as cmp(): numeric 123 matches string '123', but not '00123'.
  function joinKey(values){
    if(values.some(v=>v==null))return null;
    return JSON.stringify(values.map(v=>String(v)));
  }
  // Fail explicitly on misspelled qualified JOIN columns instead of returning 0 rows.
  function checkJoinColumns(on,schemas){
    function check(node){
      if(!node || typeof node!=='object')return;
      if(Array.isArray(node)){node.forEach(check);return;}
      if(node.kind==='column'&&node.table){
        const info=[...schemas.entries()].find(([alias])=>alias.toLowerCase()===node.table.toLowerCase());
        if(info){
          const fields=info[1];
          if(!fields.has(node.name.toLowerCase()))
            throw Error(`ستون JOIN «${node.table}.${node.name}» در Schema جدول موجود نیست؛ نام واقعی فیلد را بررسی کنید.`);
        }
      }
      for(const [name,value] of Object.entries(node)){
        if(name==='table' || name==='name')continue;
        if(value && typeof value==='object')check(value);
      }
    }
    check(on);
  }
  function runSelect(ast,loaded,maxJoinRows){
    const resolveMeta=name=>{
      const table=Array.from(loaded.values()).find(v=>v.table.toLowerCase()===name.toLowerCase());
      if(!table)throw Error(`جدول «${name}» در فضای SQL بارگذاری نشده است.`);
      return table;
    };
    const resolve=name=>resolveMeta(name).rows;
    const knownColumns=name=>{
      const meta=resolveMeta(name);
      const fields=meta.schema?.columns?.map(c=>c.name) || Object.keys(meta.rows[0]||{});
      return new Set([...fields,'__CompanyCode','__FiscalYear'].map(x=>String(x).toLowerCase()));
    };
    const aliasSchemas=new Map([[ast.from.alias,knownColumns(ast.from.name)]]);
    const aliases=[ast.from.alias];
    let contexts=resolve(ast.from.name).map(r=>({[ast.from.alias]:r}));
    if(contexts.length>maxJoinRows)throw Error('تعداد رکوردهای ورودی از سقف ایمنی عبور کرده است.');
    for(const join of ast.joins){
      if(aliases.some(a=>a.toLowerCase()===join.table.alias.toLowerCase()))throw Error('Alias تکراری در JOIN.');
      const rightRows=resolve(join.table.name);
      aliasSchemas.set(join.table.alias,knownColumns(join.table.name));
      checkJoinColumns(join.on,aliasSchemas);
      const equis=findJoinEquis(join.on,aliases,join.table.alias);
      const next=[];
      if(equis.length){
        // Composite hash join: (Kol_Code, Moien_Code, Tafsil_Code) is ONE key.
        const map=new Map();
        for(const row of rightRows){
          const ctx={[join.table.alias]:row};
          const key=joinKey(equis.map(eq=>evalExpr(eq.right,ctx)));
          if(key===null)continue;
          if(!map.has(key))map.set(key,[]);
          map.get(key).push(row);
        }
        for(const ctx of contexts){
          const key=joinKey(equis.map(eq=>evalExpr(eq.left,ctx)));
          let matched=false;
          for(const row of (key===null?[]:map.get(key)||[])){
            const joined={...ctx,[join.table.alias]:row};
            if(truth(evalExpr(join.on,joined))){next.push(joined);matched=true;}
            if(next.length>maxJoinRows)throw Error('خروجی JOIN از سقف ایمنی فراتر رفت؛ نمونه کوچک‌تری انتخاب کنید.');
          }
          if(!matched&&join.type==='left')next.push({...ctx,[join.table.alias]:null});
        }
      }else{
        if(contexts.length*rightRows.length>maxJoinRows*3)throw Error('JOIN بدون شرط برابری ایندکس‌پذیر بسیار بزرگ است.');
        for(const ctx of contexts){let matched=false;
          for(const row of rightRows){const joined={...ctx,[join.table.alias]:row};
            if(truth(evalExpr(join.on,joined))){next.push(joined);matched=true;}
            if(next.length>maxJoinRows)throw Error('JOIN از سقف ایمنی فراتر رفت.');
          }
          if(!matched&&join.type==='left')next.push({...ctx,[join.table.alias]:null});
        }
      }
      contexts=next;aliases.push(join.table.alias);
    }
    if(ast.where)contexts=contexts.filter(ctx=>truth(evalExpr(ast.where,ctx)));
    const windows=ast.items.filter(it=>it.expr.kind==='func'&&it.expr.over).map(it=>it.expr);
    const aggregated=ast.groupBy.length||ast.items.some(it=>hasAgg(it.expr))||hasAgg(ast.having)||ast.orderBy.some(it=>hasAgg(it.expr));
    if(windows.length&&aggregated)
      throw Error('ترکیب SUM OVER با GROUP BY یا Aggregate معمولی در این نسخه پشتیبانی نمی‌شود.');
    // Compute on all filtered, loaded rows before SELECT ORDER BY or LIMIT.
    const windowValues=new Map(windows.map(e=>[e,computeRunningSum(e,contexts)]));
    let projected=[];
    if(aggregated){
      const groups=new Map();
      for(const ctx of contexts){const key=keyOf(ast.groupBy.map(expr=>evalExpr(expr,ctx)));
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(ctx);
      }
      if(!ast.groupBy.length&&!groups.size)groups.set('[]',[]); // SELECT COUNT(*) on empty input
      for(const group of groups.values()){
        const ctx=group[0]||{};const row=makeProjection(ast.items,ctx,group,aliases);
        if(ast.having&&!truth(evalExpr(ast.having,ctx,group,row)))continue;
        projected.push({row,ctx,group});
      }
    }else projected=contexts.map(ctx=>({row:makeProjection(ast.items,ctx,null,aliases,windowValues),ctx,group:null}));
    if(ast.distinct){const seen=new Set();projected=projected.filter(x=>{const k=keyOf(x.row);if(seen.has(k))return false;seen.add(k);return true;});}
    if(ast.orderBy.length){projected.sort((a,b)=>{
      for(const order of ast.orderBy){const va=evalExpr(order.expr,a.ctx,a.group,a.row),vb=evalExpr(order.expr,b.ctx,b.group,b.row);
        const c=cmp(va,vb);if(c)return order.desc?-c:c;
      }return 0;
    });}
    const total=projected.length;
    const start=ast.offset||0;
    return {rows:projected.slice(start,ast.limit==null?undefined:start+ast.limit).map(x=>x.row),total};
  }

  class BinaQuery {
    constructor({maxRowsPerTable=5000,maxTotalRows=100000,maxJoinRows=150000,onProgress=()=>{}}={}){
      this.maxRowsPerTable=maxRowsPerTable;this.maxTotalRows=maxTotalRows;this.maxJoinRows=maxJoinRows;
      this.onProgress=onProgress;this.loaded=new Map();this.vars=new Map();this.stopping=false;
    }
    _event(type,payload={}){try{this.onProgress({type,...payload});}catch{}}
    stop(){this.stopping=true;}
    async listTables(){
      const db=await openExisting(PUBLIC,'catalog');
      try{
        const cat=await getAll(db,'catalog');
        const map=new Map();
        for(const c of cat){const name=String(c.table||c.key||'');
          if(!/^coding_\d+$|^sanad_\d{4}_\d+$|^tk_/i.test(name))continue;
          const key=canonical(name);const prev=map.get(key);
          const candidate=infoFromValue(key,null,c);
          if(!prev||candidate.received>prev.received||(candidate.finished&&!prev.finished))map.set(key,candidate);
        }
        // TK مستقیماً از استورهای public خوانده می‌شود؛ Schema اختصاصی در Columns ذخیره نمی‌کنیم.
        for(const name of ['tk_dic','tk_sherkat']){
          const store=storeName(db,name);
          if(!Array.from(db.objectStoreNames).includes(store))continue;
          const count=await reqValue(db.transaction(store,'readonly').objectStore(store).count());
          if(count&&!map.has(name))map.set(name,{table:name,family:'tk',company:null,year:null,received:count,finished:true,available:true,storageMode:'rows'});
        }
        return [...map.values()].sort((a,b)=>a.table.localeCompare(b.table,'en',{numeric:true}));
      }finally{db.close();}
    }
    async getSchema({table}){
      const info=parseBinaName(table),db=await openExisting(PUBLIC,info.family==='tk'?tkStoreName(info.table):'columns');
      try{
        if(info.family==='tk'){
          const st=storeName(db,tkStoreName(info.table));
          const entry=await reqValue(db.transaction(st,'readonly').objectStore(st).openCursor());
          if(!entry)throw Error('جدول TK خالی است: '+info.table);
          const columns=Object.keys(entry.value).filter(n=>n!=='key').map(name=>({name,type:typeof entry.value[name]}));
          const idIndex=columns.findIndex(c=>c.name.toLowerCase()==='id');
          return {info,columns,idIndex};
        }
        const keys=[info.family.toLowerCase(),info.family];
        let found=null;
        for(const k of keys){found=await get(db,'columns',k);if(found)break;}
        if(!found){
          const all=await getAll(db,'columns');
          found=all.find(x=>keys.some(k=>canonical(k)===canonical(x.key)));
        }
        if(!found?.columns?.length)throw Error(`${info.table}: Schema در Public.Columns موجود نیست.`);
        const columns=found.columns.map(c=>({name:String(c.name),type:String(c.type??'text')}));
        let idIndex=Number.isInteger(found.idIndex)?found.idIndex:columns.findIndex(x=>x.name.toLowerCase()==='id');
        if(idIndex<0||idIndex>=columns.length)throw Error(`ستون ID در Schema ${info.table} پیدا نشد.`);
        return {info,columns,idIndex};
      }finally{db.close();}
    }
    async loadTable({table,maxRows=this.maxRowsPerTable,allowPartial=true}={}){
      if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>this.maxTotalRows)throw Error(`maxRows باید ۱ تا ${this.maxTotalRows} باشد.`);
      const schema=await this.getSchema({table}),info=schema.info;
      const totalKnown=(await this.listTables()).find(x=>x.table.toLowerCase()===table.toLowerCase())?.received||0;
      if(totalKnown>maxRows&&!allowPartial)throw Error(`این جدول ${totalKnown} رکورد دارد؛ برای نمونه محدود گزینه «اجازه نمونه‌گیری» را فعال کنید.`);
      const occupied=[...this.loaded.values()].reduce((n,x)=>n+(x.table.toLowerCase()===table.toLowerCase()?0:x.rows.length),0);
      if(occupied+maxRows>this.maxTotalRows)throw Error('مجموع رکوردهای بارگذاری‌شده از سقف ایمنی بیشتر می‌شود.');
      const db=await openExisting(info.family==='tk'?PUBLIC:info.company,info.family==='tk'?tkStoreName(info.table):info.family);
      let result=[];this.stopping=false;
      try{
        if(info.family==='tk'){
          const st=storeName(db,tkStoreName(info.table));
          const raw=await reqValue(db.transaction(st,'readonly').objectStore(st).getAll(undefined,maxRows));
          const rows=raw.map(({key,...record})=>record);
          const key=canonical(table);
          const saved={table:key,rows,schema,partial:totalKnown>rows.length,known:totalKnown};
          this.loaded.set(key,saved);
          this._event('loaded',{table:key,rows:rows.length,known:totalKnown});
          return {table:key,rows:rows.length,known:totalKnown,partial:saved.partial};
        }
        let last=null;let chunks=0;
        while(result.length<maxRows){
          if(this.stopping)throw Error('بارگذاری توسط کاربر متوقف شد.');
          const {entries,last:tip}=await entriesChunk(db,info.family==='tk'?'tk_dic':info.family,sourceRange(info,last),info.family==='tk'?100:30);
          if(!entries.length)break;
          for(const e of entries){
            if(this.stopping)throw Error('بارگذاری متوقف شد.');
            if(info.family==='tk'){
              const v=e.value;if(v?.table!==info.table)continue;
              result.push(toObject(v.id,v.value,schema,info));
            }else if(e.value instanceof Uint8Array||e.value instanceof ArrayBuffer){
              const packed=await gunzip(e.value);
              if(!Array.isArray(packed.ids)||!Array.isArray(packed.rows)||packed.ids.length!==packed.rows.length)
                throw Error('ساختار بلوک GZIP صحیح نیست.');
              for(let i=0;i<packed.ids.length&&result.length<maxRows;i++)result.push(toObject(packed.ids[i],packed.rows[i],schema,info));
            }else if(Array.isArray(e.value)){
              result.push(toObject(e.key[e.key.length-1],e.value,schema,info));
            }else throw Error('فرمت داده قدیمی LZ در این نسخه پشتیبانی نمی‌شود.');
            if(result.length>=maxRows)break;
          }
          last=tip;
          if(++chunks%4===0){this._event('loading',{table,rows:result.length,known:totalKnown});await sleep();}
        }
        const rowCount=result.length;
        const key=table.toLowerCase();
        const saved={table,rows:result,schema,partial:totalKnown>rowCount,known:totalKnown};
        this.loaded.set(key,saved);result=null;
        this._event('loaded',{table,rows:rowCount,known:totalKnown});
        return {table,rows:rowCount,known:totalKnown,partial:saved.partial};
      }finally{db.close();}
    }
    /**
     * Identify table references in FROM and JOIN and load their samples automatically.
     * Input:  {sql:string,maxRows:number,allowPartial:boolean}
     * Output: {tables:string[], loaded:[{table,rows,known,partial}], reused:string[]}
     * Only reads data from source IndexedDB. Never writes or creates source stores.
     */
    async ensureTablesForSQL({sql,maxRows=this.maxRowsPerTable,allowPartial=true}={}){
      if(/^(CREATE|INSERT|UPDATE|DELETE|DROP|DECLARE|SET)\b/i.test(String(sql).trim()))
        return {tables:[],loaded:[],reused:[]};
      const plan=new Parser(String(sql||''),this.vars).parse();
      const statements=plan.kind==='union'?plan.parts:[plan];
      const requested=statements.flatMap(p=>[p.from.name,...p.joins.map(j=>j.table.name)]);
      const names=[...new Map(requested.map(n=>[n.toLowerCase(),n])).values()];
      const catalog=await this.listTables();
      const loaded=[],reused=[];
      for(const name of names){
        if(this.loaded.has(name.toLowerCase())){reused.push(name);continue;}
        const found=catalog.find(x=>x.table.toLowerCase()===name.toLowerCase());
        if(!found)throw Error(`جدول «${name}» در Public.Catalog این Origin پیدا نشد. ابتدا آدرس و پورت برنامه، سپس فهرست جداول را بررسی کنید.`);
        if(!found.available)throw Error(`جدول «${found.table}» در Catalog موجود است، اما رکورد دریافت‌شده ندارد.`);
        const info=await this.loadTable({table:found.table,maxRows,allowPartial});
        loaded.push(info);
      }
      return {tables:names,loaded,reused};
    }
    /** ایجاد/ویرایش جدول موقت فقط در RAM. دیتابیس شرکت‌ها هیچ‌وقت تغییر نمی‌کند. */
    _workspaceCommand(sql){
      const text=String(sql).trim().replace(/;\s*$/,'');
      const assignment=/^(?:DECLARE\s+@([a-zA-Z_]\w*)(?:\s+\w+)?|SET\s+@([a-zA-Z_]\w*))\s*=\s*(.+)$/i.exec(text);
      if(assignment){
        const variable=(assignment[1]||assignment[2]).toLowerCase(), raw=assignment[3].trim();
        const value=/^null$/i.test(raw)?null:/^'[^']*'$/.test(raw)?raw.slice(1,-1):/^[-+]?\d+(\.\d+)?$/.test(raw)?Number(raw):undefined;
        if(value===undefined)throw Error('مقدار متغیر باید عدد، رشته کوتیشن‌دار یا NULL باشد.');
        this.vars.set(variable,value);
        return {affectedRows:0,message:'متغیر @'+variable+' = '+value};
      }
      const name=/^(?:CREATE\s+TABLE|DROP\s+TABLE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-zA-Z_][\w]*)/i.exec(text)?.[1];
      if(!name)return null;
      if(!/^tmp_/i.test(name))throw Error('دستورهای ویرایشی فقط برای جدول‌های موقت با پیشوند tmp_ مجاز هستند.');
      const key=canonical(name), loaded=this.loaded.get(key);
      let affected=0;
      let m=/^CREATE\s+TABLE\s+([\w]+)\s*\((.+)\)$/is.exec(text);
      if(m){
        if(loaded)throw Error('جدول موقت از قبل وجود دارد: '+name);
        const columns=m[2].split(',').map(x=>x.trim().split(/\s+/)[0]);
        if(!columns.length||columns.some(x=>!/^[\w]+$/.test(x)))throw Error('تعریف ستون‌ها نامعتبر است.');
        this.loaded.set(key,{table:key,rows:[],schema:{columns:columns.map(name=>({name})),idIndex:-1},partial:false,known:0,workspace:true});
        return {affectedRows:0,message:'جدول موقت ساخته شد: '+name};
      }
      if(/^DROP\s+TABLE\s+/i.test(text)){if(!loaded?.workspace)throw Error('فقط حذف جدول tmp_ مجاز است.');this.loaded.delete(key);return {affectedRows:0,message:'جدول موقت حذف شد.'};}
      if(!loaded?.workspace)throw Error('ابتدا CREATE TABLE '+name+' انجام دهید.');
      const columns=loaded.schema.columns.map(x=>x.name);
      m=/^INSERT\s+INTO\s+[\w]+\s*(?:\(([^)]+)\))?\s+VALUES\s*(.+)$/is.exec(text);
      if(m){
        const fields=m[1]?m[1].split(',').map(x=>x.trim()):columns;
        const groups=[...m[2].matchAll(/\(([^()]*)\)/g)];
        if(!groups.length)throw Error('VALUES معتبر نیست.');
        for(const group of groups){
          const values=group[1].match(/'(?:''|[^'])*'|[^,]+/g)?.map(x=>x.trim())||[];
          if(values.length!==fields.length)throw Error('تعداد ستون‌ها و مقادیر INSERT برابر نیست.');
          const row=Object.fromEntries(columns.map(x=>[x,null]));
          fields.forEach((col,i)=>{
            const field=columns.find(x=>canonical(x)===canonical(col));if(!field)throw Error('ستون وجود ندارد: '+col);
            const v=values[i];row[field]=/^null$/i.test(v)?null:/^'.*'$/.test(v)?v.slice(1,-1).replace(/''/g,"'"):/^[-+]?\d+(\.\d+)?$/.test(v)?Number(v):(()=>{throw Error('برای INSERT از مقادیر عددی، NULL یا رشته کوتیشن‌دار استفاده کنید.');})();
          });
          loaded.rows.push(row);affected++;
        }
        loaded.known=loaded.rows.length;
        return {affectedRows:affected,message:'رکورد در جدول موقت اضافه شد.'};
      }
      m=/^DELETE\s+FROM\s+[\w]+(?:\s+WHERE\s+(.+))?$/is.exec(text);
      if(m){
        if(!m[1])throw Error('DELETE بدون WHERE ممنوع است.');
        const parser=new Parser('SELECT * FROM '+name+' WHERE '+m[1],this.vars);const plan=parser.parse();
        const retained=[];
        for(const row of loaded.rows){
          const matches=truth(evalExpr(plan.where,{[name]:row}));
          if(matches)affected++;else retained.push(row);
        }
        loaded.rows=retained;loaded.known=retained.length;
        return {affectedRows:affected,message:'رکورد از جدول موقت حذف شد.'};
      }
      m=/^UPDATE\s+[\w]+\s+SET\s+([\w]+)\s*=\s*(.+?)\s+WHERE\s+(.+)$/is.exec(text);
      if(m){
        const field=columns.find(x=>canonical(x)===canonical(m[1]));if(!field)throw Error('ستون ناموجود: '+m[1]);
        const pred=new Parser('SELECT * FROM '+name+' WHERE '+m[3],this.vars).parse().where;
        const valueText=m[2].trim();
        const value=/^'[^']*'$/.test(valueText)?valueText.slice(1,-1):/^null$/i.test(valueText)?null:/^[-+]?\d+(\.\d+)?$/.test(valueText)?Number(valueText):undefined;
        if(value===undefined)throw Error('مقدار UPDATE فعلاً باید عدد، NULL یا رشته ساده باشد.');
        for(const row of loaded.rows)if(truth(evalExpr(pred,{[name]:row}))){row[field]=value;affected++;}
        return {affectedRows:affected,message:'رکورد در جدول موقت ویرایش شد.'};
      }
      throw Error('فرم این دستور ویرایشی در نسخه فعلی پشتیبانی نمی‌شود.');
    }

    listLoaded(){return [...this.loaded.values()].map(v=>({table:v.table,rows:v.rows.length,known:v.known,partial:v.partial}));}
    unloadTable(name){return this.loaded.delete(String(name).toLowerCase());}
    clear(){this.loaded.clear();return {cleared:true};}
    query({sql,maxResultRows=100}={}){
      if(!Number.isSafeInteger(maxResultRows)||maxResultRows<1||maxResultRows>5000)throw Error('maxResultRows باید بین ۱ و ۵۰۰۰ باشد.');
      const start=performance.now();
      const command=this._workspaceCommand(sql);
      if(command)return {columns:['message','affectedRows'],rows:[command],totalResultRows:1,truncated:false,elapsedMs:Math.round((performance.now()-start)*10)/10,note:'تغییر فقط در فضای کاری موقت RAM انجام شد.'};
      const plan=new Parser(String(sql||''),this.vars).parse();
      const runOne=p=>runSelect(p,this.loaded,this.maxJoinRows);
      let r;
      if(plan.kind==='union') {
        const portions=plan.parts.map(runOne), keys=portions[0].rows[0]?Object.keys(portions[0].rows[0]):[];
        let combined=[];
        for(let i=0;i<portions.length;i++){
          let rows=portions[i].rows.map(row=>{
            if(!keys.length)return row;
            const values=Object.values(row);
            if(values.length!==keys.length)throw Error('تعداد ستون‌های UNION برابر نیست.');
            return Object.fromEntries(keys.map((key,j)=>[key,values[j]]));
          });
          if(i>0&&!plan.all[i-1]){
            const seen=new Set(combined.map(x=>JSON.stringify(x)));
            rows=rows.filter(row=>{const k=JSON.stringify(row);if(seen.has(k))return false;seen.add(k);return true;});
          }
          combined.push(...rows);
          if(combined.length>this.maxJoinRows)throw Error('حجم UNION از سقف ایمنی بیشتر است.');
        }
        if(plan.all.some(v=>!v)){
          const seen=new Set();combined=combined.filter(x=>{const k=JSON.stringify(x);if(seen.has(k))return false;seen.add(k);return true;});
        }
        r={rows:combined,total:combined.length};
      } else r=runOne(plan);
      const output=r.rows.slice(0,maxResultRows);
      const columns=output.length?Object.keys(output[0]):plan.items.map(nameOf);
      const note=this.listLoaded().some(x=>x.partial)?'هشدار: برخی جدول‌ها فقط نمونه محدود دارند؛ جمع و تعداد برای کل داده معتبر نیست.':'نتیجه مربوط به جدول‌های بارگذاری‌شده است.';
      return {columns,rows:output,totalResultRows:r.total,truncated:r.rows.length>output.length,elapsedMs:Math.round((performance.now()-start)*10)/10,note};
    }
    storageEstimate(){return navigator.storage?.estimate?.()||Promise.resolve(null);}
  }
  root.BinaQuery=BinaQuery;
  root.BinaSQL=BinaQuery;
  if(typeof module==='object'&&module.exports)module.exports={BinaQuery,Parser,runSelect};
})(typeof window!=='undefined'?window:globalThis);
