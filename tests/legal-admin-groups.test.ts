import test from 'node:test';
import assert from 'node:assert/strict';
import { legalAdminGroups } from '../lib/legalAdminGroups.ts';

const platform = [
  ['activitee_conditions_utilisation','terms','service.terms'],
  ['activitee_notice_donnees_personnelles','privacy','service.privacy'],
  ['activitee_notice_juniors','junior_notice','service.junior_notice'],
] as const;
const shared = [
  ['activitee_autorisation_parentale','parent_authorization','service.parent_authorization'],
  ['activitee_reformulation_ia_juniors','specific_consent','coaching.rewrite'],
  ['activitee_assistance_ia_majeurs','specific_consent','coaching.ai'],
] as const;
const docs = [
  ...platform.map(([document_key,kind,purpose_key])=>({id:document_key,document_key,kind,purpose_key,scope:'platform',club_id:null,active:false})),
  ...shared.flatMap(([prefix,kind,purpose_key])=>['sion','augusta','performance_valais'].map((club)=>({
    id:`${prefix}_${club}`,document_key:`${prefix}_${club}`,kind,purpose_key,scope:'club',club_id:club,active:false,
  }))),
  {id:'fixture',document_key:'legalqa_fixture',kind:'terms',purpose_key:'qa',scope:'platform',club_id:null,active:false},
];

test('twelve ActiviTee records appear as six models and QA fixtures stay separate',()=>{
  const result=legalAdminGroups(docs);
  assert.equal(result.groups.length,6);
  assert.equal(result.fixtures.length,1);
  assert.deepEqual(result.groups.map((group)=>group.documents.length),[1,1,1,3,3,3]);
  assert.deepEqual(result.groups.filter((group)=>group.shared).map((group)=>group.label),[
    'Autorisation parentale','Reformulation IA pour les juniors','Assistance IA pour les majeurs',
  ]);
});
