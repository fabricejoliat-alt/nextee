import { restoreOrganizationSchema } from './organizationDatabase.mjs';
import pg from 'pg';
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const root=process.cwd();
const work=process.env.ACTIVITEE_ORG_FIXTURE_DIR;
const baseline=process.env.ACTIVITEE_ORG_BASELINE;
const restBinary=process.env.ACTIVITEE_ORG_POSTGREST_BINARY;
if(!work||!baseline||!restBinary)throw new Error('Fixture directory, schema-only baseline and native PostgREST binary are required');
const secret='isolated-local-organization-fixture-signing-secret';
const users={};
function jwt(role,sub){const data=[{alg:'HS256',typ:'JWT'},{role,sub,iss:'local-fixture',aud:'authenticated',exp:Math.floor(Date.now()/1000)+86400}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
const keys={anon:jwt('anon',randomUUID()),service:jwt('service_role',randomUUID())};
// Dedicated loopback database only. Never accepts a remote connection string.
const client=new pg.Client({host:'127.0.0.1',port:55439,user:'postgres',database:'org_fixture'});await client.connect();
const db={exec:sql=>client.query(sql),query:(sql,args)=>client.query(sql,args),close:()=>client.end()};
await restoreOrganizationSchema(db,{baselinePath:baseline});
await db.exec("set request.jwt.claim.role='service_role'; set request.jwt.claim.sub='';");
async function scalar(sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
for(const name of ['admin','sionManager','academyManager','coach','player','parent','externalPlayer','externalParent','outsider']){
 const id=randomUUID();users[name]={id,email:`${name.toLowerCase()}@fixtures.invalid`,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{first_name:name,last_name:'Fixture'}};
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,users[name].email]);
 await db.query('insert into public.profiles(id,first_name,last_name,birth_date,username,app_role) values($1,$2,$3,$4,$5,$6)',[id,name,'Fixture',name==='player'||name==='externalPlayer'?'2012-01-01':'1980-01-01',`fixture.${name}`,name==='admin'?null:name.includes('Manager')?'manager':name.includes('Parent')||name==='parent'?'parent':name==='coach'?'coach':'player']);
}
await db.query('insert into public.app_admins(user_id) values($1)',[users.admin.id]);
const organizations={};
for(const [label,type] of [['Sion','club'],['Centre','academy'],['External','club']])organizations[label]=await scalar('select public.create_organization_checked($1,$2,$3,$4)',[users.admin.id,`Fixture ${label}`,`fixture-${label.toLowerCase()}`,type]);
for(const [label,name,role] of [['Sion','sionManager','manager'],['Centre','academyManager','manager'],['Centre','coach','coach'],['Sion','player','player'],['Sion','parent','parent']])await db.query('insert into public.organization_members(organization_id,user_id,role,player_consent_status) values($1,$2,$3,$4)',[organizations[label],users[name].id,role,role==='player'?'pending':null]);
await db.query("select public.manage_player_guardian_v1($1,$2,$3,$4,'upsert','father',true)",[users.sionManager.id,organizations.Sion,users.player.id,users.parent.id]);
await db.exec("insert into public.legal_enforcement_control(singleton,enabled) values(true,true); insert into public.legal_parent_code_control(singleton,required) values(true,false)");
const docs={};
for(const label of ['Sion','Centre']){
 const doc=await scalar(`insert into public.legal_documents(document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,active,applicability,created_by) values($1,'parent_authorization','service.parent_authorization','organization',$2,array['parent'],'authorize',true,true,'{"status":"approved","rule":"all_members"}',$3) returning id`,[`fixture_${label.toLowerCase()}_parent`,organizations[label],users.admin.id]);docs[label]=doc;
 const translations=Object.fromEntries(['fr','en','de','it'].map(locale=>[locale,{title:'{{organization_name}}',body:'Fixture {{child_name}} · {{organization_name}}',action_label:'OK',status:'approved',source_revision:1}]));
 await db.query('insert into public.legal_drafts(document_id,change_summary,allowed_variables,translations,updated_by) values($1,$2,$3,$4,$5)',[doc,'Fixture reviewed',['organization_name','child_name'],translations,users.admin.id]);
 await db.query('select public.publish_legal_draft($1,$2)',[doc,users.admin.id]);
 if(label==='Sion'){const p=await scalar("select public.present_legal_document($1,$2,$3,'parent','fr')",[doc,users.parent.id,users.player.id]);await db.query("select public.decide_legal_document($1,$2,'authorized',gen_random_uuid())",[p,users.parent.id]);}
}
await db.query("select public.set_academy_partnership_checked($1,$2,$3,'active',true,true,0)",[users.admin.id,organizations.Centre,organizations.Sion]);
const entry=await scalar("select public.request_academy_roster_checked($1,$2,$3,'activitee_club',$4)",[users.academyManager.id,organizations.Centre,users.player.id,organizations.Sion]);
const group=await scalar('insert into public.coach_groups(club_id,name,head_coach_user_id) values($1,$2,$3) returning id',[organizations.Centre,'Fixture Performance',users.coach.id]);
await db.query('insert into public.coach_group_players(group_id,player_user_id) values($1,$2)',[group,users.player.id]);
await db.query('insert into public.coach_group_coaches(group_id,coach_user_id) values($1,$2)',[group,users.coach.id]);
const reference=await scalar("select public.create_external_reference_checked($1,$2,'Fixture Outside','CH','VS')",[users.academyManager.id,organizations.Centre]);
for(const [name,kind] of [['externalPlayer','player'],['externalParent','parent']]){
 const match=await scalar('select public.request_organization_identity_checked($1,$2,$3,$4)',[users.academyManager.id,organizations.Centre,`fixture.${name}`,kind]);
 await db.query('select public.review_organization_identity_checked($1,$2,true,$3)',[users.admin.id,match,'Fictitious human identity verification for isolated QA']);
}
const externalEntry=await scalar("select public.request_academy_roster_checked($1,$2,$3,'external_club',null,$4)",[users.academyManager.id,organizations.Centre,users.externalPlayer.id,reference]);
await db.query("select public.attach_academy_guardian_checked($1,$2,$3,'mother')",[users.academyManager.id,externalEntry,users.externalParent.id]);
const externalPresentation=await scalar("select public.present_legal_document($1,$2,$3,'parent','fr')",[docs.Centre,users.externalParent.id,users.externalPlayer.id]);
await db.query("select public.decide_legal_document($1,$2,'authorized',gen_random_uuid())",[externalPresentation,users.externalParent.id]);
await db.query("select public.set_academy_roster_status_checked($1,$2,'active',1)",[users.academyManager.id,externalEntry]);
await db.query('select public.claim_external_club_checked($1,$2,$3)',[users.admin.id,reference,organizations.External]);
await db.query('select public.confirm_external_affiliation_checked($1,$2,$3,$4,$5)',[users.admin.id,reference,users.externalPlayer.id,organizations.External,'Fictitious reviewed club affiliation for isolated QA']);
await db.exec("set request.jwt.claim.role='service_role'; set request.jwt.claim.sub=''; grant anon,authenticated,service_role to postgres;");

writeFileSync(`${work}/postgrest.conf`,`db-uri = "postgresql://postgres@127.0.0.1:55439/org_fixture?sslmode=disable"\ndb-schemas = "public"\ndb-anon-role = "anon"\ndb-pool = 1\ndb-channel-enabled = false\ndb-prepared-statements = false\nserver-port = 4009\nserver-host = "127.0.0.1"\njwt-secret = "${secret}"\n`);
const rest=spawn(restBinary,[`${work}/postgrest.conf`],{stdio:['ignore','pipe','pipe']});rest.stdout.pipe(process.stdout);rest.stderr.pipe(process.stderr);
const reply=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-activitee-organization,prefer,range,accept-profile,content-profile','Access-Control-Allow-Methods':'*'});res.end(JSON.stringify(obj));};
const server=createServer(async(req,res)=>{
 try {
 if(req.method==='OPTIONS')return reply(res,200,{});
 if(req.url.startsWith('/rest/v1')){const parts=[];for await(const p of req)parts.push(p);const body=Buffer.concat(parts);const response=await fetch('http://127.0.0.1:4009'+req.url.slice(8),{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([key])=>!['host','connection','content-length'].includes(key))),body:body.length?body:undefined});res.writeHead(response.status,{...Object.fromEntries([...response.headers].filter(([key])=>!['content-length','content-encoding'].includes(key)&&!key.startsWith('access-control-'))),'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'*'});return res.end(Buffer.from(await response.arrayBuffer()));}
 const parts=[];for await(const p of req)parts.push(p);let input={};try{input=JSON.parse(Buffer.concat(parts).toString());}catch{}
 let claims={};try{claims=JSON.parse(Buffer.from((req.headers.authorization??'').split(' ')[1]?.split('.')[1]??'','base64url'));}catch{}
 const user=Object.values(users).find(u=>u.id===claims.sub);
 if(req.url.startsWith('/auth/v1/token')){const found=Object.values(users).find(u=>u.email===input.email)||user;if(!found)return reply(res,400,{msg:'Fixture account required'});return reply(res,200,{access_token:jwt('authenticated',found.id),refresh_token:jwt('authenticated',found.id),expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user:found});}
 if(req.url.startsWith('/auth/v1/admin/users')) {
   if(claims.role!=='service_role')return reply(res,403,{message:'Fixture admin key required'});
   const id=req.url.split('/')[5]?.split('?')[0];
   if(req.method==='GET')return reply(res,200,id?Object.values(users).find(u=>u.id===id)??{message:'No user'}:{users:Object.values(users),aud:'authenticated',next_page:null,last_page:1,total:Object.keys(users).length});
   if(req.method==='POST'){
     if(Object.values(users).some(u=>u.email===input.email))return reply(res,422,{message:'Email exists'});
     const created={id:randomUUID(),email:input.email,role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:input.user_metadata??{},created_at:new Date().toISOString()};users['new'+created.id]=created;
     await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[created.id,created.email,created.user_metadata]);return reply(res,200,created);
   }
   if(req.method==='DELETE'){await db.query('delete from auth.users where id=$1',[id]);return reply(res,200,{});}
 }
 if(req.url==='/auth/v1/user')return reply(res,user?200:401,user??{message:'Fixture token required'});
 if(req.url.startsWith('/auth/v1/logout'))return reply(res,200,{});
 if(req.url.startsWith('/realtime'))return reply(res,503,{message:'Realtime is not emulated'});
 return reply(res,404,{message:'Local fixture gateway only'});
 }catch(e){reply(res,500,{message:e.message});}
});await new Promise(resolve=>server.listen(4008,'127.0.0.1',resolve));
writeFileSync(`${work}/fixture-state.json`,JSON.stringify({users,organizations,docs,entry,group,reference,externalEntry,keys,tokens:Object.fromEntries(Object.entries(users).map(([key,user])=>[key,jwt('authenticated',user.id)]))},null,2));
writeFileSync(`${work}/launch-next.mjs`,`import {spawn} from 'node:child_process';const child=spawn('npx',['next','dev','--port','3011'],{cwd:${JSON.stringify(root)},stdio:'inherit',env:{...process.env,ACTIVITEE_ORGANIZATION_FIXTURE:'1',SUPABASE_URL:'http://127.0.0.1:4008',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4008',NEXT_PUBLIC_SUPABASE_ANON_KEY:${JSON.stringify(keys.anon)},SUPABASE_SERVICE_ROLE_KEY:${JSON.stringify(keys.service)},PERIODIC_REPORT_TRANSPORT:'mock',PARENT_CONFIRMATION_TRANSPORT:'mock',VAPID_PRIVATE_KEY:'',NEXT_PUBLIC_VAPID_PUBLIC_KEY:'',RESEND_API_KEY:'',SENDGRID_API_KEY:''}});process.on('SIGINT',()=>child.kill('SIGINT'));`);
console.log('LOCAL FIXTURE GATEWAY READY: 4008, PostgREST 4009');
process.on('SIGINT',async()=>{server.close();rest.kill('SIGINT');await db.close();process.exit(0)});
