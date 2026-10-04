import {writeFile} from 'node:fs/promises';
import {db,read,save,assertOk,safety} from './context.mjs';
await safety();const f=await read();const users=Object.values(f.users).map(u=>u.id);const clubs=Object.values(f.clubs);
// Abort before mutations if any identifier does not belong to this run.
for(const u of Object.values(f.users)){
 const found=assertOk(await db.auth.admin.getUserById(u.id)).user;
 if(found.email!==u.email || found.user_metadata.legal_campaign!==f.run || !found.email.endsWith('@example.invalid'))throw Error('Fixture ownership mismatch');
}
const named=assertOk(await db.from('clubs').select('id,name').in('id',clubs));
if(named.length!==2 || named.some(c=>!c.name.startsWith('JETABLE '+f.run)))throw Error('Club ownership mismatch');
const log=[];const record=async(name,proof)=>{log.push({name,proof});await writeFile('docs/legal/evidence/20261004-cleanup.json',JSON.stringify({run:f.run,project:f.project,clubs:f.clubs,users:Object.fromEntries(Object.entries(f.users).map(([k,u])=>[k,u.id])),documents:f.docs,actions:log},null,2));};
if(f.request){assertOk(await db.rpc('review_legal_data_request',{p_request:f.request,p_actor:f.users.admin.id,p_status:'resolved',p_note:'JETABLE QA campaign closed. No real request or personal data.'}));await record('fictional request closed',{request:f.request});}
const paths=[f.business.storagePath,f.business.documentPath].filter(Boolean);
const prefixes=[f.users.player.id+'/',`player-documents/${f.clubs.A}/${f.users.player.id}/`];
if(paths.some(p=>!prefixes.some(prefix=>p.startsWith(prefix))||!p.endsWith(f.run+'.txt')))throw Error('Storage fixture ownership mismatch');
if(paths.length){assertOk(await db.storage.from('player-documents').remove(paths));await record('fictional private objects removed',{paths});}
if(f.business.document){assertOk(await db.from('player_dashboard_documents').delete().eq('id',f.business.document).eq('player_id',f.users.player.id));await record('fictional document row removed',{document:f.business.document});}
assertOk(await db.from('marketplace_items').update({is_active:false}).eq('user_id',f.users.player.id).eq('club_id',f.clubs.A).like('title','JETABLE '+f.run+'%'));
assertOk(await db.from('club_events').update({status:'cancelled'}).eq('id',f.business.event).eq('club_id',f.clubs.A));
assertOk(await db.from('coach_groups').update({is_active:false}).eq('id',f.business.group).eq('club_id',f.clubs.A));
assertOk(await db.from('player_guardians').update({can_view:false,can_edit:false}).eq('guardian_user_id',f.users.parent.id).eq('player_id',f.users.player.id));
assertOk(await db.from('club_members').update({is_active:false}).in('user_id',users).in('club_id',clubs));
assertOk(await db.from('organization_members').update({is_active:false}).in('user_id',users).in('organization_id',clubs));
assertOk(await db.from('organizations').update({is_active:false}).in('id',clubs));
assertOk(await db.from('app_admins').delete().eq('user_id',f.users.admin.id));
await record('fixtures deactivated and administrative role removed',{event:f.business.event,group:f.business.group});
for(const [role,u] of Object.entries(f.users)){
 const signout=await db.auth.admin.signOut(u.token,'global');
 const banned=assertOk(await db.auth.admin.updateUserById(u.id,{ban_duration:'876000h'})).user;
 await record('fixture account banned',{role,id:u.id,banned_until:banned.banned_until,sessionRevoked:!signout.error,signOutStatus:signout.error?.status});
}
const state={enabled:assertOk(await db.from('legal_enforcement_control').select('enabled').single()).enabled};
for(const [name,q] of [
 ['versions',db.from('legal_versions').select('*',{count:'exact',head:true})],
 ['decisions',db.from('legal_decisions').select('*',{count:'exact',head:true})],
 ['active_documents',db.from('legal_documents').select('*',{count:'exact',head:true}).eq('active',true)],
 ['active_fixture_members',db.from('club_members').select('*',{count:'exact',head:true}).in('user_id',users).eq('is_active',true)],
 ['fixture_admins',db.from('app_admins').select('*',{count:'exact',head:true}).in('user_id',users)],
 ['active_fixture_marketplace',db.from('marketplace_items').select('*',{count:'exact',head:true}).eq('user_id',f.users.player.id).eq('is_active',true)],
 ['fixture_document_rows',db.from('player_dashboard_documents').select('*',{count:'exact',head:true}).eq('player_id',f.users.player.id)]
]){const r=await q;assertOk(r);state[name]=r.count;}
state.remaining_private_objects=0;for(const prefix of prefixes){const objects=assertOk(await db.storage.from('player-documents').list(prefix.replace(/\/$/,'')));state.remaining_private_objects+=objects.length;}
await record('final persisted state',state);
if(Object.entries(state).some(([k,v])=>k==='enabled'?v!==false:v!==0))throw Error('Cleanup verification failed');
f.cleaned=true;for(const u of Object.values(f.users)){delete u.token;delete u.password;}await save(f);
await record('temporary passwords and JWTs erased',{retained:'Only inactive named fixtures and immutable legal rule/request audit rows; no published legal versions or decisions'});
console.log({run:f.run,state,accountsBanned:users.length});
