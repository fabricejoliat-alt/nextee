import test from "node:test";
import assert from "node:assert/strict";
import { activeMeritRanking } from "../lib/activeMeritRanking.ts";
import { summarizePlayerHome } from "../lib/playerHomeSummary.ts";

test("inactive leaders are excluded and net and gross ranks are recomputed independently",()=>{
 const rows=[{player_id:"inactive",rank_net:1,rank_brut:1},{player_id:"lea",rank_net:4,rank_brut:2},{player_id:"other",rank_net:2,rank_brut:3}];
 assert.deepEqual(activeMeritRanking(rows,new Set(["lea","other"])),[{player_id:"other",rank_net:1,rank_brut:2},{player_id:"lea",rank_net:2,rank_brut:1}]);
 assert.deepEqual(activeMeritRanking(rows,new Set(["lea"])),[{player_id:"lea",rank_net:1,rank_brut:1}]);
 assert.equal(rows[1].rank_net,4);
});
test("season attendance includes earlier months, excludes other seasons and future events",()=>{
 const dates=["2025-12-10","2026-04-10","2026-10-10","2026-10-20"];
 const events=dates.map((day,index)=>({id:String(index),club_id:"club",event_type:"training",title:null,starts_at:`${day}T12:00:00Z`,ends_at:`${day}T13:00:00Z`,duration_minutes:60,status:"scheduled",requires_evaluation:false}));
 const result=summarizePlayerHome({sessions:[],items:[],events,attendees:events.map((row,index)=>({event_id:row.id,status:index===1?"absent":"present"})),performanceEnabled:true,monthStart:"2026-10-01",monthEnd:"2026-11-01",previousMonthStart:"2026-09-01",now:"2026-10-14",seasonRanges:[{organizationId:"club",startsOn:"2026-01-01",endsOn:"2026-12-31"}]});
 assert.deepEqual(result.attendanceInsight,{present:1,expected:2,rate:50,change:null});
 assert.equal(result.monthPlannedClubEvents.length,1);
});
