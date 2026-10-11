import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('parent authorization policy migration creates the missing control and preserves the decision function', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create table auth.users(id uuid, email text, email_confirmed_at timestamptz);
      create table public.legal_parent_code_control (
        singleton boolean primary key default true check(singleton),
        required boolean not null default true,
        updated_at timestamptz not null default now()
      );
      create function public.decide_legal_document(uuid,uuid,text,uuid,text)
      returns uuid language plpgsql as $function$
      declare parent_email_verified boolean; confirmation_method text := 'temporarily_waived';
      begin
        select exists(select 1 from auth.users u where u.id=$2 and u.email_confirmed_at is not null
          and nullif(btrim(u.email),'') is not null) into parent_email_verified;
        if $3='consented' then confirmation_method:='email_code'; end if;
        return $2;
      end $function$;
    `);
    const migration = readFileSync('supabase/migrations/20261129_parent_authorization_without_code.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const control = await db.query('select required from public.legal_parent_code_control where singleton');
    assert.deepEqual(control.rows, [{ required: false }]);
    const result = await db.query(`select pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure) as definition`);
    const definition = result.rows[0].definition;
    assert.match(definition, /verified_parent_account/);
    assert.match(definition, /not like '%@noemail\.local'/);
    assert.match(definition, /email_code/);
    assert.doesNotMatch(definition, /temporarily_waived/);
  } finally {
    await db.close();
  }
});
