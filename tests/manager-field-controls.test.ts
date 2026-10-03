import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements } from "./helpers/coachComponentHarness.ts";

test("profile checkbox controls preserve separate selections and allow clearing all of them",()=>{
 const changes:unknown[]=[];
 const props={name:'member-field',field:{field_type:'checkbox',label:'Options',options_json:['A, B','C'],value:['A, B']},yes:'Oui',no:'Non',onChange:(value:unknown)=>changes.push(value)};
 const h=coachComponentHarness('components/ProfileCustomFieldControl.tsx',{props,fetch:async()=>{throw new Error('No network expected');}});
 let controls=elements(h.render()).filter(e=>e.type==='input');assert.equal(controls[0].props.checked,true);assert.equal(controls[1].props.checked,false);
 controls[1].props.onChange({target:{checked:true}});assert.deepEqual(changes.pop(),['A, B','C']);
 controls=elements(h.render({...props,field:{...props.field,value:['C']}})).filter(e=>e.type==='input');controls[1].props.onChange({target:{checked:false}});assert.deepEqual(changes.pop(),[]);
});

test("profile radio, boolean, date, number and long-text controls retain types and accessibility names",()=>{
 for(const type of ['radio','boolean','date','number','long_text']){
  let changed:unknown;const h=coachComponentHarness('components/ProfileCustomFieldControl.tsx',{props:{name:'member-field',field:{field_type:type,label:'Champ',options_json:['A','B'],value:type==='boolean'?false:'A'},yes:'Oui',no:'Non',onChange:(value:unknown)=>{changed=value;}},fetch:async()=>{throw new Error('No network expected');}});
  const tree=elements(h.render());const control=tree.find(e=>['input','select','textarea'].includes(e.type))!;
  if(type==='radio'){assert.equal(control.props.name,'member-field');assert.equal(control.props.checked,true);control.props.onChange({target:{checked:true}});assert.equal(changed,'A');assert.ok(tree.some(e=>e.props['aria-label']==='Champ'));}
  else {assert.equal(control.props['aria-label'],'Champ');if(type==='boolean'){assert.equal(control.props.value,'no');control.props.onChange({target:{value:''}});assert.equal(changed,null);}else if(type==='long_text')assert.equal(control.type,'textarea');else assert.equal(control.props.type,type);}
 }
});
