import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {db,api,client,assertOk,safety,read,save,evidence} from './context.mjs';
const f=await read();await safety();let results=[];
const record=async(name,ok,proof)=>{results.push({name,result:ok?'PASS':'FAIL',proof});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(proof)}`);await writeFile(evidence,JSON.stringify({run:f.run,project:f.project,at:new Date().toISOString(),results},null,2))};
const a=async(role,path,body,expected=200,method)=>{const r=await api(f,role,path,body,method);if(r.status!==expected)throw Error(`${path} ${body?.operation??""} expected ${expected}, got ${r.status}: ${JSON.stringify(r.body)}`);return r.body};
const post=async(body)=>{if(body.operation==='approve_translation'){const dr=(await expected(body.document_id)).draft;body={...body,expected_revision:dr.source_revision,expected_translation:dr.translations[body.locale]}}return a('admin','/api/admin/legal',body,body.operation==='create'?201:200)};
const expected=async(id)=>{const d=assertOk(await db.from('legal_documents').select('*').eq('id',id).single()),dr=assertOk(await db.from('legal_drafts').select('*').eq('document_id',id).single()),v=assertOk(await db.from('legal_versions').select('id').eq('document_id',id).order('version_number',{ascending:false}).limit(1));return {document:Object.fromEntries(['document_key','kind','purpose_key','scope','club_id','audience_roles','action_kind','required','active','applicability','required_locales'].map(k=>[k,d[k]])),draft:Object.fromEntries(['source_revision','change_summary','allowed_variables','translations'].map(k=>[k,dr[k]])),latest_version_id:v[0]?.id??null}};
const text={fr:['DOCUMENT FICTIF — SANS VALEUR JURIDIQUE','Essai jetable : {{user_name}} au {{club_name}}. Aucun engagement réel.','Valider le test'],en:['FICTIONAL DOCUMENT — NOT A LEGAL AGREEMENT','Disposable test: {{user_name}} at {{club_name}}. No real commitment.','Confirm test'],de:['FIKTIVES DOKUMENT — KEINE RECHTLICHE WIRKUNG','Test: {{user_name}} im {{club_name}}. Keine echte Verpflichtung.','Test bestätigen'],it:['DOCUMENTO FITTIZIO — SENZA VALORE LEGALE','Test: {{user_name}} presso {{club_name}}. Nessun impegno reale.','Conferma test']};
async function prepare(label,kind='terms',action='accept',roles=['player','parent','coach','manager']){
 let id=f.docs[label]??assertOk(await db.from('legal_documents').select('id').eq('document_key',`${f.run}_${label}`).maybeSingle())?.id;if(id){f.docs[label]=id;await save(f)}if(!id){id=(await post({operation:'create',key:`${f.run}_${label}`,kind,purpose_key:'Disposable QA without legal effect',scope:'club',club_id:f.clubs.A,audience:roles,action,required:kind==='terms'})).id;f.docs[label]=id;await save(f)}
 await post({operation:'save_variables',document_id:id,expected_revision:(await expected(id)).draft.source_revision,variables:['user_name','club_name']});
 for(const [locale,[title,body,action_label]] of Object.entries(text)){
  await post({operation:'save_translation',document_id:id,locale,title,body,action_label,expected_revision:(await expected(id)).draft.source_revision});
  await post({operation:'approve_translation',document_id:id,locale});
 }
 await post({operation:'summary',document_id:id,summary:'Disposable fictional fixture v1; no real legal effect'});
 await post({operation:'review_rule',document_id:id,note:'Fictional QA review only, not a legal assessment or approval.',configuration:{status:'approved',rule:'all_members',fixture:f.run}});
 await record(`${label}: draft, four languages, review persisted`,(await expected(id)).draft.translations.it.status==='approved',{id});
 const ex=await expected(id);const stale=await api(f,'admin','/api/admin/legal',{operation:'publish',document_id:id,expected:{...ex,latest_version_id:randomUUID()}});
 await record(`${label}: stale publication preview denied`,stale.status===409,stale);
 const publish=await api(f,'admin','/api/admin/legal',{operation:'publish',document_id:id,expected:ex});
 await record(`${label}: publication`,publish.status===200,publish);
 if(publish.status!==200)return null;
 assertOk(await db.from('legal_documents').update({active:true}).eq('id',id).eq('club_id',f.clubs.A));
 return id;
}
async function present(role,id,locale='fr',child){return a(role,'/api/legal/present',{document_id:id,locale,role,beneficiary_id:child})}
try{
 for(const role of [null,'player','parent','coach','manager','outsider']){
  const r=await api(f,role,'/api/admin/legal');await record(`admin denied ${role??'anon'}`,r.status===403,{status:r.status});
 }
 for(const role of ['player','parent','coach','manager','outsider']){
  const c=client(f,role);const r=await c.from('legal_decisions').select('id').limit(1);const rpc=await c.rpc('create_legal_document',{p_key:`${f.run}_denied`,p_kind:'terms',p_purpose:'QA',p_scope:'club',p_club:f.clubs.A,p_roles:['player'],p_action:'accept',p_required:false,p_actor:f.users.admin.id});
  await record(`direct legal table and service RPC denied ${role}`,r.error?.code==='42501'&&rpc.error?.code==='42501',{table:r.error?.code,rpc:rpc.error?.code});
  const status=await a(role,'/api/legal/status');await record(`HTTP enforcement stays off ${role}`,status.enforcement_enabled===false,status);
 }
 const id=await prepare('terms');if(id){
  for(const [role,locale] of [['player','fr'],['parent','en'],['coach','de'],['manager','it']]){
   const p=(await present(role,id,locale)).presentation;const key=randomUUID();
   const body={presentation_id:p.id,decision:'accepted',idempotency_key:key};const d=await a(role,'/api/legal/decide',body);const retry=await a(role,'/api/legal/decide',body);
   const row=assertOk(await db.from('legal_decisions').select('*').eq('id',d.decision_id).single());
   await record(`${role}: presentation decision snapshot and idempotence`,d.decision_id===retry.decision_id&&row.rendered_snapshot.locale===locale&&!row.rendered_snapshot.body.includes('{{')&&row.actor_id===f.users[role].id,{decision:d.decision_id,locale,sha256:row.rendered_sha256});
   const wrong=await api(f,role,'/api/legal/decide',{...body,decision:'refused'});await record(`${role}: idempotency key payload mismatch denied`,wrong.status===409,wrong);
  }
  const denied=await api(f,'outsider','/api/legal/present',{document_id:id,locale:'fr',role:'player'});const visible=await a('outsider','/api/legal/documents');
  await record('second club cannot present or list club A document',denied.status===409&&!visible.documents.some(d=>d.id===id),{status:denied.status});
  const old=(await present('player',id)).presentation;const ex=await expected(id);
  await post({operation:'save_translation',document_id:id,locale:'fr',...ex.draft.translations.fr,body:ex.draft.translations.fr.body+' Version 2 fictive.',expected_revision:ex.draft.source_revision});
  const changed=await expected(id);await record('French revision invalidates other approvals',changed.draft.translations.en.status==='needs_review'&&changed.draft.translations.en.source_revision!==changed.draft.source_revision,{source_revision:changed.draft.source_revision});
  const blocked=await api(f,'admin','/api/admin/legal',{operation:'publish',document_id:id,expected:changed});await record('unreviewed translations block publication',blocked.status===409,blocked);
  for(const locale of ['fr','en','de','it']){if(locale!=='fr')await post({operation:'save_translation',document_id:id,locale,...changed.draft.translations[locale],expected_revision:changed.draft.source_revision});await post({operation:'approve_translation',document_id:id,locale})}
  await post({operation:'summary',document_id:id,summary:'Fictional version 2 changes'});await post({operation:'publish',document_id:id,expected:await expected(id)});
  const rejected=await api(f,'player','/api/legal/decide',{presentation_id:old.id,decision:'accepted',idempotency_key:randomUUID()});
  const docs=await a('player','/api/legal/documents');const current=docs.documents.find(d=>d.id===id);
  await record('version 2 requires a new presentation, version 1 decision preserved',rejected.status===409&&current.state.version_id!==current.version.id,{status:rejected.status,version:current.version.version_number});
  const p=(await present('player',id)).presentation;await a('player','/api/legal/decide',{presentation_id:p.id,decision:'refused',idempotency_key:randomUUID()});
  const state=assertOk(await db.from('legal_current_state').select('decision').eq('document_id',id).eq('beneficiary_id',f.users.player.id).single());await record('refusal persisted',state.decision==='refused',state);
  const immutable=await db.from('legal_versions').update({content_sha256:'fixture-tamper'}).eq('id',current.version.id);await record('published evidence immutable even service',!!immutable.error,{error:immutable.error?.message});
 }
 const consent=await prepare('optional','specific_consent','consent');if(consent){
  const p=(await present('player',consent)).presentation;await a('player','/api/legal/decide',{presentation_id:p.id,decision:'consented',idempotency_key:randomUUID()});
  await a('player','/api/legal/decide',{presentation_id:p.id,decision:'withdrawn',idempotency_key:randomUUID()});
  const rejected=await api(f,'player','/api/legal/decide',{presentation_id:p.id,decision:'consented',idempotency_key:randomUUID()});const state=assertOk(await db.from('legal_current_state').select('*').eq('document_id',consent).single());
  await record('withdrawal remains conflict until motivated review',rejected.status===409&&state.conflict&&state.decision==='withdrawn',{status:rejected.status,decision:state.decision,conflict:state.conflict});
 }
 const parent=await prepare('parent','parent_authorization','authorize',['parent']);if(parent){
  const body={document_id:parent,locale:'fr',role:'parent',beneficiary_id:f.users.player.id};
  const blocked=await api(f,'parent','/api/legal/present',body);await record('family access alone is not legal representation',blocked.status===409,blocked);
  await a('admin','/api/admin/legal/representatives',{guardian_id:f.users.parent.id,child_id:f.users.player.id,club_id:f.clubs.A,status:'verified',basis:'Fictional QA representative assertion, no real legal representation.'});
  const p=(await a('parent','/api/legal/present',body)).presentation;
  const mail=await api(f,'parent','/api/legal/parent-confirmation',{presentation_id:p.id});await record('mail disabled, no real email',mail.status===503,mail);
  const hash=v=>createHash('sha256').update(v).digest('hex');const code='135790';
  const challenge=await db.rpc('issue_legal_parent_challenge',{p_presentation:p.id,p_actor:f.users.parent.id,p_email_hash:hash(f.users.parent.email),p_secret_hash:hash(code)});assertOk(challenge);
  const wrong=await api(f,'parent','/api/legal/decide',{presentation_id:p.id,decision:'authorized',idempotency_key:randomUUID(),parent_code:'000000'});
  const attempts=assertOk(await db.from('legal_parent_challenges').select('attempts').eq('id',challenge.data).single());await record('incorrect code rejected and attempt persisted',wrong.status===400&&attempts.attempts===1,{status:wrong.status,attempts:attempts.attempts});
  const decision=await a('parent','/api/legal/decide',{presentation_id:p.id,decision:'authorized',idempotency_key:randomUUID(),parent_code:code});const row=assertOk(await db.from('legal_decisions').select('*').eq('id',decision.decision_id).single());await record('parent code decision records beneficiary and authority',row.beneficiary_id===f.users.player.id&&row.authority_snapshot.parent_email_confirmed,{decision:row.id,authority:row.authority_snapshot});
 }
}catch(error){await record('campaign flow',false,{error:error.message})}finally{await safety();await save(f)}
