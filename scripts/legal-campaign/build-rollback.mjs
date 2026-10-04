import {readFile,writeFile} from 'node:fs/promises';
import {read} from './context.mjs';
const f=await read();let repair=await readFile('supabase/migrations/20261102_legal_campaign_repairs.sql','utf8');repair=repair.replace(/notify pgrst, 'reload schema';\s*commit;\s*$/,'');
const id=k=>`'${f.users[k].id}'::uuid`,club=`'${f.clubs.A}'::uuid`,doc=k=>`'${f.docs[k]}'::uuid`;
let sql=repair+`
-- This validation only: the whole candidate batch and all changes ROLLBACK.
create temporary table qa_results(name text,result text,evidence jsonb) on commit drop;
create function pg_temp.qa_check(p_name text,p_ok boolean,p_proof jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin insert into qa_results values(p_name,case when p_ok then 'PASS' else 'FAIL' end,p_proof); end $$;
create function pg_temp.qa_denied(p_name text,p_sql text) returns void language plpgsql as $$
begin
 execute p_sql;
 insert into qa_results values(p_name,'FAIL','{"unexpected_success":true}');
 exception when others then insert into qa_results values(p_name,'PASS',jsonb_build_object('sqlstate',sqlstate,'error',sqlerrm));
end $$;
create function pg_temp.qa_publish(p_doc uuid) returns uuid language plpgsql as $$
declare expected jsonb;begin
 select jsonb_build_object('document',to_jsonb(d)-'id'-'created_at'-'created_by',
 'draft',jsonb_build_object('source_revision',dr.source_revision,'change_summary',dr.change_summary,'allowed_variables',dr.allowed_variables,'translations',dr.translations),
 'latest_version_id',(select id from public.legal_versions where document_id=d.id order by version_number desc limit 1)) into expected
 from public.legal_documents d join public.legal_drafts dr on dr.document_id=d.id where d.id=p_doc;
 return public.publish_legal_draft_checked(p_doc,${id('admin')},expected);end $$;

do $$ declare d uuid;v uuid;v2 uuid;p uuid;q uuid;dec uuid;again uuid;k uuid;record_row record;ch uuid;wrong uuid;loc text;actor uuid;role_name text;current_row public.legal_current_state%rowtype;
begin
 foreach d in array array[${doc('terms')},${doc('optional')},${doc('parent')}] loop
 v:=pg_temp.qa_publish(d);
 perform pg_temp.qa_check('candidate publication four reviewed languages',v is not null,jsonb_build_object('document',d,'version',v));
 update public.legal_documents set active=true where id=d and club_id=${club};
 end loop;
 for record_row in select * from (values (${id('player')},'player','fr'),(${id('parent')},'parent','en'),(${id('coach')},'coach','de'),(${id('manager')},'manager','it')) t(actor,role_name,locale) loop
 actor:=record_row.actor;role_name:=record_row.role_name;loc:=record_row.locale;
 p:=public.present_legal_document(${doc('terms')},actor,actor,role_name,loc);k:=gen_random_uuid();
 dec:=public.decide_legal_document(p,actor,'accepted',k,null);again:=public.decide_legal_document(p,actor,'accepted',k,null);
 perform pg_temp.qa_check('candidate decision and idempotence '||role_name,dec=again and exists(select 1 from public.legal_decisions where id=dec and rendered_snapshot->>'locale'=loc and rendered_snapshot->>'body' not like '%{{%'),jsonb_build_object('decision',dec));
 perform pg_temp.qa_denied('key mismatch '||role_name,format('select public.decide_legal_document(%L,%L,%L,%L,null)',p,actor,'refused',k));
 end loop;
 perform pg_temp.qa_denied('second club presentation',format('select public.present_legal_document(%L,%L,%L,%L,%L)',${doc('terms')},${id('outsider')},${id('outsider')},'player','fr'));
 perform pg_temp.qa_denied('wrong role presentation',format('select public.present_legal_document(%L,%L,%L,%L,%L)',${doc('terms')},${id('player')},${id('player')},'manager','fr'));
 perform pg_temp.qa_denied('unknown locale',format('select public.present_legal_document(%L,%L,%L,%L,%L)',${doc('terms')},${id('player')},${id('player')},'player','es'));
 perform pg_temp.qa_denied('old publication without preview',format('select public.publish_legal_draft_checked(%L,%L,null)',${doc('terms')},${id('admin')}));
 perform pg_temp.qa_denied('immutable decisions',format('update public.legal_decisions set decision=%L where id=%L','refused',dec));
 perform pg_temp.qa_denied('immutable presentations',format('delete from public.legal_presentations where id=%L',p));
 p:=public.present_legal_document(${doc('terms')},${id('player')},${id('player')},'player','fr');
 update public.legal_drafts set source_revision=source_revision+1,change_summary='Fixture v2 rollback',translations=(select jsonb_object_agg(key,value||jsonb_build_object('source_revision',source_revision+1,'body',value->>'body'||' FICTIVE V2')) from jsonb_each(translations)) where document_id=${doc('terms')};
 v2:=pg_temp.qa_publish(${doc('terms')});
 perform pg_temp.qa_denied('stale presentation after version change',format('select public.decide_legal_document(%L,%L,%L,%L,null)',p,${id('player')},'accepted',gen_random_uuid()));
 perform pg_temp.qa_check('prior version remains recorded',exists(select 1 from public.legal_current_state where document_id=${doc('terms')} and beneficiary_id=${id('player')} and version_id<>v2));
 p:=public.present_legal_document(${doc('terms')},${id('player')},${id('player')},'player','fr');
 dec:=public.decide_legal_document(p,${id('player')},'refused',gen_random_uuid(),null);
 perform pg_temp.qa_check('refusal persists',exists(select 1 from public.legal_current_state where document_id=${doc('terms')} and beneficiary_id=${id('player')} and decision='refused' and version_id=v2));
 p:=public.present_legal_document(${doc('optional')},${id('player')},${id('player')},'player','fr');
 perform public.decide_legal_document(p,${id('player')},'consented',gen_random_uuid(),null);
 perform public.decide_legal_document(p,${id('player')},'withdrawn',gen_random_uuid(),null);
 perform pg_temp.qa_denied('withdrawal conflict blocks new consent',format('select public.decide_legal_document(%L,%L,%L,%L,null)',p,${id('player')},'consented',gen_random_uuid()));
 perform public.resolve_legal_withdrawal_conflict(${doc('optional')},${id('player')},${club},${id('admin')},'Fictional conflict review in rollback transaction');
 perform public.decide_legal_document(p,${id('player')},'consented',gen_random_uuid(),null);
 perform pg_temp.qa_check('withdrawal history preserved after resolution',exists(select 1 from public.legal_decisions where document_id=${doc('optional')} and decision='withdrawn'));
 perform pg_temp.qa_denied('guardian link alone insufficient',format('select public.present_legal_document(%L,%L,%L,%L,%L)',${doc('parent')},${id('parent')},${id('player')},'parent','fr'));
 perform public.review_legal_representative(${id('parent')},${id('player')},${club},'verified','Fictional assertion only in rollback transaction',${id('admin')});
 p:=public.present_legal_document(${doc('parent')},${id('parent')},${id('player')},'parent','fr');
 ch:=public.issue_legal_parent_challenge(p,${id('parent')},encode(extensions.digest('${f.users.parent.email}','sha256'),'hex'),encode(extensions.digest('135790','sha256'),'hex'));
 wrong:=public.decide_legal_document(p,${id('parent')},'authorized',gen_random_uuid(),'000000');
 perform pg_temp.qa_check('wrong code attempt persists',wrong is null and exists(select 1 from public.legal_parent_challenges where id=ch and attempts=1));
 k:=gen_random_uuid();dec:=public.decide_legal_document(p,${id('parent')},'authorized',k,'135790');
 perform pg_temp.qa_check('verified parent authority and beneficiary recorded',exists(select 1 from public.legal_decisions where id=dec and beneficiary_id=${id('player')} and authority_snapshot->>'parent_email_confirmed'='true'));
 again:=public.decide_legal_document(p,${id('parent')},'authorized',k,'135790');perform pg_temp.qa_check('parent idempotence after code consumed',again=dec);
 perform pg_temp.qa_denied('consumed code cannot create second decision',format('select public.decide_legal_document(%L,%L,%L,%L,%L)',p,${id('parent')},'authorized',gen_random_uuid(),'135790'));
 perform pg_temp.qa_denied('challenge throttling',format('select public.issue_legal_parent_challenge(%L,%L,%L,%L)',p,${id('parent')},encode(extensions.digest('${f.users.parent.email}','sha256'),'hex'),encode(extensions.digest('246810','sha256'),'hex')));
 perform public.review_legal_representative(${id('parent')},${id('player')},${club},'revoked','Fictional revocation only in rollback transaction',${id('admin')});
 perform pg_temp.qa_denied('revoked authority cannot present',format('select public.present_legal_document(%L,%L,%L,%L,%L)',${doc('parent')},${id('parent')},${id('player')},'parent','fr'));
 perform pg_temp.qa_check('SQL enforcement remains disabled',(select enabled=false from public.legal_enforcement_control where singleton));
end $$;
-- Real PostgreSQL role/claims for RLS and nested-trigger regression.
grant select,insert on qa_results to authenticated,anon;
select set_config('request.jwt.claims','{"sub":"${f.users.player.id}","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.qa_check('Marketplace own club after candidate',(select count(*)>0 from public.marketplace_items where id='${f.business.item}'));
select pg_temp.qa_check('golf hole with recompute trigger after candidate',(public.save_player_golf_hole_transactional('${f.business.round}','{"hole_no":1,"par":4,"score":6,"putts":2}') ->>'ok')::boolean);
reset role;
select set_config('request.jwt.claims','{"sub":"${f.users.outsider.id}","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.qa_check('Marketplace second club after candidate',(select count(*)=0 from public.marketplace_items where id='${f.business.item}'));
select pg_temp.qa_denied('cross-club event RPC after candidate','select public.ensure_event_thread_for_event(''${f.business.event}'')');
select pg_temp.qa_denied('cross-club sync RPC after candidate','select public.sync_event_thread_participants(''${f.business.event}'')');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.qa_check('Marketplace anonymous after candidate',(select count(*)=0 from public.marketplace_items where id='${f.business.item}'));
select pg_temp.qa_denied('anonymous actor lookup after candidate','select public.pick_event_thread_actor_user_id(''${f.business.event}'')');
select pg_temp.qa_denied('anonymous stats after candidate','select public.recompute_golf_round_stats(''${f.business.round}'')');
select pg_temp.qa_denied('anonymous performance sync after candidate','select public.sync_org_player_performance_from_groups(''${f.clubs.A}'')');
reset role;
set local role service_role;
update public.club_events set title='JETABLE rollback trigger check' where id='${f.business.event}';
reset role;
select pg_temp.qa_check('event trigger still updates thread after candidate',(select title='JETABLE rollback trigger check' from public.message_threads where id='${f.business.thread}'));
select set_config('request.jwt.claims','{"sub":"${f.users.manager.id}","role":"authenticated"}',true);
set local role authenticated;
do $$ declare snap jsonb; changed jsonb; begin
 snap:=public.get_manager_planning_snapshot_v1('${f.business.event}');
 changed:=(snap->'event')||'{"location_text":"JETABLE candidate concurrency"}'::jsonb;
 perform public.update_manager_event_occurrence_v1('${f.business.event}',snap,changed,
 array(select jsonb_array_elements_text(snap->'coach_ids')::uuid),array(select jsonb_array_elements_text(snap->'player_ids')::uuid),
 snap->'structure',array(select jsonb_array_elements_text(snap->'criterion_ids')::uuid));
 perform pg_temp.qa_check('candidate Manager occurrence edit persists',(select location_text='JETABLE candidate concurrency' from public.club_events where id='${f.business.event}'));
 begin
  perform public.update_manager_event_occurrence_v1('${f.business.event}',snap,changed,
  array(select jsonb_array_elements_text(snap->'coach_ids')::uuid),array(select jsonb_array_elements_text(snap->'player_ids')::uuid),
  snap->'structure',array(select jsonb_array_elements_text(snap->'criterion_ids')::uuid));
  perform pg_temp.qa_check('candidate stale Manager snapshot returns PT409',false);
 exception when others then perform pg_temp.qa_check('candidate stale Manager snapshot returns PT409',sqlstate='PT409' and sqlerrm='planning_conflict',jsonb_build_object('code',sqlstate,'message',sqlerrm)); end;
end $$;
reset role;
select * from qa_results order by name;
rollback;
`;
await writeFile('docs/legal/26-campaign-candidate-rollback.sql',sql);
