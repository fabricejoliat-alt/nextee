import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const actor='11111111-1111-4111-8111-111111111111';
const child='22222222-2222-4222-8222-222222222222';
const presentation='33333333-3333-4333-8333-333333333333';
const document='44444444-4444-4444-8444-444444444444';
const key='55555555-5555-4555-8555-555555555555';

test('parent AI migration skips only the configured second code and preserves verified-account evidence', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth;
   create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
   create table legal_parent_code_control(singleton boolean primary key,required boolean,updated_at timestamptz,allowed boolean default true);
   insert into legal_parent_code_control values(true,true,now(),true);
   create table legal_documents(id uuid,kind text,purpose_key text);
   create table legal_presentations(id uuid,document_id uuid,actor_id uuid,beneficiary_id uuid,actor_role text,authority text);
   create table decision_evidence(confirmation_method text,parent_email_confirmed boolean);
   insert into auth.users values('${actor}','parent@example.invalid',now());
   insert into legal_documents values('${document}','specific_consent','coaching.rewrite');
   insert into legal_presentations values('${presentation}','${document}','${actor}','${child}','parent','verified_representative');
   create function legal_document_actor_allowed(uuid,uuid,uuid,text) returns boolean language sql as $$select allowed from legal_parent_code_control where singleton$$;
   create function decide_legal_document(p_presentation uuid,p_actor uuid,p_decision text,p_key uuid,p_parent_code text default null) returns uuid language plpgsql as $function$
   declare p legal_presentations%rowtype; d legal_documents%rowtype; code_required boolean;parent_email_verified boolean:=false;confirmation_method text:='none';
   begin
    select * into p from legal_presentations where id=p_presentation;
    select * into d from legal_documents where id=p.document_id;
    if p.actor_id<>p_actor or not legal_document_actor_allowed(d.id,p_actor,p.beneficiary_id,p.actor_role) then raise exception 'Access changed'; end if;
    if p.actor_id<>p.beneficiary_id and p_decision not in ('refused','withdrawn') then
     select required into code_required from legal_parent_code_control where singleton;
     if d.kind='parent_authorization' and d.purpose_key='service.parent_authorization' and not code_required then
      select exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null and nullif(btrim(u.email),'') is not null and lower(btrim(u.email)) not like '%@noemail.local') into parent_email_verified;
      if not parent_email_verified then raise exception 'Verified parent email required'; end if;
      confirmation_method:='verified_parent_account';
     else
      if p_parent_code is distinct from 'valid-test-code' then raise exception 'Confirmation required'; end if;
      parent_email_verified:=true;confirmation_method:='email_code';
     end if;
    end if;
    insert into decision_evidence values(confirmation_method,parent_email_verified);
    return p_key;
   end $function$;`);
  const migration=readFileSync('supabase/migrations/20261216_parent_ai_consent_without_code.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  const decide=()=>db.query('select decide_legal_document($1,$2,$3,$4,null)',[presentation,actor,'consented',key]);
  await decide();
  assert.deepEqual((await db.query('select * from decision_evidence')).rows,[{confirmation_method:'verified_parent_account',parent_email_confirmed:true}]);
  await db.exec("update legal_documents set purpose_key='coaching.ai'");await decide();
  await db.exec('update legal_parent_code_control set required=true');await assert.rejects(decide,/Confirmation required/);
  await db.exec('update legal_parent_code_control set required=false,allowed=false');await assert.rejects(decide,/Access changed/);
  await db.exec('update legal_parent_code_control set allowed=true');
  for(const email of [null,'','parent@noemail.local']) {
   await db.query('update auth.users set email=$1',[email]);await assert.rejects(decide,/Verified parent email required/);
  }
  await db.exec("update auth.users set email='parent@example.invalid',email_confirmed_at=null");await assert.rejects(decide,/Verified parent email required/);
  await db.exec('update auth.users set email_confirmed_at=now()');
  await db.exec("update legal_presentations set authority='club_linked_parent'");await assert.rejects(decide,/Confirmation required/);
  await db.exec("update legal_presentations set authority='verified_representative',actor_role='coach'");await assert.rejects(decide,/Confirmation required/);
  await db.exec("update legal_presentations set actor_role='parent';update legal_documents set purpose_key='other'");await assert.rejects(decide,/Confirmation required/);
  assert.equal((await db.query('select count(*)::int as count from decision_evidence')).rows[0].count,2);
 } finally {await db.close();}
});
