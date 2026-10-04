// Fixture provisioning through the explicitly authorized Supabase TEST service.
// These calls are not recorded as deployed HTTP-route tests.
import {writeFile} from 'node:fs/promises';
import {db,read,save,assertOk,safety,resultPath} from './context.mjs';
export async function snapshot(document){
 const d=assertOk(await db.from('legal_documents').select('*').eq('id',document).single());
 const dr=assertOk(await db.from('legal_drafts').select('*').eq('document_id',document).single());
 const v=assertOk(await db.from('legal_versions').select('id').eq('document_id',document).order('version_number',{ascending:false}).limit(1));
 return {document:Object.fromEntries(['document_key','kind','purpose_key','scope','club_id','audience_roles','action_kind','required','active','applicability','required_locales'].map(k=>[k,d[k]])),draft:Object.fromEntries(['source_revision','change_summary','allowed_variables','translations'].map(k=>[k,dr[k]])),latest_version_id:v[0]?.id??null};
}
export const publish=async(f,id,expected)=>db.rpc('publish_legal_draft_checked',{p_document_id:id,p_publisher:f.users.admin.id,p_expected:expected??await snapshot(id)});
export const fiction={fr:['DOCUMENT FICTIF — SANS VALEUR JURIDIQUE','Essai jetable : {{user_name}} au {{club_name}}. Aucun engagement réel.','Valider le test'],en:['FICTIONAL DOCUMENT — NOT A LEGAL AGREEMENT','Disposable test: {{user_name}} at {{club_name}}. No real commitment.','Confirm test'],de:['FIKTIVES DOKUMENT — KEINE RECHTLICHE WIRKUNG','Test: {{user_name}} im {{club_name}}. Keine echte Verpflichtung.','Test bestätigen'],it:['DOCUMENTO FITTIZIO — SENZA VALORE LEGALE','Test: {{user_name}} presso {{club_name}}. Nessun impegno reale.','Conferma test']};
export async function prepare(f,label,kind,action,roles){
 let id=f.docs[label];
 if(!id){id=assertOk(await db.rpc('create_legal_document',{p_key:f.run+'_'+label,p_kind:kind,p_purpose:'JETABLE fictional QA only; no real legal effect',p_scope:'club',p_club:f.clubs.A,p_roles:roles,p_action:action,p_required:false,p_actor:f.users.admin.id}));f.docs[label]=id;await save(f);}
 const snap=await snapshot(id);if(snap.latest_version_id)return id;
 const translations=Object.fromEntries(Object.entries(fiction).map(([locale,[title,body,action_label]])=>[locale,{title:title+' — '+label,body,action_label,status:'approved',source_revision:snap.draft.source_revision,approved_by:f.users.admin.id,approved_at:new Date().toISOString()}]));
 assertOk(await db.from('legal_drafts').update({translations,change_summary:'Fictional TEST fixture version 1',allowed_variables:['user_name','club_name'],updated_by:f.users.admin.id}).eq('document_id',id));
 if(snap.document.applicability.status!=='approved')assertOk(await db.rpc('review_legal_applicability',{p_document:id,p_reviewer:f.users.admin.id,p_configuration:{status:'approved',rule:'all_members',fixture:f.run},p_note:'Fictional technical QA review only, not a real legal assessment.'}));
 return id;
}
if(process.argv[1]?.endsWith('fixture-documents.mjs')){
 await safety();const f=await read();const results=[];
 for(const [label,kind,action,roles] of [['optional','specific_consent','consent',['player','parent','coach','manager']],['parent','parent_authorization','authorize',['parent']]]){
  const id=await prepare(f,label,kind,action,roles);const ex=await snapshot(id);
  if(!ex.latest_version_id)assertOk(await publish(f,id,ex));
  assertOk(await db.from('legal_documents').update({active:true}).eq('id',id).eq('club_id',f.clubs.A));
  results.push({label,id,version:(await snapshot(id)).latest_version_id,scope:f.clubs.A,method:'Supabase fixture provisioning, not HTTP route proof'});
 }
 await writeFile(resultPath('fixture-publications'),JSON.stringify(results,null,2));await safety();console.log(results);
}
