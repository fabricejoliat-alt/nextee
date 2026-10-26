import test from 'node:test';
import assert from 'node:assert/strict';
import {loadManagerModule,managerDatabase} from './helpers/managerRouteHarness.ts';

function fixture(failureTable?: string) {
  const players=Array.from({length:82},(_,index)=>({id:`player-${String(index).padStart(3,'0')}`,first_name:`Junior ${index}`,last_name:'Fixture'}));
  const days=Array.from({length:25},(_,index)=>({id:`day-${index}`,event_id:`event-${String(index).padStart(2,'0')}`,camp_id:'camp',day_index:index,
    starts_at:'2026-07-01T08:00:00Z',ends_at:'2026-07-01T16:00:00Z',responsible_coach_id:index===0?'day-coach':null,club_events:{status:'scheduled'}}));
  const attendees=days.flatMap(day=>players.map((player,index)=>({event_id:day.event_id,player_id:player.id,status:day.day_index>=20&&index<17?'present':day.day_index>=20&&index===17?'absent':'not_registered'})));
  const state=managerDatabase({
    club_members:[{user_id:'manager',club_id:'club',role:'manager',is_active:true},...players.map(p=>({user_id:p.id,club_id:'club',role:'player',is_active:true}))],
    organizations:[{id:'club',name:'Fixture'}],
    club_camps:[{id:'camp',club_id:'club',title:'Summer',head_coach_user_id:'head'}, {id:'outside',club_id:'other',title:'Other'}],
    club_camp_days:days,
    club_camp_players:players.map((p,index)=>({camp_id:'camp',player_id:p.id,registration_status:index<18?'registered':'invited'})),
    profiles:[...players,{id:'head',first_name:'Head',last_name:'Coach'}],
    club_event_attendees:attendees,
  },{maxRows:1000,applyOrder:true,failureTable});
  const route=loadManagerModule<{GET:(req:Request)=>Promise<Response>}>('app/api/manager/camps/route.ts',{
    ...state.mocks,
    '@/app/api/camps/_lib':{createAdminClient:()=>state.db,getCaller:async()=>({userId:'manager'}),normalizeText:(v:unknown)=>String(v??'').trim(),uniq:(values:unknown[])=>[...new Set(values.filter(Boolean))]},
  });
  return {...state,route,days,attendees};
}

test('manager camp history includes all 2050 attendance rows, including present juniors beyond row 1000',async()=>{
  const f=fixture(),response=await f.route.GET(new Request('https://test.invalid/api/manager/camps',{headers:{authorization:'Bearer fixture'}}));
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.camps.length,1);
  const camp=result.camps[0];assert.equal(camp.player_registrations.length,82);
  assert.equal(camp.days[0].responsible_coach_id,'day-coach');
  assert.ok(camp.days.slice(1).every((day:{responsible_coach_id:string})=>day.responsible_coach_id==='head'));
  assert.equal(camp.days.reduce((n:number,day:{counts:Record<string,number>})=>n+Object.values(day.counts).reduce((a,b)=>a+b,0),0),2050);
  assert.equal(camp.days.reduce((n:number,day:{counts:{present:number}})=>n+day.counts.present,0),85);
  assert.equal(camp.days[24].participants_count,17);
  const junior=camp.player_registrations.find((p:{player_id:string})=>p.player_id==='player-000');
  assert.equal(Object.keys(junior.day_status_by_day_index).length,25);
  assert.equal(junior.day_status_by_day_index['0'],'not_registered');assert.equal(junior.day_status_by_day_index['24'],'present');
  assert.deepEqual(f.writes,[]);
});

test('attendance read errors return an error instead of an empty participation matrix',async()=>{
  const f=fixture('club_event_attendees'),response=await f.route.GET(new Request('https://test.invalid/api/manager/camps',{headers:{authorization:'Bearer fixture'}}));
  assert.equal(response.status,500);assert.equal((await response.json()).error,'Database failure');assert.deepEqual(f.writes,[]);
});
