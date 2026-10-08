begin;
-- A reverse migration is valid only before any application/catalog record has
-- changed since preparation. Hashes contain no clear-text personal data.
do $$ declare t record; fingerprint text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname<>'organization_migration_baseline' loop
    execute format('select md5(coalesce(string_agg(to_jsonb(r)::text,'''' order by to_jsonb(r)::text),'''')) from public.%I r',t.relname) into fingerprint;
    insert into public.organization_migration_baseline(object_key,definition)
      values('prepared_table:'||t.relname,fingerprint);
  end loop;
end $$;
commit;
