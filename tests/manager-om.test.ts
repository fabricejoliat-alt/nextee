/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated UI fixtures; no real accounts or writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {messages,type AppLocale} from '../lib/i18n/messages.ts';
import {managerOmMessages} from '../lib/i18n/managerOmMessages.ts';
import {omBonusSubtitle,omDate,omText} from '../lib/managerOrderOfMerit.ts';
import {coachComponentHarness,elements,textContent,flush,deferred,type Element} from './helpers/coachComponentHarness.ts';
const locales:AppLocale[]=['fr','en','de','it'];
const catalogPath='components/manager/ManagerOmCatalog.tsx',detailPath='app/manager/om/contests/[contestId]/page.tsx',rankingPath='app/manager/om/page.tsx';
const t=(key:string,locale:AppLocale='fr')=>messages[locale][`managerOm.${key}`];
const find=(tree:Element,fn:(node:Element)=>boolean)=>{const result=elements(tree).find(fn);assert.ok(result);return result;};
const button=(tree:Element,label:string)=>find(tree,n=>n.type==='button'&&textContent(n).trim()===label);
const field=(tree:Element,label:string)=>find(tree,n=>n.type==='label'&&textContent(n).trim()===label).props.children[1];
async function settle(h:ReturnType<typeof coachComponentHarness>){let tree=h.render();for(let n=0;n<4;n++){await flush();tree=h.render();}return tree;}
const catalog=(club='A',kind='contest')=>({club_id:club,rows:[{id:'c'+club,organization_id:club,title:kind==='contest'?`Concours ${club} {name}`:undefined,name:kind==='tournament'?`Tournoi ${club}`:undefined,contest_date:'2026-10-03',description:'Texte maison {name}',full_ranking:[],version:'version-'+club,is_active:true}],groups:[{id:'g'+club,name:'Group '+club,club_season_id:'s',is_active:true}]});
const contest=()=>({contest:{id:'cA',organization_id:'A',title:'Concours maison {name}',description:'Description maison',contest_date:'2026-10-03'},version:'version-A',results:[{player_id:'p1',rank:1,note:'Texte maison'}],players:[{id:'p1',first_name:'Player',last_name:'One'},{id:'p2',first_name:'Player',last_name:'Two'}]});
async function setup(path=catalogPath,options:{kind?:string;rpc?:(name:string,args:any)=>Promise<any>}={}){
 const calls:any[]=[],scope={clubId:'A',clubs:[{id:'A',name:'Club A'},{id:'B',name:'Club B'}],setClubId:()=>{},loading:false,error:''};
 const selection={useManagerClubSelection:()=>scope};
 const h=coachComponentHarness(path,{props:{kind:options.kind??'contest'},params:{contestId:'cA'},fetch:async()=>Response.json({}),database:{rpc:async(name:string,args:any)=>{calls.push({name,args});return options.rpc?options.rpc(name,args):{data:name==='get_manager_om_data_v1'?catalog(args.p_club_id,args.p_kind):contest(),error:null};}},modules:{'./useManagerClubSelection':selection,'@/components/manager/useManagerClubSelection':selection,'./ManagerClubSelect':{__esModule:true,default:'club-select'},'@/components/manager/ManagerClubSelect':{__esModule:true,default:'club-select'}}});
 await settle(h);return {h,scope,calls};
}
function openForm(h:ReturnType<typeof coachComponentHarness>,kind='contest'){button(h.render(),t(`${kind}.new`)).props.onClick();field(h.render(),t('name')).props.onChange({target:{value:'Nom maison {name}'}});return h.render();}
const submit=(tree:Element)=>find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});

test('all four OM screens use complete four-language messages and preserve interpolation tokens',()=>{
 for(const path of [catalogPath,detailPath,rankingPath]){
  const source=readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,99,true,ts.ScriptKind.TSX);
  function scan(n:ts.Node){if(ts.isJsxText(n))assert.ok(!/[A-Za-zÀ-ÿ]{2}/.test(n.text)||n.text.trim()==='Manager',`${path}:${n.text}`);ts.forEachChild(n,scan);}scan(ast);
 }
 const expected=Object.keys(managerOmMessages.fr).sort();for(const locale of locales){assert.deepEqual(Object.keys(managerOmMessages[locale]).sort(),expected);for(const key of expected){const tokens=(s:string)=>[...s.matchAll(/\{\w+\}/g)].map(x=>x[0]).sort();assert.deepEqual(tokens(messages[locale][key]),tokens(messages.fr[key]),`${locale}:${key}`);assert.equal(messages[locale][key],(managerOmMessages[locale] as Record<string,string>)[key]);}}
 assert.equal(omText(k=>messages.fr[k],'details',{name:'A {name} $&'}),'Détail des points de A {name} $&');assert.equal(omDate('2026-10-03','en','fallback'),'03 Oct 2026');
 assert.equal(omBonusSubtitle('training_presence','Club training attendance'),null);
 assert.equal(omBonusSubtitle('camp_day_presence','Club camp attendance'),null);
 assert.equal(omBonusSubtitle('training_presence','Message rédigé par le club'), 'Message rédigé par le club');
});

test('catalog forms keep drafts and authored text across all languages without writing',async()=>{
 for(const kind of ['contest','tournament']){const x=await setup(catalogPath,{kind});try{openForm(x.h,kind);const reads=x.calls.length;for(const locale of locales){x.h.setLocale(locale);const tree=await settle(x.h);assert.equal(field(tree,t('name',locale)).props.value,'Nom maison {name}');assert.ok(textContent(tree).includes(t(`${kind}.title`,locale)));assert.ok(!textContent(tree).includes('managerOm.'));assert.ok(textContent(tree).includes('Texte maison {name}'));}assert.equal(x.calls.length,reads);}finally{x.h.cleanup();}}
});

test('late catalog responses cannot display previous club rows or carry over a draft',async()=>{
 const pending=deferred<any>(),x=await setup(catalogPath,{rpc:async(_,args)=>args.p_club_id==='B'?pending.promise:{data:catalog('A')}});try{openForm(x.h);x.scope.clubId='B';let tree=x.h.render();assert.ok(!textContent(tree).includes('Concours A'));tree=await settle(x.h);assert.ok(!elements(tree).some(n=>n.type==='form'));pending.resolve({data:catalog('B')});tree=await settle(x.h);assert.ok(textContent(tree).includes('Concours B'));assert.ok(!textContent(tree).includes('Concours A'));}finally{x.h.cleanup();}
 const first=deferred<any>(),y=await setup(catalogPath,{rpc:async(_,args)=>args.p_club_id==='A'?first.promise:{data:catalog('B')}});try{y.scope.clubId='B';await settle(y.h);first.resolve({data:catalog('A')});const tree=await settle(y.h);assert.ok(textContent(tree).includes('Concours B'));assert.ok(!textContent(tree).includes('Concours A'));}finally{y.h.cleanup();}
});

test('a missing migration fails closed with a translated message and no stale controls',async()=>{
 const x=await setup(catalogPath,{rpc:async()=>({error:{code:'PGRST202',message:'private database details'}})});try{for(const locale of locales){x.h.setLocale(locale);const tree=await settle(x.h);assert.ok(textContent(tree).includes(t('error.unavailable',locale)));assert.equal(button(tree,t('contest.new',locale)).props.disabled,true);assert.ok(!textContent(tree).includes('private database'));}}finally{x.h.cleanup();}
});

test('create guards synchronous double submits, then retries an unknown save with the same request and payload',async()=>{
 const pending=deferred<any>();let writes=0;const x=await setup(catalogPath,{rpc:async(name,args)=>name==='write_manager_om_v1'?(++writes===1?pending.promise:{data:{ok:true,id:'new',action:'create',replayed:true}}):{data:catalog(args.p_club_id)}});
 try{const tree=openForm(x.h),handler=find(tree,n=>n.type==='form').props.onSubmit;handler({preventDefault(){}});handler({preventDefault(){}});await flush();assert.equal(writes,1);pending.resolve({error:{message:'connection lost'}});let next=await settle(x.h);assert.equal(button(next,t('contest.new')).props.disabled,true);assert.ok(textContent(next).includes(t('error.unconfirmed')));button(next,t('verify')).props.onClick();next=await settle(x.h);const saves=x.calls.filter(c=>c.name==='write_manager_om_v1');assert.equal(saves.length,2);assert.deepEqual(saves[0].args,saves[1].args);assert.equal(saves[0].args.p_club_id,'A');assert.equal(saves[0].args.p_payload.name,'Nom maison {name}');assert.ok(textContent(next).includes(t('saved')));assert.ok(!elements(next).some(n=>n.type==='form'));}finally{x.h.cleanup();}
});

test('confirmed create plus failed refresh stays confirmed and cannot recreate on a stale retry',async()=>{
 let saved=false;const x=await setup(catalogPath,{rpc:async(name,args)=>{if(name==='write_manager_om_v1'){saved=true;return {data:{ok:true,id:'new',action:'create'}};}return saved?{error:{message:'offline'}}:{data:catalog(args.p_club_id)};}});
 try{submit(openForm(x.h));const tree=await settle(x.h);assert.ok(textContent(tree).includes(t('saved')));assert.ok(textContent(tree).includes(t('error.refresh')));assert.ok(!elements(tree).some(n=>n.type==='form'));assert.equal(button(tree,t('contest.new')).props.disabled,true);assert.equal(x.calls.filter(c=>c.name==='write_manager_om_v1').length,1);}finally{x.h.cleanup();}
});

test('contest publication preserves note and expected version; blank or duplicate player rows cannot be silently dropped',async()=>{
 const x=await setup(detailPath,{rpc:async name=>name==='write_manager_om_v1'?{data:{ok:true,id:'cA',action:'publish'}}:{data:contest()}});try{
  button(x.h.render(),t('addPlayer')).props.onClick();await button(x.h.render(),t('publish')).props.onClick();let tree=await settle(x.h);assert.ok(textContent(tree).includes(t('error.invalid_rankings')));assert.equal(x.calls.length,1);
  find(tree,n=>n.props['aria-label']==='Joueur — ligne 2').props.onChange({target:{value:'p1'}});await button(x.h.render(),t('publish')).props.onClick();tree=await settle(x.h);assert.ok(textContent(tree).includes(t('error.duplicate_player')));
  find(tree,n=>n.props['aria-label']==='Joueur — ligne 2').props.onChange({target:{value:'p2'}});find(x.h.render(),n=>n.props['aria-label']==='Note — ligne 2').props.onChange({target:{value:'Auteur {name}'}});
  for(const locale of locales){x.h.setLocale(locale);tree=await settle(x.h);assert.ok(textContent(tree).includes('Concours maison {name}'));assert.equal(find(tree,n=>n.type==='input'&&n.props.value==='Auteur {name}').props.value,'Auteur {name}');}
  await button(tree,t('publish','it')).props.onClick();await settle(x.h);const call=x.calls.find(c=>c.name==='write_manager_om_v1');assert.equal(call.args.p_expected,'version-A');assert.deepEqual(call.args.p_payload.rankings,[{player_id:'p1',rank:1,note:'Texte maison'},{player_id:'p2',rank:2,note:'Auteur {name}'}]);
 }finally{x.h.cleanup();}
});

test('clearing a saved contest requires confirmation and publishes the explicit empty flag',async()=>{
 const prior=globalThis.window;let accepted=false;globalThis.window={confirm:()=>accepted} as any;
 const x=await setup(detailPath,{rpc:async name=>name==='write_manager_om_v1'?{data:{ok:true,id:'cA',action:'publish'}}:{data:contest()}});
 try{find(x.h.render(),n=>n.props['aria-label']==='Retirer la ligne 1').props.onClick();await button(x.h.render(),t('publish')).props.onClick();assert.equal(x.calls.length,1);accepted=true;await button(x.h.render(),t('publish')).props.onClick();await settle(x.h);assert.deepEqual(x.calls.find(c=>c.name==='write_manager_om_v1').args.p_payload,{rankings:[],allow_empty:true});}finally{x.h.cleanup();globalThis.window=prior;}
});

test('a failed complete contest load never enables publication',async()=>{
 const x=await setup(detailPath,{rpc:async()=>({data:{contest:contest().contest,version:'v',results:[]}})});try{const tree=x.h.render();assert.ok(textContent(tree).includes(t('error.load')));assert.ok(!elements(tree).some(n=>n.type==='button'&&textContent(n)===t('publish')));}finally{x.h.cleanup();}
});

const player=(id:string)=>({player_id:id,full_name:`Player ${id}`,rank_net:id==='one'?1:2,rank_brut:id==='one'?2:1,period_limit:1,tournament_points_net:12.5,tournament_points_brut:10,bonus_points_net:15,bonus_points_brut:15,total_points_net:27.5,total_points_brut:25});
const rankData=(club='A')=>({club_id:club,rows:[player('one'),player('two')],avatars:[]});
const details=(who:string,club='A')=>({club_id:club,player_id:who,scores:[{round_id:'r1',competition_level:'regional',competition_format:'stroke_play_individual',rounds_18_count:1,total_points_net:12.5,total_points_brut:3,occurred_on:'2026-09-30',calculated_at:'2026-09-30T12:00:00Z'},{round_id:'r2',competition_level:'national',competition_format:'stroke_play_individual',rounds_18_count:1,total_points_net:2,total_points_brut:10,occurred_on:'2026-09-29',calculated_at:'2026-09-29T12:00:00Z'}],rounds:[{id:'r1',competition_name:`${who} Cup`,course_name:'Golf du club',start_at:'2026-09-30'}],bonuses:[{id:'b1',bonus_type:'internal_contest_podium',description:'Internal contest podium',occurred_on:'2026-09-28',points_net:15,points_brut:15}]});

test('late ranking/detail responses are ignored after player or club changes and dates fail closed',async()=>{
 const pending=deferred<any>();const x=await setup(rankingPath,{rpc:async(_,args)=>args.p_player_id==='one'?pending.promise:{data:args.p_player_id?details(args.p_player_id,args.p_club_id):rankData(args.p_club_id)}});
 try{find(x.h.render(),n=>n.props['aria-label']==='Détail des points de Player one').props.onClick();find(x.h.render(),n=>n.props['aria-label']==='Détail des points de Player two').props.onClick();await settle(x.h);pending.resolve({data:details('one')});let tree=await settle(x.h);assert.ok(textContent(tree).includes('two Cup'));assert.ok(!textContent(tree).includes('one Cup'));
  x.scope.clubId='B';tree=x.h.render();assert.ok(!textContent(tree).includes('two Cup'));await settle(x.h);
  field(x.h.render(),t('from')).props.onChange({target:{value:'2099-12-31'}});tree=await settle(x.h);assert.ok(textContent(tree).includes(t('error.invalid_dates')));assert.ok(!textContent(tree).includes('Player one'));
 }finally{x.h.cleanup();}
});

test('net and gross inclusion is independent; changing languages updates loaded detail labels without reloading',async()=>{
 const x=await setup(rankingPath,{rpc:async(_,args)=>({data:args.p_player_id?details(args.p_player_id):rankData()})});try{find(x.h.render(),n=>n.props['aria-label']==='Détail des points de Player one').props.onClick();await settle(x.h);const count=x.calls.length;
  for(const locale of locales){x.h.setLocale(locale);let tree=await settle(x.h);assert.ok(textContent(tree).includes(t('bonus.internal_contest_podium',locale)));assert.ok(textContent(tree).includes(t('level.regional',locale)));if(locale!=='en')assert.ok(!textContent(tree).includes('Internal contest podium'));assert.ok(!textContent(tree).includes('managerOm.'));
   button(tree,t('net',locale)).props.onClick();tree=x.h.render();let row=find(tree,n=>n.type==='tr'&&textContent(n).includes('one Cup'));assert.ok(textContent(row).includes(t('included',locale)));
   button(tree,t('brut',locale)).props.onClick();tree=x.h.render();row=find(tree,n=>n.type==='tr'&&textContent(n).includes('one Cup'));assert.ok(textContent(row).includes(t('excluded',locale)));
  }assert.equal(x.calls.length,count);
 }finally{x.h.cleanup();}
});
