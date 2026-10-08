import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { historyCheckpoint,historyAssertion } from '../../scripts/organizations/test-history-preservation.mjs';
import { migrationBundle } from '../../scripts/organizations/migration-bundle.mjs';
export async function applyOrganizationMigrations(db) {
  await db.exec('begin;\n'+historyCheckpoint()+migrationBundle()+historyAssertion()+'\ncommit;');
}
export async function organizationDatabase({baselinePath=process.env.ACTIVITEE_ORG_BASELINE,beforeMigrations,migrate=true,prerequisites=true}={}) {
  if (!baselinePath) throw new Error('Set ACTIVITEE_ORG_BASELINE to a schema-only export');
  const db=new PGlite({extensions:{pgcrypto,uuid_ossp}});
  await restoreOrganizationSchema(db,{baselinePath,beforeMigrations,migrate,prerequisites});
  return db;
}

export async function restoreOrganizationSchema(db,{baselinePath,beforeMigrations,migrate=true,prerequisites=true}) {
  await db.exec(`do $roles$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $roles$; do $roles$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $roles$; do $roles$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $roles$;
    do $roles$ begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if; end $roles$; do $roles$ begin if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if; end $roles$; do $roles$ begin if not exists(select 1 from pg_roles where rolname='dashboard_user') then create role dashboard_user nologin; end if; end $roles$;
    create schema auth; create schema extensions; create schema storage;
    create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',auth.role(),'sub',auth.uid())$$;
    grant usage on schema auth,public to authenticated,anon,service_role;`);
  await db.exec(readFileSync(baselinePath,'utf8').replace(/^\\.*$/gm,'')
    .replace('CREATE SCHEMA public;','CREATE SCHEMA IF NOT EXISTS public;').replace(/^ALTER DEFAULT PRIVILEGES[^;]+;/gm,''));
  if(prerequisites){
  await db.exec(readFileSync('supabase/migrations/20261109_seed_ftem_on_new_club.sql','utf8'));
  const bootstrap=readFileSync('supabase/bootstrap/club-legal-templates-zurich.sql','utf8');
  await db.exec(bootstrap.slice(bootstrap.indexOf('create table public.legal_club_templates')));
  for(const purpose of ['service.parent_authorization','coaching.rewrite','coaching.ai']) {
    const tr=Object.fromEntries(['fr','en','de','it'].map(locale=>[locale,{title:'{{club_name}}',body:'Fixture {{club_name}}',action_label:'OK'}]));
    await db.query(`insert into public.legal_club_templates(purpose_key,kind,audience_roles,action_kind,required,applicability,required_locales,allowed_variables,translations,source_catalog_sha256)
      values($1,$2,array['parent'],$3,true,'{"status":"approved","rule":"all_members"}',array['fr','en','de','it'],array['club_name'],$4,repeat('0',64))`,
      [purpose,purpose.startsWith('service')?'parent_authorization':'specific_consent',purpose.startsWith('service')?'authorize':'consent',tr]);
  }
  }
  if (beforeMigrations) await beforeMigrations(db);
  if (migrate) await applyOrganizationMigrations(db);
  await db.exec("set row_security=on");
  return db;
}
