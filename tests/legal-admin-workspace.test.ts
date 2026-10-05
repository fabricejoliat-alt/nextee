import test from 'node:test';
import assert from 'node:assert/strict';
import {coachComponentHarness,elements,textContent,flush,deferred} from './helpers/coachComponentHarness.ts';
const doc={id:'fixture',document_key:'fixture terms',kind:'terms',purpose_key:'QA',scope:'club',club_id:'A',audience_roles:['player'],action_kind:'accept',required:true,active:false,applicability:{status:'approved'},required_locales:['fr','en','de','it']};
const draft={document_id:'fixture',source_revision:1,change_summary:'Original summary',allowed_variables:[],translations:Object.fromEntries(['fr','en','de','it'].map(locale=>[locale,{title:locale,body:'Fictional '+locale,action_label:'Test',status:'approved',source_revision:1}]))};
const button=(tree:unknown,name:string)=>{const v=elements(tree).find(n=>n.type==='button'&&textContent(n).trim().replace(/\s+/g,' ')===name);assert.ok(v,name);return v;};
const field=(tree:unknown,label:string)=>{const node=elements(tree).find(n=>n.type==='label'&&textContent(n).trim().startsWith(label));assert.ok(node,label);const f=elements(node).find(n=>n.type==='textarea'||n.type==='input');assert.ok(f);return f;};
async function setup(){
 const mutation=deferred<Response>();
 const h=coachComponentHarness('components/legal/LegalAdminWorkspace.tsx',{fetch:async(_input,init)=>init?.method==='POST'?mutation.promise:Response.json({documents:[doc],drafts:[draft],versions:[],clubs:[{id:'A',name:'Fixture club'}]})});
 for(let i=0;i<5;i++){h.render();await flush();}
 button(h.render(),'fixture terms Conditions d’utilisation').props.onClick();h.render();h.render();
 return {h,mutation};
}
test('Admin cannot type into fields or switch document language while a save refresh is pending',async()=>{
 const {h,mutation}=await setup();try{
  const pending=button(h.render(),'Approuver').props.onClick();const tree=h.render();
  assert.equal(field(tree,'Résumé des changements').props.disabled,true);
  assert.equal(field(tree,'Titre').props.disabled,true);
  assert.equal(button(tree,'EN · approuvée').props.disabled,true);
  mutation.resolve(Response.json({ok:true}));await pending;
  for(let i=0;i<4;i++){h.render();await flush();}
  assert.equal(field(h.render(),'Résumé des changements').props.disabled,false);
 }finally{mutation.resolve(Response.json({ok:true}));h.cleanup();}
});
test('changing the translation language preserves an unsaved change summary',async()=>{
 const {h}=await setup();try{
  field(h.render(),'Résumé des changements').props.onChange({target:{value:'Unsaved fictional summary'}});
  button(h.render(),'EN · approuvée').props.onClick();h.render();
  assert.equal(field(h.render(),'Résumé des changements').props.value,'Unsaved fictional summary');
 }finally{h.cleanup();}
});
test('Admin displays review states in French without changing stored values',async()=>{
 const pendingDraft={...draft,translations:{...draft.translations,en:{...draft.translations.en,status:'needs_review'}}};
 const h=coachComponentHarness('components/legal/LegalAdminWorkspace.tsx',{fetch:async()=>Response.json({documents:[{...doc,applicability:{status:'unapproved'}}],drafts:[pendingDraft],versions:[],clubs:[{id:'A',name:'Fixture club'}]})});
 try{
  for(let i=0;i<5;i++){h.render();await flush();}
  button(h.render(),'fixture terms Conditions d’utilisation').props.onClick();
  const tree=h.render();
  assert.ok(button(tree,'EN · à relire'));
  assert.match(textContent(tree).replace(/\s+/g,' '),/Club · player · règle à valider/);
 }finally{h.cleanup();}
});
