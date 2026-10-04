import {writeFile} from 'node:fs/promises';import {resultPath,db,read,client,assertOk} from './context.mjs';
const f=await read(),m=client(f,'manager');const snap=assertOk(await m.rpc('get_manager_planning_snapshot_v1',{p_event_id:f.business.event}));
const args={p_event_id:f.business.event,p_expected:snap,p_changes:{...snap.event,location_text:'JETABLE persisted edit'},p_coach_ids:snap.coach_ids,p_player_ids:snap.player_ids,p_structure:snap.structure,p_criterion_ids:snap.criterion_ids};
const update=await m.rpc('update_manager_event_occurrence_v1',args);
const persisted=await db.from('club_events').select('location_text').eq('id',f.business.event).single();
const stale=await m.rpc('update_manager_event_occurrence_v1',{...args,p_changes:{...args.p_changes,location_text:'STALE SHOULD FAIL'}}).abortSignal(AbortSignal.timeout(15000));
const result={name:'manager occurrence edit and optimistic concurrency through nested Coach RPC',result:!update.error&&persisted.data?.location_text==='JETABLE persisted edit'&&stale.error?.code==='PT409'?'PASS':'FAIL',proof:{updateError:update.error,persisted:persisted.data,staleError:stale.error}};
console.log(result);await writeFile(resultPath('event-edit'),JSON.stringify(result,null,2));
