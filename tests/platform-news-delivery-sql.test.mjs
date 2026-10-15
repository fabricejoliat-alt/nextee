import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('platform publication queues authorized recipients once, preserves targeting and claims each push once', async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key);
      create table platform_news(id uuid primary key,created_by uuid,updated_by uuid,status text,scheduled_for timestamptz,published_at timestamptz);
      create table platform_news_clubs(news_id uuid,club_id uuid,target_roles text[]);
      create table platform_news_translations(news_id uuid,locale text,title text,summary text);
      create table club_members(user_id uuid,club_id uuid,role text,is_active boolean);
      create table player_guardian_scopes(guardian_user_id uuid,player_id uuid,organization_id uuid,status text,can_view boolean);
      create table user_notification_preferences(user_id uuid,receive_in_app boolean,enabled_kinds text[]);
      create table notifications(id uuid primary key default gen_random_uuid(),actor_user_id uuid,type text,kind text,title text,body text,data jsonb);
      create table notification_recipients(id uuid primary key default gen_random_uuid(),notification_id uuid,user_id uuid);
      create function is_app_admin(actor uuid) returns boolean language sql as $$ select actor='${id(1)}'::uuid $$;
      create function organization_actor_legal_ready(org uuid,actor uuid) returns boolean language sql as $$ select actor<>'${id(7)}'::uuid $$;
      create function organization_actor_access(org uuid,actor uuid,child uuid) returns boolean language sql as $$ select actor<>'${id(8)}'::uuid $$;
      insert into profiles select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,10) n;
      insert into platform_news values('${id(20)}','${id(1)}','${id(1)}','published',null,now());
    `);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261015_platform_news_notifications.sql',import.meta.url),'utf8'));
    // The historical publication is deliberately not broadcast by deployment.
    assert.equal((await db.query(`select notification_initialized_at is not null as initialized from platform_news`)).rows[0].initialized,true);
    await db.exec(`
      insert into platform_news values('${id(21)}','${id(1)}','${id(1)}','published',null,now(),null);
      insert into platform_news values('${id(22)}','${id(1)}','${id(1)}','scheduled',now()-interval '1 hour',null,null);
      insert into platform_news values('${id(23)}','${id(1)}','${id(1)}','draft',null,null,null);
      insert into platform_news_clubs select n,'${id(30)}',array['player','coach'] from unnest(array['${id(20)}','${id(21)}','${id(22)}','${id(23)}']::uuid[]) n;
      insert into platform_news_clubs values('${id(21)}','${id(31)}',array['player']);
      insert into platform_news_translations select n,'fr','Titre FR','Résumé FR' from unnest(array['${id(20)}','${id(21)}','${id(22)}','${id(23)}']::uuid[]) n;
      insert into platform_news_translations values('${id(21)}','de','Titel DE','Zusammenfassung');
      insert into club_members values
        ('${id(2)}','${id(30)}','player',true),('${id(2)}','${id(31)}','player',true),
        ('${id(3)}','${id(30)}','coach',true),('${id(3)}','${id(30)}','player',true),
        ('${id(4)}','${id(30)}','manager',true),('${id(5)}','${id(30)}','player',false),
        ('${id(6)}','${id(30)}','player',true),('${id(7)}','${id(30)}','player',true),
        ('${id(8)}','${id(30)}','player',true),('${id(9)}','${id(32)}','player',true);
      insert into user_notification_preferences values('${id(6)}',false,'{}');
      insert into player_guardian_scopes values('${id(10)}','${id(2)}','${id(30)}','active',true);
    `);
    const enqueue = async (n, catchup=false) => (await db.query('select enqueue_platform_news_notifications($1,$2) as result',[id(n),catchup])).rows[0].result;
    assert.equal((await enqueue(20)).created,0);
    assert.equal((await enqueue(23)).created,0);
    assert.equal((await enqueue(21)).created,3); // player, coach (deduplicated), scoped parent
    assert.equal((await enqueue(21)).created,0);
    assert.equal((await enqueue(21,true)).created,0);
    const notices=(await db.query(`select user_id,data from notification_recipients r join notifications n on n.id=r.notification_id where data->>'platform_news_id'=$1`,[id(21)])).rows;
    assert.deepEqual(notices.map(row=>row.user_id).sort(),[id(2),id(3),id(10)]);
    assert.equal(notices.find(row=>row.user_id===id(3)).data.url,'/coach/news');
    const parent=notices.find(row=>row.user_id===id(10));
    assert.equal(parent.data.child_id,id(2));
    assert.equal(parent.data.template_params_by_locale.de.newsTitle,'Titel DE');
    assert.equal(parent.data.template_params_by_locale.it.newsTitle,'Titre FR');
    assert.equal((await enqueue(22)).created,3);
    assert.equal((await db.query('select status from platform_news where id=$1',[id(22)])).rows[0].status,'published');
    const claim = async () => (await db.query('select * from claim_platform_news_push_deliveries($1,20)',[id(21)])).rows;
    assert.equal((await claim()).length,3);
    assert.equal((await claim()).length,0);
    await db.exec(`update platform_news_notification_deliveries set claimed_at=now()-interval '20 minutes' where news_id='${id(21)}'`);
    assert.equal((await claim()).length,0);
    assert.equal((await db.query(`select count(*)::int as n from platform_news_notification_deliveries where news_id=$1 and push_status='uncertain'`,[id(21)])).rows[0].n,3);
    assert.equal((await enqueue(20,true)).created,3);
    const grants=await db.query("select has_function_privilege('authenticated','enqueue_platform_news_notifications(uuid,boolean)','execute') as client,has_function_privilege('service_role','enqueue_platform_news_notifications(uuid,boolean)','execute') as service");
    assert.deepEqual(grants.rows[0],{client:false,service:true});
  } finally { await db.close(); }
});
