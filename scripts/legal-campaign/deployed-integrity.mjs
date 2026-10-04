// Persisted TEST fixture/RPC checks; these do not claim to test HTTP routes.
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {db,read,save,assertOk,safety,resultPath} from './context.mjs';
import {snapshot,publish} from './fixture-documents.mjs';
const f=await read();await safety();const results=[];
const check=async(name,ok,proof)=>{results.push({name,result:ok?'PASS':'FAIL',proof});await writeFile(resultPath('integrity-results'),JSON.stringify({run:f.run,method:'Supabase RPC and persisted fixture rows',results},null,2));console.log(name,ok?'PASS':'FAIL');if(!ok)throw Error(name);};
const denied=async(name,r)=>check(name,Boolean(r.error),{code:r.error?.code,message:r.error?.message});
const rows=assertOk(await db.from('legal_decisions').select('*').in('document_id',Object.values(f.docs)));
for(const [role,locale] of [['player','fr'],['parent','en'],['coach','de'],['manager','it']]){
 const d=rows.find(d=>d.document_id===f.docs.ui&&d.actor_id===f.users[role].id);
 await check('Chrome persisted snapshot '+role,!!d&&d.rendered_snapshot.locale===locale&&d.beneficiary_id===d.actor_id&&d.rendered_sha256.length===64,{id:d?.id,locale:d?.rendered_snapshot.locale,sha256:d?.rendered_sha256});
 const args={p_presentation:d.presentation_id,p_actor:d.actor_id,p_decision:d.decision,p_key:d.idempotency_key};
 const again=assertOk(await db.rpc('decide_legal_document',args));await check('retry stable '+role,again===d.id,{id:again});
 await denied('key mismatch '+role,await db.rpc('decide_legal_document',{...args,p_decision:'refused'}));
}
const parent=rows.find(d=>d.document_id===f.docs.parent);
await check('Chrome parent authority and beneficiary',parent?.beneficiary_id===f.users.player.id&&parent.authority_snapshot.parent_email_confirmed===true,{id:parent?.id,authority:parent?.authority_snapshot});
const challenge=assertOk(await db.from('legal_parent_challenges').select('id,attempts,used_at').eq('id',f.challenge).single());
// Every submitted code counts, including the successful second submission.
await check('bad code persisted; good code consumed',challenge.attempts===2&&Boolean(challenge.used_at),challenge);
const args={p_presentation:parent.presentation_id,p_actor:parent.actor_id,p_decision:'authorized',p_key:parent.idempotency_key,p_parent_code:'135790'};
await check('parent retry after consumed code',assertOk(await db.rpc('decide_legal_document',args))===parent.id,{id:parent.id});
await denied('consumed parent code reuse',await db.rpc('decide_legal_document',{...args,p_key:randomUUID()}));
for(const [name,actor,role,locale] of [['foreign club','outsider','player','fr'],['false role','player','manager','fr'],['unknown locale','player','player','es']])await denied(name,await db.rpc('present_legal_document',{p_document:f.docs.ui,p_actor:f.users[actor].id,p_beneficiary:f.users[actor].id,p_role:role,p_locale:locale}));
const withdrawal=assertOk(await db.from('legal_current_state').select('decision,conflict').eq('document_id',f.docs.optional).eq('beneficiary_id',f.users.player.id).single());
await check('Chrome withdrawal conflict persisted',withdrawal.decision==='withdrawn'&&withdrawal.conflict,withdrawal);
await denied('immutable decision',await db.from('legal_decisions').update({decision:'refused'}).eq('id',parent.id));
await denied('immutable presentation',await db.from('legal_presentations').delete().eq('id',parent.presentation_id));
await denied('old publication missing snapshot',await db.rpc('publish_legal_draft_checked',{p_document_id:f.docs.ui,p_publisher:f.users.admin.id,p_expected:null}));
const before=await snapshot(f.docs.ui);f.uiVersion1=before.latest_version_id;
const patch=async(translations)=>assertOk(await db.from('legal_drafts').update({translations}).eq('document_id',f.docs.ui));
try{
 for(const [name,change] of [
  ['missing required language',t=>{delete t.it;}],
  ['unreviewed translation',t=>{t.de.status='needs_review';}],
  ['unknown template variable',t=>{t.fr.body+=' {{unknown}}';}],
 ]){const t=structuredClone(before.draft.translations);change(t);await patch(t);await denied(name,await publish(f,f.docs.ui));}
}finally{await patch(before.draft.translations);}
const translations=Object.fromEntries(Object.entries(before.draft.translations).map(([locale,t])=>[locale,{...t,body:t.body+' [FICTIVE V2]',source_revision:before.draft.source_revision+1}]));
assertOk(await db.from('legal_drafts').update({source_revision:before.draft.source_revision+1,translations,change_summary:'FICTIVE V2 : test de renouvellement sans valeur juridique.'}).eq('document_id',f.docs.ui));
await denied('stale publication snapshot',await publish(f,f.docs.ui,before));
f.uiVersion2=assertOk(await publish(f,f.docs.ui));await save(f);
await check('fixture version 2 persisted',f.uiVersion2!==f.uiVersion1,{v1:f.uiVersion1,v2:f.uiVersion2,method:'Supabase fixture publication; UI stale decision tested next'});
await denied('immutable version',await db.from('legal_versions').update({content_sha256:'fixture-tamper'}).eq('id',f.uiVersion2));
await safety();
