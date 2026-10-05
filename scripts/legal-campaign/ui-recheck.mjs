// Narrow TEST browser recheck: reuse only the named, closed fictional campaign.
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {db,assertOk,safety} from './context.mjs';
const secret='/private/tmp/activitee-legal-ui-recheck-20261005.json';
const proof='docs/legal/evidence/20261005-ui-recheck';
const prior=JSON.parse(await readFile('docs/legal/evidence/20261004-deployed-cleanup.json','utf8'));
if(prior.run!=='legalqa_20261004_9a282f'||prior.project!=='wizbeuuvjibmmuxyynly.supabase.co')throw Error('Unexpected campaign');
const docs=[prior.documents.ui,prior.documents.parent];
const ids=[prior.users.parent,prior.users.player];
await safety();
for(const role of ['admin','parent','player']){
 const u=assertOk(await db.auth.admin.getUserById(prior.users[role])).user;
 if(u.user_metadata.legal_campaign!==prior.run||u.email!==`${prior.run}.${role}@example.invalid`)throw Error('Not a fictional account');
}
const documentRows=assertOk(await db.from('legal_documents').select('id,document_key,club_id,active').in('id',docs));
if(documentRows.length!==2||documentRows.some(d=>d.club_id!==prior.clubs.A||!d.document_key.startsWith(prior.run+'_')))throw Error('Not fictional documents');
async function state(){
 const versions=await db.from('legal_versions').select('id',{head:true,count:'exact'});
 const decisions=await db.from('legal_decisions').select('id',{head:true,count:'exact'});
 const active=await db.from('legal_documents').select('id',{head:true,count:'exact'}).eq('active',true);
 [versions,decisions,active].forEach(assertOk);
 return {enabled:assertOk(await db.from('legal_enforcement_control').select('enabled').single()).enabled,versions:versions.count,decisions:decisions.count,active_documents:active.count};
}
const mode=process.argv[2];
if(mode==='setup'){
 const baseline=await state();if(baseline.active_documents!==0)throw Error('Expected inactive baseline');
 const f={run:prior.run,users:{},docs:prior.documents,club:prior.clubs.A,baseline,draft:assertOk(await db.from('legal_drafts').select('*').eq('document_id',prior.documents.ui).single())};
 await writeFile(secret,JSON.stringify(f),{mode:0o600});
 for(const role of ['admin','parent']){
  const password=randomBytes(27).toString('base64url');
  const u=assertOk(await db.auth.admin.updateUserById(prior.users[role],{password,ban_duration:'none'})).user;
  f.users[role]={id:u.id,email:u.email,password};await writeFile(secret,JSON.stringify(f),{mode:0o600});
 }
 assertOk(await db.from('app_admins').insert({user_id:prior.users.admin}));
 assertOk(await db.from('club_members').update({is_active:true}).in('user_id',ids).eq('club_id',prior.clubs.A));
 assertOk(await db.from('organization_members').update({is_active:true}).in('user_id',ids).eq('organization_id',prior.clubs.A));
 assertOk(await db.from('player_guardians').update({can_view:true,can_edit:true}).eq('guardian_user_id',prior.users.parent).eq('player_id',prior.users.player));
 assertOk(await db.rpc('review_legal_representative',{p_guardian:prior.users.parent,p_child:prior.users.player,p_club:prior.clubs.A,p_status:'verified',p_basis:'JETABLE: temporary UI label recheck with existing fictional history; no real legal authority.',p_admin:prior.users.admin}));
 assertOk(await db.from('legal_documents').update({active:true}).in('id',docs).eq('club_id',prior.clubs.A));
 await writeFile(proof+'-setup.json',JSON.stringify({run:prior.run,baseline,temporary_documents:docs,temporary_logins:['admin','parent'],guardsChanged:false},null,2));
 console.log({mode,baseline,documents:docs});
}else if(mode==='verify'){
 const f=JSON.parse(await readFile(secret,'utf8'));
 const draft=assertOk(await db.from('legal_drafts').select('change_summary,source_revision,translations,allowed_variables').eq('document_id',prior.documents.ui).single());
 const current=await state();const decisions=assertOk(await db.from('legal_decisions').select('id,decision,actor_id,beneficiary_id,version_id').eq('document_id',prior.documents.parent));
 await writeFile(proof+'-persistence.json',JSON.stringify({run:prior.run,draft,state:current,parent_decisions:decisions,newDecisions:current.decisions-f.baseline.decisions,newVersions:current.versions-f.baseline.versions},null,2));
 console.log({mode,summary:draft.change_summary,state:current,newDecisions:current.decisions-f.baseline.decisions,newVersions:current.versions-f.baseline.versions});
}else if(mode==='cleanup'){
 const f=JSON.parse(await readFile(secret,'utf8'));
 assertOk(await db.from('legal_documents').update({active:false}).in('id',docs).eq('club_id',prior.clubs.A));
 assertOk(await db.from('legal_drafts').update({change_summary:f.draft.change_summary}).eq('document_id',prior.documents.ui));
 assertOk(await db.rpc('review_legal_representative',{p_guardian:prior.users.parent,p_child:prior.users.player,p_club:prior.clubs.A,p_status:'revoked',p_basis:'JETABLE: temporary UI recheck closed, fictional representation revoked again.',p_admin:prior.users.admin}));
 assertOk(await db.from('player_guardians').update({can_view:false,can_edit:false}).eq('guardian_user_id',prior.users.parent).eq('player_id',prior.users.player));
 assertOk(await db.from('club_members').update({is_active:false}).in('user_id',ids).eq('club_id',prior.clubs.A));
 assertOk(await db.from('organization_members').update({is_active:false}).in('user_id',ids).eq('organization_id',prior.clubs.A));
 assertOk(await db.from('app_admins').delete().eq('user_id',prior.users.admin));
 for(const role of ['admin','parent'])assertOk(await db.auth.admin.updateUserById(prior.users[role],{ban_duration:'876000h',password:randomBytes(32).toString('base64url')}));
 const current=await state();const members=assertOk(await db.from('club_members').select('user_id').in('user_id',ids).eq('is_active',true));
 const admin=assertOk(await db.from('app_admins').select('user_id').eq('user_id',prior.users.admin));
 const draft=assertOk(await db.from('legal_drafts').select('change_summary').eq('document_id',prior.documents.ui).single());
 if(current.enabled||current.active_documents||current.decisions!==f.baseline.decisions||current.versions!==f.baseline.versions||members.length||admin.length||draft.change_summary!==f.draft.change_summary)throw Error('Cleanup mismatch');
 await writeFile(proof+'-cleanup.json',JSON.stringify({run:prior.run,state:current,active_fixture_members:members.length,fixture_admins:admin.length,draft_summary_restored:true,logins_banned:true,secretsErased:true},null,2));
 await writeFile(secret,JSON.stringify({run:prior.run,cleaned:true}),{mode:0o600});console.log({mode,state:current});
}else throw Error('Choose setup, verify or cleanup');
await safety();
