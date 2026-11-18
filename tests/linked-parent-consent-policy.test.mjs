import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const actor='11111111-1111-4111-8111-111111111111';
const child='22222222-2222-4222-8222-222222222222';
const org='33333333-3333-4333-8333-333333333333';
const document='44444444-4444-4444-8444-444444444444';
const key='55555555-5555-4555-8555-555555555555';

test('linked organization parents decide without manual review while scope, revocation and email checks remain', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth;
   create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
   create table organization_members(user_id uuid,organization_id uuid,role text,is_active boolean,player_consent_status text);
   create table player_guardian_scopes(guardian_user_id uuid,player_id uuid,organization_id uuid,status text,can_view boolean,can_edit boolean);
   create table player_guardians(guardian_user_id uuid,player_id uuid,relation text);
   create table legal_representative_assertions(guardian_id uuid,child_id uuid,club_id uuid,status text);
   create table academy_roster_entries(academy_id uuid,player_id uuid,status text,origin_type text,source_approved_at timestamptz);
   create table legal_documents(id uuid,club_id uuid,scope text,kind text,purpose_key text);
   create table legal_presentations(id uuid primary key,document_id uuid,actor_id uuid,beneficiary_id uuid,actor_role text,authority text);
   create table legal_parent_code_control(singleton boolean primary key,required boolean);
   create table decision_evidence(authority text,confirmation_method text,decision text);
   create function is_app_admin(uuid) returns boolean language sql as $$ select false $$;
   create function legal_version_matches_document(uuid,uuid) returns boolean language sql as $$select true$$;
   insert into auth.users values('${actor}','parent@example.invalid',now());
   insert into organization_members values('${actor}','${org}','parent',true,null),('${child}','${org}','player',true,'pending');
   insert into player_guardian_scopes values('${actor}','${child}','${org}','pending',true,true);
   insert into player_guardians values('${actor}','${child}','parent');
   insert into legal_documents values('${document}','${org}','organization','specific_consent','coaching.ai');
   insert into legal_parent_code_control values(true,false);`);
  const organizationMigration=readFileSync('supabase/migrations/20261112_organization_access_legal.sql','utf8');
  for(const name of ['organization_guardian_allowed','legal_actor_allowed','legal_document_actor_allowed']) {
   const expression=new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i');
   const definition=organizationMigration.match(expression)?.[0];assert.ok(definition,name);
   await db.exec(definition.replace("('father','mother','legal_guardian')","('parent','father','mother','legal_guardian')"));
  }
  await db.exec(`create function present_legal_document(p_document uuid,p_actor uuid,p_beneficiary uuid,p_role text,p_locale text)
   returns uuid language plpgsql as $function$
   declare d legal_documents%rowtype; a text;
   begin
    select * into d from legal_documents where id=p_document;
    if not legal_document_actor_allowed(d.id,p_actor,p_beneficiary,p_role) then raise exception 'Forbidden'; end if;
    if not legal_version_matches_document(d.id,d.id) then raise exception 'Published metadata changed'; end if;
    a:=case when p_actor=p_beneficiary then 'self'
     when public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) then 'verified_representative'
     else 'club_linked_parent' end;
    insert into legal_presentations values(d.id,d.id,p_actor,p_beneficiary,p_role,a)
     on conflict(id) do update set authority=excluded.authority;
    return d.id;
   end $function$;
   create function decide_legal_document(p_presentation uuid,p_actor uuid,p_decision text,p_key uuid,p_parent_code text default null)
   returns uuid language plpgsql as $function$
   declare p legal_presentations%rowtype;d legal_documents%rowtype;code_required boolean;parent_email_verified boolean:=false;confirmation_method text:='none';
   begin
    select * into p from legal_presentations where id=p_presentation;
    select * into d from legal_documents where id=p.document_id;
    if p.actor_id<>p_actor or not legal_document_actor_allowed(d.id,p_actor,p.beneficiary_id,p.actor_role) then raise exception 'Access changed'; end if;
    if p.actor_id<>p.beneficiary_id and p_decision not in ('refused','withdrawn') then
     select required into code_required from legal_parent_code_control where singleton;
     if not code_required and ((d.kind='parent_authorization' and d.purpose_key='service.parent_authorization') or (d.kind='specific_consent' and d.purpose_key in ('coaching.ai','coaching.rewrite') and p.actor_role='parent' and p.authority='verified_representative')) then
      select exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
       and nullif(btrim(u.email),'') is not null and lower(btrim(u.email)) not like '%@noemail.local') into parent_email_verified;
      if not parent_email_verified then raise exception 'Verified parent email required';end if;
      confirmation_method:='verified_parent_account';
     else
      if p_parent_code is distinct from 'valid-test-code' then raise exception 'Confirmation required';end if;
      confirmation_method:='email_code';
     end if;
    end if;
    insert into decision_evidence values(p.authority,confirmation_method,p_decision);
    return p_key;
   end $function$;`);
  const allowed=async(role='parent',organization=org)=>(await db.query('select legal_actor_allowed($1,$2,$3,$4) as allowed',[actor,child,organization,role])).rows[0].allowed;
  assert.equal(await allowed(),false);
  const migration=readFileSync('supabase/migrations/20261217_linked_parent_consent_without_admin_review.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  assert.equal(await allowed(),true);
  assert.equal(await allowed('coach'),false);
  assert.equal(await allowed('parent',key),false);
  assert.equal(await allowed('parent',null),false);
  assert.deepEqual((await db.query('select * from legal_representative_assertions')).rows,[]);
  const present=()=>db.query('select present_legal_document($1,$2,$3,$4,$5)',[document,actor,child,'parent','fr']);
  const decide=()=>db.query('select decide_legal_document($1,$2,$3,$4,null)',[document,actor,'consented',key]);
  await present();await decide();
  assert.deepEqual((await db.query('select * from decision_evidence')).rows,[{authority:'club_linked_parent',confirmation_method:'verified_parent_account',decision:'consented'}]);
  assert.equal((await db.query("select player_consent_status from organization_members where role='player'")).rows[0].player_consent_status,'pending');
  await db.exec('update player_guardian_scopes set can_edit=false');assert.equal(await allowed(),false);await assert.rejects(decide,/Access changed/);
  await db.exec("update player_guardian_scopes set can_edit=true,status='revoked'");assert.equal(await allowed(),false);
  await db.exec("update player_guardian_scopes set status='active',can_view=false");assert.equal(await allowed(),false);
  await db.exec('update player_guardian_scopes set can_view=true');
  await db.exec("update organization_members set is_active=false where role='parent'");assert.equal(await allowed(),false);
  await db.exec("update organization_members set is_active=true where role='parent';update organization_members set is_active=false where role='player'");assert.equal(await allowed(),false);
  await db.exec("update organization_members set is_active=true;update player_guardians set relation='other'");assert.equal(await allowed(),false);
  await db.exec("update player_guardians set relation='parent'");
  await db.exec(`insert into legal_representative_assertions values('${actor}','${child}','${org}','revoked')`);
  assert.equal(await allowed(),false);await assert.rejects(present,/Forbidden/);
  await db.exec("update legal_representative_assertions set status='verified';update player_guardians set relation='other'");
  assert.equal(await allowed(),true);await present();
  assert.equal((await db.query('select authority from legal_presentations')).rows[0].authority,'verified_representative');
  await db.exec('update auth.users set email_confirmed_at=null');await assert.rejects(decide,/Verified parent email required/);
  await db.exec("update auth.users set email_confirmed_at=now(),email='parent@noemail.local'");await assert.rejects(decide,/Verified parent email required/);
  await db.exec("update auth.users set email='parent@example.invalid';update legal_parent_code_control set required=true");await assert.rejects(decide,/Confirmation required/);
 }finally{await db.close();}
});
