/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated UI fixtures; no real accounts or deliveries. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { messages, type AppLocale } from '../lib/i18n/messages.ts';
import { managerAccessEntries } from '../lib/i18n/managerAccessMessages.ts';
import { defaultFamilyMailConfig } from '../lib/familyAccess.ts';
import { familyAccessPreview, familySendSummary, juniorAccessTarget, parentAccessTarget, type FamilyAccessData } from '../lib/managerFamilyAccess.ts';
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from './helpers/coachComponentHarness.ts';
const path='app/manager/access/page.tsx';
const locales:AppLocale[]=['fr','en','de','it'];
const t=(locale:AppLocale,key:string)=>messages[locale][key];
const parent=(id='p')=>({parent_user_id:id,parent_name:`Parent ${id}`,parent_username:id,parent_email:`${id}@example.invalid`,parent_status:'ready' as const,parent_last_sent_at:null,parent_last_activity_at:null,parent_send_count:0,linked_juniors:[{junior_user_id:'j',junior_name:'Junior J'}]});
const junior=()=>({junior_user_id:'j',junior_name:'Junior J',junior_username:'junior-j',junior_email:null,parents:['p','q'].map(id=>({parent_user_id:id,parent_name:`Parent ${id}`,parent_email:`${id}@example.invalid`,relation:null,is_primary:false})),recipient_kind:'selection_required' as const,recipient_user_id:null,recipient_name:null,recipient_email:null,junior_status:'not_ready' as const,junior_last_sent_at:null,junior_last_activity_at:null,junior_send_count:0});
const dataset=(club='A'):FamilyAccessData=>({club:{id:club,name:`Club ${club}`},parents:[parent()],juniors:[junior()],mail_config:{...defaultFamilyMailConfig(),parent_subject:'Objet maison {{parent_name}}',junior_parent_subject:'Message maison {{junior_name}}',junior_parent_body:'Bonjour {{parent_name}}, {{junior_username}} : {{reset_url}}'}});
const find=(tree:Element,fn:(node:Element)=>boolean)=>{const result=elements(tree).find(fn);assert.ok(result);return result;};
const button=(tree:Element,label:string)=>find(tree,n=>n.type==='button'&&textContent(n).trim().replace(/\s+/g,' ').replace(/\(\s+/g,'(').replace(/\s+\)/g,')')===label);
async function settle(h:ReturnType<typeof coachComponentHarness>){let tree=h.render();for(let i=0;i<3;i++){await flush();tree=h.render();}return tree;}
async function setup(options:{data?:FamilyAccessData;get?:(club:string)=>Promise<Response>;post?:(body:any)=>Promise<Response>}={}){
 const scope={clubId:'A',clubs:[{id:'A',name:'Club A'},{id:'B',name:'Club B'}],setClubId:()=>{},loading:false,error:''};
 const calls:any[]=[];let reads=0;
 const h=coachComponentHarness(path,{modules:{'@/components/manager/useManagerClubSelection':{useManagerClubSelection:()=>scope},'@/components/manager/ManagerClubSelect':{__esModule:true,default:'club-select'}},fetch:async(url,init)=>{const club=String(url).split('/')[4];if(init?.method==='POST'){const body=JSON.parse(String(init.body));calls.push({club,body});return options.post?options.post(body):Response.json({summary:{sent:1,skipped:0,errors:[]}});}reads++;return options.get?options.get(club):Response.json(options.data??dataset(club));}});
 await settle(h);return {h,scope,calls,reads:()=>reads};
}

test('family access UI resolves labels and interpolation in all four languages',()=>{
 const source=readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,99,true,ts.ScriptKind.TSX);
 function scan(node:ts.Node){if(ts.isJsxText(node))assert.doesNotMatch(node.text,/[A-Za-zÀ-ÿ]{2}/);if(ts.isJsxAttribute(node)&&['label','title','placeholder','aria-label','data-label'].includes(node.name.getText(ast))&&node.initializer&&ts.isStringLiteral(node.initializer))assert.doesNotMatch(node.initializer.text,/[A-Za-zÀ-ÿ]{2}/);ts.forEachChild(node,scan);}scan(ast);
 for(const[,key]of source.matchAll(/\bt\("([^"]+)"\)/g))for(const locale of locales)assert.ok(t(locale,key),`${locale}:${key}`);
 for(const[,key]of source.matchAll(/\bformat\("([^"]+)"/g))assert.ok(key in managerAccessEntries,key);
 for(const[key,values]of Object.entries(managerAccessEntries))for(const locale of locales){const tokens=(s:string)=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(t(locale,`manager.access.${key}`)),tokens(values[0]));}
});

test('recipient readiness uses authorized data rather than translated placeholder words',()=>{
 assert.equal(parentAccessTarget({...parent(),parent_email:'adresse.manquante@example.invalid'}).canSend,true);
 assert.equal(parentAccessTarget({...parent(),parent_username:null}).canSend,false);
 assert.equal(juniorAccessTarget(junior()).canSend,false);
 assert.equal(juniorAccessTarget(junior(),'foreign-parent').canSend,false);
 const target=juniorAccessTarget(junior(),'q');assert.equal(target.canSend,true);assert.equal(target.status,'ready');assert.equal(target.recipient,'q@example.invalid');
 assert.equal(juniorAccessTarget({...junior(),junior_username:null},'q').canSend,false);
 assert.equal(juniorAccessTarget({...junior(),parents:[]},'q').canSend,false);
 const direct=juniorAccessTarget({...junior(),junior_email:'junior@example.invalid',recipient_kind:'junior',junior_status:'ready'},'q');assert.equal(direct.selection.recipient_user_id,'j');
 const preview=familyAccessPreview(dataset(),target)!;assert.equal(preview.subject,'Message maison Junior J');assert.match(preview.body,/Bonjour Parent q, junior-j/);assert.match(preview.body,/invite_token=exemple/);
});

test('delivery receipts must account for the full batch, including partial failures',()=>{
 for(const value of [null,{}, {sent:0,skipped:0,errors:[]},{sent:1.5,skipped:0,errors:[]},{sent:0,skipped:0,errors:[{index:2,error:'x'}]},{sent:0,skipped:0,errors:[{index:0,error:'x'},{index:0,error:'y'}]}])assert.equal(familySendSummary(value,1),null);
 const partial={sent:1,skipped:1,errors:[{index:2,error:'Provider rejection'}]};assert.deepEqual(familySendSummary(partial,3),partial);
});

test('preview and locale changes preserve the recipient, selection and club template without sending',async()=>{
 const x=await setup();try{
  let tree=x.h.render();button(tree,'Juniors (1)').props.onClick();tree=x.h.render();find(tree,n=>n.type==='select'&&n.props['aria-label']==='Choisir un parent pour Junior J').props.onChange({target:{value:'q'}});tree=x.h.render();find(tree,n=>n.props['aria-label']==='Sélectionner Junior J').props.onChange({target:{checked:true}});tree=x.h.render();find(tree,n=>n.props['aria-label']==='Aperçu des accès de Junior J').props.onClick();const reads=x.reads();
  for(const locale of locales){x.h.setLocale(locale);tree=await settle(x.h);assert.ok(textContent(tree).includes('Bonjour Parent q, junior-j'));assert.ok(textContent(tree).includes('q@example.invalid'));assert.equal(find(tree,n=>n.props.type==='checkbox').props.checked,true);assert.equal(button(tree,t(locale,'manager.junior.edit.confirmSend')).props.disabled,false);assert.ok(!textContent(tree).includes('manager.access.'));}
  assert.equal(x.reads(),reads);assert.deepEqual(x.calls,[]);
 }finally{x.h.cleanup();}
});

test('missing recipient remains unsendable in the preview in every language',async()=>{
 const data=dataset();data.parents[0].parent_email=null;const x=await setup({data});try{find(x.h.render(),n=>n.props['aria-label']==='Aperçu de l’invitation de Parent p').props.onClick();for(const locale of locales){x.h.setLocale(locale);const tree=x.h.render();assert.equal(button(tree,t(locale,'manager.junior.edit.confirmSend')).props.disabled,true);await button(tree,t(locale,'manager.junior.edit.confirmSend')).props.onClick();}assert.deepEqual(x.calls,[]);}finally{x.h.cleanup();}
});

test('one click sends the chosen junior recipient once and an unknown result blocks immediate retry',async()=>{
 const pending=deferred<Response>(),x=await setup({post:()=>pending.promise});try{
  button(x.h.render(),'Juniors (1)').props.onClick();find(x.h.render(),n=>n.type==='select'&&n.props['aria-label']==='Choisir un parent pour Junior J').props.onChange({target:{value:'q'}});
  const send=find(x.h.render(),n=>n.props['aria-label']==='Envoyer les accès de Junior J').props.onClick;send();send();await flush();assert.equal(x.calls.length,1);assert.equal(x.calls[0].body.recipient_user_id,'q');
  pending.resolve(Response.json({}));await flush();let tree=x.h.render();assert.ok(textContent(tree).includes(t('fr','manager.access.sendError')));assert.equal(find(tree,n=>n.props['aria-label']==='Envoyer les accès de Junior J').props.disabled,true);await send();assert.equal(x.calls.length,1);
  button(tree,t('fr','manager.access.refresh')).props.onClick();tree=await settle(x.h);assert.equal(x.calls.length,1);
 }finally{x.h.cleanup();}
});

test('changing a recipient removes its previous bulk selection and updates ready filters',async()=>{
 const x=await setup();try{button(x.h.render(),'Juniors (1)').props.onClick();let tree=x.h.render();const choose=find(tree,n=>n.type==='select'&&n.props['aria-label']==='Choisir un parent pour Junior J').props.onChange;choose({target:{value:'p'}});tree=x.h.render();find(tree,n=>n.props['aria-label']==='Sélectionner Junior J').props.onChange({target:{checked:true}});tree=x.h.render();assert.equal(button(tree,'Envoyer la sélection (1)').props.disabled,false);choose({target:{value:'q'}});tree=x.h.render();assert.equal(button(tree,'Envoyer la sélection (0)').props.disabled,true);assert.equal(find(tree,n=>n.props['aria-label']==='Sélectionner Junior J').props.checked,false);find(tree,n=>n.type==='select'&&n.props.value==='all').props.onChange({target:{value:'ready'}});tree=x.h.render();assert.ok(textContent(tree).includes('Junior J'));}finally{x.h.cleanup();}
});

test('a late club response cannot display or send families from the previous club',async()=>{
 const first=deferred<Response>(),x=await setup({get:club=>club==='A'?first.promise:Promise.resolve(Response.json({...dataset('B'),parents:[{...parent('b'),parent_name:'Parent B only'}]}))});
 try{x.scope.clubId='B';await settle(x.h);first.resolve(Response.json(dataset('A')));const tree=await settle(x.h);assert.ok(textContent(tree).includes('Parent B only'));assert.ok(!textContent(tree).includes('Parent p'));find(tree,n=>n.props['aria-label']==='Envoyer l’invitation de Parent B only').props.onClick();await flush();assert.equal(x.calls[0].club,'B');assert.equal(x.calls[0].body.parent_user_id,'b');}finally{x.h.cleanup();}
});

test('read failure clears stale families and does not expose database details',async()=>{
 let fail=false;const x=await setup({get:async()=>fail?Response.json({error:'private database detail'},{status:500}):Response.json(dataset())});try{assert.ok(textContent(x.h.render()).includes('Parent p'));fail=true;button(x.h.render(),t('fr','manager.access.refresh')).props.onClick();const tree=await settle(x.h);assert.ok(!textContent(tree).includes('Parent p'));assert.ok(!textContent(tree).includes('private database detail'));assert.ok(textContent(tree).includes(t('fr','manager.access.loadError')));assert.deepEqual(x.calls,[]);}finally{x.h.cleanup();}
});

test('confirmed partial delivery reports errors by recipient and never resends automatically',async()=>{
 const data=dataset();data.parents.push(parent('q'));const previous=globalThis.window;globalThis.window={confirm:()=>true} as any;
 const x=await setup({data,post:async()=>Response.json({summary:{sent:1,skipped:0,errors:[{index:1,error:'private provider response'}]}},{status:207})});
 try{for(const name of ['Parent p','Parent q'])find(x.h.render(),n=>n.props['aria-label']===`Sélectionner ${name}`).props.onChange({target:{checked:true}});await button(x.h.render(),'Envoyer la sélection (2)').props.onClick();const tree=await settle(x.h);assert.ok(textContent(tree).includes('1 envoyé(s), 0 ignoré(s), 1 erreur(s)'));assert.ok(textContent(tree).includes('Envoi non confirmé pour Parent q'));assert.ok(!textContent(tree).includes('private provider response'));assert.equal(x.calls.length,1);assert.equal(x.calls[0].body.items.length,2);}finally{x.h.cleanup();globalThis.window=previous;}
});
