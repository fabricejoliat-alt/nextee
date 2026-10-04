import {writeFile} from 'node:fs/promises';
import {db,api,client,read,save,safety,assertOk,refreshFixtureSessions} from './context.mjs';
const f=await read();await safety();await refreshFixtureSessions(f);const results=[];
const record=async(name,ok,proof)=>{results.push({name,result:ok?'PASS':'FAIL',proof});console.log(name,ok?'PASS':'FAIL',JSON.stringify(proof));await writeFile('docs/legal/evidence/20261004-extra-results.json',JSON.stringify({run:f.run,results},null,2));};
let dr=assertOk(await db.from('legal_drafts').select('*').eq('document_id',f.docs.terms).single());
await record('mobile Admin save and approval persisted',dr.translations.en.body.includes('Mobile UI verification.')&&dr.translations.en.status==='approved',{status:dr.translations.en.status,approved_by:dr.translations.en.approved_by});
const stale=await api(f,'admin','/api/admin/legal',{operation:'approve_translation',document_id:f.docs.terms,locale:'en',expected_revision:dr.source_revision,expected_translation:{...dr.translations.en,body:'Old fictional text'}});
await record('stale text approval rejected over HTTP',stale.status===409,{status:stale.status,body:stale.body});
const translate=await api(f,'admin','/api/admin/legal/translate',{document_id:f.docs.parent,locale:'en'});
dr=assertOk(await db.from('legal_drafts').select('*').eq('document_id',f.docs.parent).single());
await record('AI translation produces unapproved proposal with placeholders',translate.status===200&&dr.translations.en.status==='proposed'&&dr.translations.en.body.includes('{{user_name}}')&&dr.translations.en.body.includes('{{club_name}}'),{status:translate.status,body:translate.body,translationStatus:dr.translations.en.status});
if(translate.status===200)await api(f,'admin','/api/admin/legal',{operation:'approve_translation',document_id:f.docs.parent,locale:'en',expected_revision:dr.source_revision,expected_translation:dr.translations.en});
const req=await api(f,'player','/api/legal/data-request',{email:f.users.player.email,kind:'access',description:'JETABLE fictional data request - no real personal data'});
const row=assertOk(await db.from('legal_data_requests').select('id').eq('contact_email',f.users.player.email).single());f.request=row.id;await save(f);
const review=await api(f,'admin','/api/admin/legal/requests',{id:row.id,status:'identity_check',note:'Fictional QA review only'},'PATCH');
const state=assertOk(await db.from('legal_data_requests').select('status').eq('id',row.id).single());await record('fictional data request and admin review persist',[200,201].includes(req.status)&&review.status===200&&state.status==='identity_check',{request:row.id,status:state.status,reviewHttp:review.status});
const text='JETABLE fictional document for legal QA. No real personal data.\n';const body={original_name:f.run+'.txt',mime_type:'text/plain',size_bytes:Buffer.byteLength(text)};
const prep=await api(f,'player','/api/player/documents',{...body,action:'prepare'});
if(prep.status===200){
 const up=await client(f,'player').storage.from(prep.body.bucket).uploadToSignedUrl(prep.body.path,prep.body.token,Buffer.from(text),{contentType:'text/plain'});assertOk(up);
 f.business.documentPath=prep.body.path;await save(f);
 const fin=await api(f,'player','/api/player/documents',{...body,action:'finalize',storage_path:prep.body.path,reservation_token:prep.body.reservation_token,file_name:'JETABLE QA document'});
 const persisted=assertOk(await db.from('player_dashboard_documents').select('id,storage_path').eq('player_id',f.users.player.id).eq('storage_path',prep.body.path));
 f.business.document=persisted[0]?.id;await save(f);await record('document upload reservation finalize persistence',[200,201].includes(fin.status)&&persisted.length===1,{status:fin.status,document:f.business.document,error:fin.body.error});
 for(const role of ['player','parent','outsider']){
  const path='/api/player/documents'+(role==='player'?'':`?child_id=${f.users.player.id}`);const r=await api(f,role,path);
  await record(`document access ${role}`,role==='outsider'?r.status===403:r.status===200&&r.body.documents.some(d=>d.id===f.business.document),{status:r.status,documents:r.body.documents?.length});
 }
}else await record('document prepare',false,{status:prep.status,body:prep.body});
await safety();
