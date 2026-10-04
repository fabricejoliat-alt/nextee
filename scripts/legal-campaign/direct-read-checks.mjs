import {readFile,writeFile} from 'node:fs/promises';
import {resultPath,db,read,client,assertOk,safety,refreshFixtureSessions} from './context.mjs';
await safety(); const f=await read();await refreshFixtureSessions(f);
const inventory=JSON.parse(await readFile('docs/legal/evidence/20261004-test-inventory.json','utf8'));
const closed=inventory.filter(r=>r.category==='relation' && !r.details.anon_select && !r.details.authenticated_select);
const results=[];
for(const role of [null,'player']){
 const c=client(f,role);
 for(let offset=0;offset<closed.length;offset+=6){
  const batch=await Promise.all(closed.slice(offset,offset+6).map(async row=>{
   const r=await c.from(row.item).select('*').limit(0); // No real rows retrieved.
   return {relation:row.item,role:role??'anon',result:r.error?.code==='42501'?'PASS':'FAIL',status:r.status,error:r.error?.code,rows:r.data?.length};
  }));results.push(...batch);
 }
}
const state={enabled:assertOk(await db.from('legal_enforcement_control').select('enabled').single()).enabled};
for(const table of ['legal_versions','legal_decisions']){const r=await db.from(table).select('*',{head:true,count:'exact'});assertOk(r);state[table]=r.count;}
const active=await db.from('legal_documents').select('*',{head:true,count:'exact'}).eq('active',true);assertOk(active);state.active_documents=active.count;
await writeFile(resultPath('direct-read-results'),JSON.stringify({run:f.run,state,results},null,2));
console.log({tables:closed.length,total:results.length,failed:results.filter(r=>r.result==='FAIL'),state});
