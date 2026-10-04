import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile} from 'node:fs/promises';
export const host='wizbeuuvjibmmuxyynly.supabase.co';
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host!==host) throw Error('TEST project mismatch');
if(process.env.LEGAL_ENFORCEMENT_ENABLED==='true'||process.env.LEGAL_PARENT_MAIL_ENABLED==='true') throw Error('Campaign requires enforcement and mail disabled');
export const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export const origin=process.env.LEGAL_CAMPAIGN_ORIGIN??'http://127.0.0.1:3000';
if(!['http://127.0.0.1:3000','https://test.activitee.golf'].includes(origin))throw Error('Campaign origin must be local or TEST');
export const phase=process.env.LEGAL_CAMPAIGN_PHASE??'';
if(!['','deployed'].includes(phase))throw Error('Unknown campaign phase');
export const suffix=phase?'-'+phase:'';
export const temp=`/private/tmp/activitee-legal-campaign-20261004${suffix}.json`;
export const resultPath=name=>`docs/legal/evidence/20261004${suffix}-${name}.json`;
export const evidence=resultPath('http-results');
export const assertOk=(r)=>{if(r.error)throw Error(r.error.message);return r.data};
export async function safety(){const c=assertOk(await db.from('legal_enforcement_control').select('enabled').single());if(c.enabled!==false)throw Error('SQL gate must remain off');}
export const read=async()=>JSON.parse(await readFile(temp,'utf8'));
export const save=async(f)=>writeFile(temp,JSON.stringify(f,null,2),{mode:0o600});
export async function api(f,role,path,body,method){const response=await fetch(`${origin}${path}`,{redirect:'error',signal:AbortSignal.timeout(30000),method:method??(body?'POST':'GET'),headers:{...(role?{Authorization:`Bearer ${f.users[role].token}`} : {}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
export const client=(f,role)=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:role?{headers:{Authorization:`Bearer ${f.users[role].token}`}}:undefined});
export async function refreshFixtureSessions(f){for(const u of Object.values(f.users)){const signed=assertOk(await client(f).auth.signInWithPassword({email:u.email,password:u.password}));u.token=signed.session.access_token;}await save(f);}
