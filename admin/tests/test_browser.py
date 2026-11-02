import asyncio, subprocess, time, json, os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT='/mnt/data/BINA_Professional_Components'
server=subprocess.Popen(['python','-m','http.server','5901','--bind','127.0.0.1','--directory',ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=await browser.new_page()
    page.on('pageerror',lambda e: print('PAGEERROR',e))
    await page.goto('http://127.0.0.1:5901/manager/index.html')
    await page.wait_for_function('typeof Index_db === "function"')
    res=await page.evaluate('''async () => {
      const rows={Coding_1000:[[1,1,2,3,'Name X'],[2,1,2,4,'Name Y']],Sanad_1395_1000:[[1,1,2,3,100],[2,1,2,4,200],[3,1,2,3,50]]};
      const states=[];
      let failOnce=true;
      const ws={
        async discoverTables(){return Object.keys(rows).map(k=>({key:k,value:{count:rows[k].length,columns:[{name:'ID',type:'int'},{name:'Kol_Code',type:'int'},{name:'Moien_Code',type:'int'},{name:'Tafsil_Code',type:'int'},{name:k.startsWith('Coding')?'Tafsil_Onvan':'Bedehkar',type:'text'}]}}))},
        async _fetchStats(table){const cols=(await this.discoverTables()).find(d=>d.key.toLowerCase()===table.toLowerCase()).value.columns;return {count:rows[table].length,columns:cols,idIndex:0}},
        async *fetchTable({table,afterId=0,batchSize}){states.push({table,afterId,batchSize});const data=rows[table].filter(x=>x[0]>afterId);for(let i=0;i<data.length;i+=2)yield {rows:data.slice(i,i+2)}}
      };
      const manager=new Index_db({webservice:ws,batchSize:15000,blockSize:2});
      const boot=await manager.bootstrap();
      const synced=await manager.syncTables(['Coding_1000','Sanad_1395_1000']);
      const tab=await manager.getTableList({});
      const got=await manager.getRows({companyCode:'1000',family:'Sanad',year:1395,limit:10});
      const dbs=await indexedDB.databases();
      window.testing={manager,states};
      return {boot,synced,tab,got,dbs:dbs.map(x=>({name:x.name,version:x.version})),states};
    }''')
    print('MANAGER',json.dumps(res,ensure_ascii=False)[:3000])
    await page.add_script_tag(url='/sql/bina-query.js')
    sql=await page.evaluate('''async () => {
      const engine=new BinaQuery({maxRowsPerTable:100,maxTotalRows:200});
      const list=await engine.listTables();
      const a=await engine.loadTable({table:'sanad_1395_1000',maxRows:10});
      const b=await engine.loadTable({table:'coding_1000',maxRows:10});
      const j=engine.query({sql:'SELECT s.ID,c.Tafsil_Onvan FROM sanad_1395_1000 s INNER JOIN coding_1000 c ON s.Kol_Code=c.Kol_Code AND s.Moien_Code=c.Moien_Code AND s.Tafsil_Code=c.Tafsil_Code ORDER BY s.ID LIMIT 20'});
      const sm=engine.query({sql:'SELECT SUM(Bedehkar) AS Total FROM sanad_1395_1000'});
      return {list,a,b,j,sm};
    }''')
    print('SQL',json.dumps(sql,ensure_ascii=False)[:3000])
    assert len(sql['j']['rows'])==3
    assert sql['sm']['rows'][0]['Total']==350
    assert len(res['got'])==3
    assert all(x['table'].islower() for x in res['tab'])
    await browser.close()
try: asyncio.run(main())
finally: server.terminate();server.wait()
