import assert from "node:assert/strict";
import test from "node:test";
import { encodeMemberFieldValue, decodeMemberFieldValue } from "../lib/memberFieldValues.ts";
import { renderAccessInvitationBody, defaultFamilyMailConfig } from "../lib/familyAccess.ts";
import { additionalManagerCampCounts } from "../lib/managerCampCounts.ts";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest, type Row } from "./helpers/managerRouteHarness.ts";

const ctx = { params: Promise.resolve({ clubId: "A" }) };
const membersPath = "app/api/manager/clubs/[clubId]/members/route.ts";
const fields = () => ["text", "short_text", "long_text", "number", "date", "select", "radio", "checkbox", "boolean"].map((type) => ({ id: type, club_id: "A", label: type, field_type: type, is_active: true, applies_to_roles: ["player", "coach"], options_json: ["A, B", "C"], visible_to_player: true, editable_by_player: true, visible_in_profile: true, editable_in_profile: true }));
const values = { text: "texte", short_text: "court", long_text: "ligne 1\nligne 2", number: "0", date: "2026-10-02", select: "C", radio: "A, B", checkbox: ["A, B", "C"], boolean: false };

test("all nine field types round-trip including commas, zero and false", () => {
  for (const field of fields()) assert.deepEqual(decodeMemberFieldValue(field, encodeMemberFieldValue(field, values[field.id as keyof typeof values])!), values[field.id as keyof typeof values]);
  assert.deepEqual(decodeMemberFieldValue(fields()[7], { value_text: "A, B" }), ["A, B"]);
  assert.equal(encodeMemberFieldValue(fields()[7], []), null);
  for (const [type, raw] of [["boolean", "false"], ["number", "NaN"], ["date", "2026-02-30"], ["select", "foreign"], ["radio", "foreign"], ["checkbox", "C"], ["checkbox", ["foreign"]]]) {
    assert.throws(() => encodeMemberFieldValue(fields().find(f => f.field_type === type)!, raw), /Valeur invalide/);
  }
});

test("Manager PATCH and GET preserve every custom field type", async () => {
  const tables=managerFixture(); tables.club_player_fields=fields();
  const h=managerDatabase(tables);Object.assign(h.db,{schema:()=>h.db});const route=loadManagerModule(membersPath,h.mocks);
  const response=await route.PATCH(managerRequest("PATCH",{memberId:"player-A",custom_field_values:values}),ctx);
  assert.equal(response.status,200,await response.text());
  tables.club_member_player_field_values=h.writes.filter(w=>w.table==='club_member_player_field_values'&&w.method==='upsert').map(w=>w.values);
  assert.equal(tables.club_member_player_field_values.length,9);
  const getResponse=await route.GET(managerRequest('GET'),ctx); const read=await getResponse.json(); assert.equal(getResponse.status,200,JSON.stringify(read));
  assert.deepEqual(read.members.find((row:Row)=>row.id==='player-A').custom_field_values,values);
});

test("invalid custom values block member updates and account creation before any write",async()=>{
 for(const path of [membersPath,'app/api/admin/clubs/[clubId]/create-member/route.ts']){
  const tables=managerFixture();tables.club_player_fields=fields();const h=managerDatabase(tables);
  const route=loadManagerModule(path,h.mocks);const method=path===membersPath?'PATCH':'POST';
  const response=await route[method](managerRequest(method,{memberId:'player-A',role:'player',first_name:'Should not persist',player_field_values:{checkbox:'C'}}),ctx);
  assert.equal(response.status,400,await response.text());assert.deepEqual(h.writes,[]);assert.deepEqual(h.authWrites,[]);
 }
});

test("member creation and self-service profile use the same checkbox encoding",async()=>{
 for(const path of ['app/api/admin/clubs/[clubId]/create-member/route.ts','app/api/profile/custom-fields/route.ts']){
  const tables=managerFixture();tables.club_player_fields=fields();const profile=path.includes('/profile/');
  const h=managerDatabase(tables,{caller:profile?'player':'manager'});const route=loadManagerModule(path,h.mocks);
  const response=profile ? await route.PATCH(managerRequest('PATCH',{updates:[{member_id:'player-A',values:{checkbox:values.checkbox}}]}))
    : await route.POST(managerRequest('POST',{role:'player',first_name:'Junior',last_name:'Example',player_field_values:{checkbox:values.checkbox}}),ctx);
  assert.equal(response.status,200,await response.text());
  const written=h.writes.find(w=>w.table==='club_member_player_field_values'&&w.method==='upsert');assert.equal(written?.values.value_text,JSON.stringify(values.checkbox));
  if(profile){ tables.club_member_player_field_values=[written!.values];const read=await(await route.GET(managerRequest('GET'))).json();assert.deepEqual(read.memberships[0].fields.find((f:Row)=>f.id==='checkbox').value,values.checkbox); }
 }
});

test("junior invitation failure leaves credentials and earlier links unchanged",async()=>{
 for(const direct of [true,false]){
  const tables=managerFixture();tables.profiles.push({id:'parent',username:'parent',first_name:'Parent'});
  const h=managerDatabase(tables,{users:[{id:'player',email:direct?'junior@example.invalid':'technical@noemail.local'},{id:'parent',email:'parent@example.invalid'}]});
  let message='';const route=loadManagerModule('app/api/manager/clubs/[clubId]/access-invitations/route.ts',{...h.mocks,fetch:async(_url:string,init:Row)=>{message=init.body;return Response.json({message:'Rejected'},{status:400});}});
  const response=await route.POST(managerRequest('POST',{kind:'junior_access',junior_user_id:'player'}),ctx);
  assert.equal(response.status,207);assert.deepEqual(h.authWrites,[]);
  const token=h.writes.find(w=>w.table==='access_invitation_tokens');assert.equal(token?.method,'insert');assert.equal(token?.values.recipient_user_id,direct?'player':'parent');assert.equal(token?.values.invitation_kind,'junior_access');assert.match(message,/invite_token=/);assert.doesNotMatch(message,/Mot de passe temporaire/);
  assert.ok(!h.writes.some(w=>w.table==='access_invitation_tokens'&&w.method==='delete'));
 }
});

test("junior invitation never sends credentials to a guardian whose editing rights are revoked",async()=>{
 const tables=managerFixture();tables.player_guardians[0].can_edit=false;
 const h=managerDatabase(tables,{users:[{id:'player',email:'technical@noemail.local'},{id:'parent',email:'parent@example.invalid'}]});
 const response=await loadManagerModule('app/api/manager/clubs/[clubId]/access-invitations/route.ts',h.mocks).POST(managerRequest('POST',{kind:'junior_access',junior_user_id:'player',recipient_user_id:'parent'}),ctx);
 const body=await response.json();assert.equal(body.summary.sent,0);assert.deepEqual(h.writes,[]);assert.deepEqual(h.authWrites,[]);
});

test("reset claims a token before Auth and never updates Auth when the claim is rejected",async()=>{
 for(const accepted of [true,false]){
  const h=managerDatabase();let claimed=false;
  h.db.rpc=async(name:string,args:Row)=>{assert.equal(name,'claim_access_invitation_v1');assert.equal(args.p_consume,true);assert.match(args.p_token_hash,/^[a-f0-9]{64}$/);claimed=true;return {data:accepted?{user_id:'player',invitation_kind:'junior_access',sent_to_email:'parent@example.invalid'}:null,error:null};};
  h.db.auth.admin.updateUserById=async(id:string,patch:Row)=>{assert.ok(claimed);h.authWrites.push({id,patch});return {error:null};};
  const response=await loadManagerModule('app/api/auth/invitation-reset/route.ts',h.mocks).POST(managerRequest('POST',{token:'synthetic-token',password:'synthetic-password'}));
  assert.equal(response.status,accepted?200:400);assert.equal(h.authWrites.length,accepted?1:0);assert.deepEqual(h.writes,[]);
 }
});

test("legacy and customized invitation bodies always include a usable reset link",()=>{
 const vars={reset_url:'https://example.invalid/reset?invite_token=synthetic'};
 for(const body of [defaultFamilyMailConfig().junior_parent_body,'Mot de passe temporaire : {{temp_password}}','Message personnalisé']){
  const rendered=renderAccessInvitationBody(body,vars);assert.ok(rendered.includes(vars.reset_url));assert.doesNotMatch(rendered,/temp_password|Mot de passe temporaire/);
 }
});

test("role-wide news includes authorized linked parents with multiple roles only once",async()=>{
 const tables=managerFixture();tables.club_members.push({id:'multi',club_id:'A',user_id:'parent',role:'coach',is_active:true},{id:'blocked',club_id:'A',user_id:'revoked',role:'parent',is_active:true});tables.player_guardians.push({player_id:'player',guardian_user_id:'revoked',can_view:false});
 const h=managerDatabase(tables);const db={...h.db,schema:()=>({from:()=>({select:()=>({in:async()=>({data:[],error:null})})})})};
 const loaded=loadManagerModule('app/api/manager/news/_lib.ts',h.mocks);
 const result=await loaded.resolveNewsRecipients(db,'A',[{target_type:'role',target_value:'player'}],true);
 assert.deepEqual(result.recipientUserIds.sort(),['parent','player']);
 const direct=await loaded.resolveNewsRecipients(db,'A',[{target_type:'user',target_value:'player'}],true);assert.deepEqual(direct.recipientUserIds.sort(),['parent','player']);
});

test("partial email retries skip delivered recipients and unknown outcomes never resend",async()=>{
 const loaded=loadManagerModule('lib/server/managerNewsDelivery.ts',{});const ledger=new Map<string,Row>();let attempt=0;
 const db={rpc:async(name:string,args:Row)=>{
  if(name==='claim_manager_news_email_v1'){const entry=ledger.get(args.p_recipient);if(entry&&entry.status!=='failed')return {data:{status:entry.status},error:null};const next={status:'sending',attempt_id:String(++attempt)};ledger.set(args.p_recipient,next);return {data:{...next,status:'claimed'},error:null};}
  ledger.get(args.p_recipient)!.status=args.p_status;return {data:null,error:null};
 }};
 const sent:string[]=[];let reject=true;
 const args={db,actorId:'manager',clubId:'A',newsId:'news',recipients:['one','two','three'].map(user_id=>({user_id,email:`${user_id}@example.invalid`,full_name:user_id})),send:async(r:Row)=>{sent.push(r.user_id);if(r.user_id==='two'&&reject)throw new loaded.RejectedNewsEmail('rejected');if(r.user_id==='three')throw new Error('network outcome unknown');}};
 const first=await loaded.deliverManagerNewsEmails(args);assert.equal(first.complete,false);assert.equal(first.email_sent_count,1);assert.equal(first.email_failed_count,1);assert.equal(first.email_uncertain_count,1);
 reject=false;const retry=await loaded.deliverManagerNewsEmails(args);assert.equal(retry.email_sent_count,1);assert.equal(retry.email_already_sent_count,1);assert.equal(retry.email_uncertain_count,1);assert.deepEqual(sent,['one','two','three','two']);
});

test("a provider success with a failed database receipt stays reserved",async()=>{
 let claimed=false,sends=0;const db={rpc:async(name:string)=>name==='claim_manager_news_email_v1'?{data:claimed?{status:'sending'}:(claimed=true,{status:'claimed',attempt_id:'1'}),error:null}:{data:null,error:{message:'receipt failed'}}};
 const {deliverManagerNewsEmails}=loadManagerModule('lib/server/managerNewsDelivery.ts',{});
 const args={db,actorId:'manager',clubId:'A',newsId:'news',recipients:[{user_id:'one',email:'one@example.invalid',full_name:'One'}],send:async()=>{sends++;}};
 assert.equal((await deliverManagerNewsEmails(args)).email_uncertain_count,1);await deliverManagerNewsEmails(args);assert.equal(sends,1);
});

test("evaluation completion requires recorded attendance, valid ratings and required criteria",()=>{
 const {managerEvaluationProgress}=loadManagerModule('lib/managerEvaluationProgress.ts',{});
 const attendees=['partial','criteria-missing','complete','absent','unrecorded'].map(player_id=>({event_id:'e',player_id,coach_recorded_status:player_id==='absent'?'absent':player_id==='unrecorded'?null:'present'}));
 const feedback=attendees.map(a=>({...a,engagement:4,attitude:4,performance:a.player_id==='partial'?null:4}));
 const criteria=[{id:'c',event_id:'e',is_enabled:true,snapshot_respondent:'coach',snapshot_is_required:true,snapshot_response_format:'short_text',snapshot_choices:[]}];
 const result=managerEvaluationProgress(attendees,feedback,criteria,[{event_id:'e',player_id:'complete',event_criterion_id:'c',respondent_role:'coach',value_json:'Fait'}]);
 assert.deepEqual([...result.completed].sort(),['e|absent','e|complete']);assert.deepEqual([...result.inProgress].sort(),['e|criteria-missing','e|partial','e|unrecorded']);
});

test("camp counters include standalone days and exclude duplicates, group days and cancelled days",()=>{
 const event={id:'standalone',group_id:null,event_type:'camp',status:'scheduled',starts_at:'2026-10-03T08:00:00Z'};
 const result=additionalManagerCampCounts([event,event,{...event,id:'group',group_id:'g'},{...event,id:'past',starts_at:'2026-10-01T08:00:00Z'},{...event,id:'cancelled',status:'cancelled'},{...event,id:'competition',event_type:'competition'}],['g'],'2026-10-02T08:00:00Z');
 assert.deepEqual(result,{planned:1,past:1});
});

test("performance API does not count a partial evaluation as completed or lose it from overdue work",async()=>{
 const tables=managerFixture();const past=new Date(Date.now()-14*86400000).toISOString();const future=new Date(Date.now()+2*86400000).toISOString();
 tables.coach_groups[0]={...tables.coach_groups[0],is_active:true,head_coach_user_id:'target',name:'Group'};
 tables.club_events=[{id:'past',club_id:'A',group_id:'group-A',title:'Training',event_type:'training',starts_at:past,ends_at:past,duration_minutes:60,status:'scheduled',requires_evaluation:true},{id:'future',club_id:'A',group_id:'group-A',starts_at:future,ends_at:future,status:'scheduled',requires_evaluation:true}];
 tables.club_event_coaches=[{event_id:'past',coach_id:'target'},{event_id:'future',coach_id:'target'}];
 tables.club_event_attendees=[{event_id:'past',player_id:'player',status:'present',coach_recorded_status:'present'},{event_id:'future',player_id:'player',status:'present',coach_recorded_status:'present'}];
 tables.club_event_coach_feedback=[{event_id:'past',player_id:'player',coach_id:'target',engagement:4,attitude:null,performance:null,visible_to_player:false},{event_id:'future',player_id:'player',coach_id:'target',engagement:4,attitude:4,performance:4}];
 const h=managerDatabase(tables);const route=loadManagerModule('app/api/manager/clubs/[clubId]/performance/coaches/route.ts',{...h.mocks,'../_lib':{
  performanceContext:async()=>({ok:true,db:h.db}),resolveRange:async()=>({range:{from:past.slice(0,10),to:future.slice(0,10)},previous:{from:'2020-01-01',to:'2020-01-02'},season:{id:'season-A'},seasons:[]}),queryRows:async(q:PromiseLike<Row>)=>(await q).data,dateKey:(v:string)=>v.slice(0,10),startIso:(v:string)=>`${v}T00:00:00Z`,
 }});
 const request=Object.assign(managerRequest('GET'),{nextUrl:new URL('http://localhost/')});
 let response=await route.GET(request,ctx);let body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.rows[0].evaluationsExpected,1);assert.equal(body.rows[0].evaluationsCompleted,0);assert.equal(body.rows[0].evaluationsInProgress,1);assert.equal(body.rows[0].evaluationsOverdue,1);
 Object.assign(tables.club_event_coach_feedback[0],{attitude:4,performance:4});
 tables.club_event_evaluation_criteria=[{id:'criterion',event_id:'past',is_enabled:true,snapshot_is_required:true,snapshot_respondent:'coach',snapshot_response_format:'short_text',snapshot_choices:[]}];
 response=await route.GET(request,ctx);body=await response.json();assert.equal(body.rows[0].evaluationsCompleted,0);
 tables.club_event_evaluation_responses=[{event_id:'past',player_id:'player',event_criterion_id:'criterion',respondent_role:'coach',value_json:'Reviewed'}];
 response=await route.GET(request,ctx);body=await response.json();assert.equal(body.rows[0].evaluationsCompleted,1);assert.equal(body.rows[0].evaluationsInProgress,0);assert.equal(body.rows[0].evaluationsOverdue,0);
});

test("dashboard API counts camp days consistently with its upcoming list and incomplete debriefs",async()=>{
 const tables=managerFixture();tables.coach_groups[0]={...tables.coach_groups[0],is_active:true};
 const future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 tables.club_camps=[{id:'camp',club_id:'A',title:'Camp',status:'scheduled'}];
 tables.club_camp_days=[{id:'day1',camp_id:'camp',event_id:'standalone'},{id:'day2',camp_id:'camp',event_id:'group'}];
 tables.club_events=[{id:'standalone',club_id:'A',group_id:null,event_type:'camp',starts_at:future,status:'scheduled'},{id:'group',club_id:'A',group_id:'group-A',event_type:'camp',starts_at:future,status:'scheduled'},{id:'past',club_id:'A',group_id:'group-A',event_type:'training',starts_at:past,status:'scheduled',requires_evaluation:true}];
 tables.club_event_attendees=[{event_id:'past',player_id:'player',status:'present',coach_recorded_status:'present'}];
 tables.club_event_coach_feedback=[{event_id:'past',player_id:'player',engagement:4,attitude:null,performance:null}];
 const h=managerDatabase(tables);const response=await loadManagerModule('app/api/manager/dashboard/home/route.ts',h.mocks).GET(managerRequest('GET'));const body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.stats.plannedEventsCount,2);assert.equal(body.upcomingEvents.length,2);assert.equal(body.stats.pastEventsCount,1);assert.equal(body.stats.activitiesAwaitingCoachEvaluationCount,1);
});

test("news dispatch keeps the completion timestamp empty until all retryable deliveries succeed",async()=>{
 const h=managerDatabase();const ledger=new Map<string,Row>();let serial=0,attempt=0;const sent:string[]=[];
 const db={...h.db,rpc:async(name:string,args:Row)=>{
  if(name==='claim_manager_news_email_v1'){const entry=ledger.get(args.p_recipient);if(entry&&entry.status!=='failed')return {data:{status:entry.status},error:null};const next={status:'sending',attempt_id:String(++serial)};ledger.set(args.p_recipient,next);return {data:{...next,status:'claimed'},error:null};}
  ledger.get(args.p_recipient)!.status=args.p_status;return {data:null,error:null};
 }};
 const {dispatchNews}=loadManagerModule('app/api/manager/news/_lib.ts',{...h.mocks,fetch:async(_url:string,options:Row)=>{const email=JSON.parse(options.body).to[0].email;sent.push(email);return email==='two@example.invalid'&&attempt===0?Response.json({message:'Rate limited'},{status:429}):Response.json({messageId:'synthetic'});}});
 const args={supabaseAdmin:db,callerId:'manager',clubId:'A',newsId:'news',linkedClubEventId:null,linkedCampId:null,title:'News',summary:null,body:'Content',sendNotification:false,sendEmail:true,lastNotificationSentAt:null,lastEmailSentAt:null,recipientUserIds:['one','two'],emailRecipients:['one','two'].map(user_id=>({user_id,full_name:user_id,email:`${user_id}@example.invalid`}))};
 const first=await dispatchNews(args);assert.equal(first.lastEmailSentAt,null);assert.equal(first.lastDispatchResult.email_failed_count,1);
 attempt++;const second=await dispatchNews(args);assert.ok(second.lastEmailSentAt);assert.equal(second.lastDispatchResult.email_failed_count,0);assert.deepEqual(sent,['one@example.invalid','two@example.invalid','two@example.invalid']);
});
