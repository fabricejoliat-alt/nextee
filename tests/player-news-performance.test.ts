import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadManagerModule, managerDatabase } from './helpers/managerRouteHarness.ts';

function fixture(role = 'player') {
  const tables = {
    profiles: [{id:'junior',first_name:'Test',birth_date:'2012-01-01'}],
    coach_groups: [], coach_group_players: [],
    club_news: [
      {id:'visible',club_id:'club',title:'Club',body:'Body',status:'published',created_at:'2026-01-01',include_linked_parents:true},
      {id:'private',club_id:'club',title:'Private',status:'published',created_at:'2026-01-01',include_linked_parents:true},
      {id:'player-only',club_id:'club',status:'published',created_at:'2026-01-01',include_linked_parents:false},
      {id:'foreign',club_id:'foreign',status:'published',created_at:'2026-01-01'},
    ],
    club_news_targets: [
      {news_id:'visible',target_type:'role',target_value:'player'},
      {news_id:'private',target_type:'user',target_value:'other'},
      {news_id:'player-only',target_type:'role',target_value:'player'},
    ],
    organizations:[{id:'club',name:'Club'}],
    platform_news_clubs:[{news_id:'platform',club_id:'club',target_roles:['player']}],
    platform_news:[{id:'platform',status:'published',created_at:'2026-01-02'}],
    platform_news_translations:[{news_id:'platform',locale:'fr',title:'Français'},{news_id:'platform',locale:'de',title:'Deutsch'}],
  };
  const {db,mocks}=managerDatabase(tables);
  const lib=loadManagerModule('app/api/news/_lib.ts',{
    ...mocks,
    '@/app/api/manager/news/_lib':{ageBandKeyFromBirthDate:()=>null},
    '@/app/api/player/access':{
      loadPlayerActorAuthorization:async()=>({actorRoles:[role],guardianLinks:[]}),
      resolvePlayerAccessContext:async({requestedPlayerId}:{requestedPlayerId:string})=>{
        if(requestedPlayerId==='forbidden')throw new Error('Forbidden');
        return {subjectPlayerId:'junior',viewerRole:role,organizationIds:['club']};
      },
    },
  });
  return {lib,db};
}

test('parallel news reads preserve target privacy, parent inheritance and localization',async()=>{
  const {lib,db}=fixture('parent');
  const payload=await lib.fetchVisiblePlayerNews({supabaseAdmin:db,callerId:'parent',requestedChildId:'junior',locale:'de',includeArchived:true});
  assert.deepEqual(payload.news.map((row:{id:string})=>row.id),['platform','visible']);
  assert.equal(payload.news[0].title,'Deutsch');
  assert.equal(payload.viewer_role,'parent');
  await assert.rejects(lib.fetchVisiblePlayerNews({supabaseAdmin:db,callerId:'parent',requestedChildId:'forbidden'}),/Forbidden/);
});

test('empty club news skips decoration queries',async()=>{
  const {lib}=fixture();
  const reads:string[]=[];
  const db={from:(table:string)=>{
    reads.push(table);
    assert.equal(table,'club_news');
    const query={select:()=>query,in:()=>query,order:()=>Promise.resolve({data:[],error:null})};
    return query;
  }};
  assert.deepEqual(await lib.fetchPublishedNewsForClubs(db,['club']),[]);
  assert.deepEqual(reads,['club_news']);
});

test('platform metadata and translations start together after audience filtering',async()=>{
  const {lib}=fixture();
  const started=new Set<string>();
  const db={from:(table:string)=>{
    const query={select:()=>query,in:()=>query,then:(resolve:(value:unknown)=>void)=>{
      if(table==='platform_news_clubs')return Promise.resolve({data:[{news_id:'news',target_roles:['player']}],error:null}).then(resolve);
      started.add(table);
      return Promise.resolve().then(()=>{
        assert.equal(started.size,2,'neither read waits for the other to finish');
        return {data:[],error:null};
      }).then(resolve);
    }};
    return query;
  }};
  assert.deepEqual(await lib.fetchPublishedPlatformNewsForClubs(db,['club'],'player','fr'),[]);
});
