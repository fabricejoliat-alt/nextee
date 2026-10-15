import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

test("junior performance uses the selected season's actual roster and filters every group", async () => {
  const { db } = managerDatabase({
    club_members: [{id:"member",user_id:"lea",club_id:"club",role:"player",is_active:true}],
    profiles: [{id:"lea",first_name:"Léa",last_name:"Martin",handicap:10}],
    coach_groups: [
      {id:"competition",name:"Compétition 1",club_id:"club",club_season_id:"season",is_active:true},
      {id:"other",name:"Autre groupe",club_id:"club",club_season_id:"season",is_active:true},
      {id:"old",name:"Ancienne saison",club_id:"club",club_season_id:"old-season",is_active:true},
      {id:"outside",name:"Autre club",club_id:"outside",club_season_id:"season",is_active:true},
    ],
    club_player_season_records: [{club_member_id:"member",club_season_id:"season",group_id:null,registration_status:"active"}],
    coach_group_players: ["competition","other","old","outside"].map(group_id=>({group_id,player_user_id:"lea"})),
  });
  const from=db.from.bind(db);
  db.from=((table:string)=>{const q=from(table); return Object.assign(q,{or:()=>q});}) as typeof db.from;
  const {GET}=loadManagerModule<{GET:(req:{nextUrl:URL},ctx:{params:Promise<{clubId:string}>})=>Promise<Response>}>("app/api/manager/clubs/[clubId]/performance/juniors/route.ts",{
    "next/server":{NextResponse:{json:Response.json}},
    "@/lib/server/personalHistoryAccess":{readablePlayerHistoryIds:async()=>["lea"]},
    "@/lib/personalHistoryScope":{personalOrOrganizationFilter:()=>"club_id.is.null"},
    "../_lib":{
      performanceContext:async()=>({ok:true,db,callerId:"manager"}),
      resolveRange:async()=>({range:{from:"2026-01-01",to:"2026-10-15"},previous:{from:"2025-01-01",to:"2025-10-15"},season:{id:"season"},seasons:[]}),
      queryRows:async(query:PromiseLike<{data:unknown;error:unknown}>)=>{const result=await query;if(result.error)throw result.error;return result.data??[];},
      dateKey:(s:string)=>s.slice(0,10),startIso:(s:string)=>s,endIso:(s:string)=>s,
    },
  });
  const response=await GET({nextUrl:new URL("https://app.invalid?group=competition")},{params:Promise.resolve({clubId:"club"})});
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.rows.length,1);
  assert.match(body.rows[0].groupName,/Compétition 1/);
  assert.deepEqual(body.rows[0].groups.map((group:{id:string})=>group.id),["other","competition"]);
  assert.deepEqual(body.byGroup.map((group:{id:string;count:number})=>({id:group.id,count:group.count})),[{id:"competition",count:1},{id:"other",count:1}]);
  assert(!JSON.stringify(body.rows[0].groups).includes("Ancienne saison"));
});
