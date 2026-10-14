import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { activeMeritRanking, type MeritRanking } from "@/lib/activeMeritRanking";

export async function GET(req: NextRequest) {
  try {
    const url=new URL(req.url), organizationId=url.searchParams.get("organization_id")??"";
    const from=url.searchParams.get("from")??"", to=url.searchParams.get("to")??"";
    if(!organizationId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from>to)
      return NextResponse.json({error:"Invalid range"},{status:400});
    const token=bearerTokenFromRequest(req);
    const access=await resolveAuthenticatedPlayerAccess({accessToken:token, requestedPlayerId:url.searchParams.get("child_id"), requestedOrganizationId:organizationId,mode:"view"});
    // Retain the ranking RPC's own caller and legal-access checks.
    const caller=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}},
    });
    const ranking=await caller.rpc("om_ranking_snapshot",{p_org_id:organizationId,p_from:from,p_as_of:to});
    if(ranking.error)throw ranking.error;
    const rows=(ranking.data??[]) as MeritRanking[];
    const suspended=new Set<string>();
    for(let offset=0;offset<rows.length;offset+=150){
      const roster=await access.supabaseAdmin.from("academy_roster_entries").select("player_id").eq("academy_id",organizationId)
        .in("player_id",rows.slice(offset,offset+150).map(row=>row.player_id)).neq("status","active");
      if(roster.error)throw roster.error;
      for(const row of roster.data??[])suspended.add(row.player_id);
    }
    const allowed=new Set<string>();
    for(let offset=0;offset<rows.length;offset+=8){
      await Promise.all(rows.slice(offset,offset+8).map(async row=>{
        if(suspended.has(row.player_id))return;
        const result=await access.supabaseAdmin.rpc("organization_player_authorized",{p_org:organizationId,p_player:row.player_id});
        if(result.error)throw result.error;
        if(result.data===true)allowed.add(row.player_id);
      }));
    }
    return NextResponse.json({rows:activeMeritRanking(rows,allowed)},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:"Unable to load ranking"},{status:playerAccessErrorStatus(error),headers:{"Cache-Control":"private, no-store"}});}
}
