import {randomUUID,randomBytes} from 'node:crypto';
import {db,host,temp,assertOk,safety,save,read,client} from './context.mjs';
await safety();
let f;try{f=await read();if(f.cleaned)throw Error("Previous fixtures closed")}catch{f={run:'legalqa_20261004_'+randomBytes(3).toString('hex'),project:host,users:{},clubs:{},docs:{}};await save(f)}
for(const club of ['A','B']){
 if(f.clubs[club])continue;
 const id=randomUUID();
 assertOk(await db.from('clubs').insert({id,name:`JETABLE ${f.run} ${club}`,slug:`${f.run}-${club.toLowerCase()}`}));
 f.clubs[club]=id;await save(f);
 assertOk(await db.from('organizations').insert({id,name:`JETABLE ${f.run} ${club}`,org_type:'club',slug:`${f.run}-${club.toLowerCase()}`}));
}
for(const role of ['admin','player','parent','coach','manager','outsider']){
 if(f.users[role])continue;
 const email=`${f.run}.${role}@example.invalid`,password=randomBytes(27).toString('base64url');
 const user=assertOk(await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{first_name:'Fixture',last_name:role,legal_campaign:f.run}})).user;
 f.users[role]={id:user.id,email,password};await save(f);
 assertOk(await db.from('profiles').upsert({id:user.id,first_name:'Fixture',last_name:role,username:`${f.run}_${role}`,app_role:role==='admin'?null:role==='outsider'?'player':role,birth_date:role==='player'?'2012-01-01':'1990-01-01'}));
 if(role==='admin')assertOk(await db.from('app_admins').insert({user_id:user.id}));
 else {const club=f.clubs[role==='outsider'?'B':'A'],r=role==='outsider'?'player':role;
 assertOk(await db.from('club_members').insert({club_id:club,user_id:user.id,role:r,is_active:true,player_consent_status:r==='player'?'granted':null}));
 assertOk(await db.from('organization_members').insert({organization_id:club,user_id:user.id,role:r,is_active:true}));}
 const signed=assertOk(await client(f).auth.signInWithPassword({email,password}));f.users[role].token=signed.session.access_token;await save(f);
}
assertOk(await db.from('player_guardians').upsert({player_id:f.users.player.id,guardian_user_id:f.users.parent.id,relation:'legal_guardian',can_view:true,can_edit:true}));
console.log(JSON.stringify({run:f.run,project:f.project,clubs:f.clubs,users:Object.fromEntries(Object.entries(f.users).map(([k,v])=>[k,v.id]))},null,2));
await safety();
