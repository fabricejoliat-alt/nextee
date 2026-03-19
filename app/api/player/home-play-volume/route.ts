import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function rollingYearWindows(now = new Date()) {
  const curEnd = new Date(now);
  curEnd.setHours(23, 59, 59, 999);

  const curStart = new Date(now);
  curStart.setFullYear(curStart.getFullYear() - 1);

  const prevEnd = new Date(curStart);
  const prevStart = new Date(curStart);
  prevStart.setFullYear(prevStart.getFullYear() - 1);

  return { curStart, curEnd, prevStart, prevEnd };
}

function roundPlayedHolesFromRound(round: {
  eagles?: number | null;
  birdies?: number | null;
  pars?: number | null;
  bogeys?: number | null;
  doubles_plus?: number | null;
  fairways_total?: number | null;
  total_putts?: number | null;
  gir?: number | null;
}) {
  const values = [round.eagles, round.birdies, round.pars, round.bogeys, round.doubles_plus];
  if (values.some((v) => typeof v === "number")) {
    return values.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
  }
  if (typeof round.fairways_total === "number") return round.fairways_total <= 7 ? 9 : 18;
  if (typeof round.total_putts === "number") return round.total_putts <= 22 ? 9 : 18;
  if (typeof round.gir === "number") return round.gir <= 9 ? 9 : 18;
  return 18;
}

function estimatedScramblingPct(rounds: Array<{
  id: string;
  gir: number | null;
  eagles: number | null;
  birdies: number | null;
  pars: number | null;
  bogeys: number | null;
  doubles_plus: number | null;
  fairways_total: number | null;
  total_putts: number | null;
}>) {
  let opp = 0;
  let success = 0;
  for (const round of rounds) {
    const played = roundPlayedHolesFromRound(round);
    const gir = typeof round.gir === "number" ? round.gir : null;
    if (!played || gir == null) continue;
    const roundOpp = Math.max(played - gir, 0);
    if (roundOpp <= 0) continue;
    const parOrBetter =
      (typeof round.pars === "number" ? round.pars : 0) +
      (typeof round.birdies === "number" ? round.birdies : 0) +
      (typeof round.eagles === "number" ? round.eagles : 0);
    const roundSuccess = Math.min(roundOpp, Math.max(parOrBetter - gir, 0));
    opp += roundOpp;
    success += roundSuccess;
  }
  if (opp <= 0) return null;
  return Math.round((success / opp) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const viewerUserId = callerData.user.id;
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();

    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("role")
      .eq("user_id", viewerUserId)
      .eq("is_active", true);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const roles = new Set(((membershipsRes.data ?? []) as Array<{ role: string | null }>).map((row) => String(row.role ?? "")));
    const isParent = roles.has("parent");

    let effectiveUserId = viewerUserId;
    if (isParent && childId) {
      const linkRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", viewerUserId)
        .eq("player_id", childId)
        .or("can_view.is.null,can_view.eq.true")
        .maybeSingle();
      if (linkRes.error) return NextResponse.json({ error: linkRes.error.message }, { status: 400 });
      if (linkRes.data?.player_id) effectiveUserId = String(linkRes.data.player_id);
    }
    if (isParent && effectiveUserId === viewerUserId) {
      const childrenRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id,is_primary")
        .eq("guardian_user_id", viewerUserId)
        .or("can_view.is.null,can_view.eq.true")
        .order("is_primary", { ascending: false })
        .limit(1);
      if (childrenRes.error) return NextResponse.json({ error: childrenRes.error.message }, { status: 400 });
      const fallbackChildId = String(childrenRes.data?.[0]?.player_id ?? "").trim();
      if (fallbackChildId) effectiveUserId = fallbackChildId;
    }

    const { curStart, curEnd } = rollingYearWindows(new Date());
    const roundsRes = await supabaseAdmin
      .from("golf_rounds")
      .select("id,start_at,gir,fairways_hit,fairways_total,total_putts,eagles,birdies,pars,bogeys,doubles_plus")
      .eq("user_id", effectiveUserId)
      .gte("start_at", curStart.toISOString())
      .lt("start_at", curEnd.toISOString())
      .order("start_at", { ascending: false });

    if (roundsRes.error) return NextResponse.json({ error: roundsRes.error.message }, { status: 400 });

    const rounds = (roundsRes.data ?? []) as Array<{
      id: string;
      start_at: string | null;
      gir: number | null;
      fairways_hit: number | null;
      fairways_total: number | null;
      total_putts: number | null;
      eagles: number | null;
      birdies: number | null;
      pars: number | null;
      bogeys: number | null;
      doubles_plus: number | null;
    }>;

    if (rounds.length === 0) {
      return NextResponse.json({
        roundsCount: 0,
        holesPlayed: 0,
        girPctAvg: null,
        fwPctAvg: null,
        puttAvg: null,
        scramblingPct: null,
      });
    }

    let holesPlayed = 0;
    let girPctSum = 0;
    let girPctCount = 0;
    let fwPctSum = 0;
    let fwPctCount = 0;
    let puttSum = 0;
    let puttCount = 0;

    rounds.forEach((round) => {
      const played = roundPlayedHolesFromRound(round);
      holesPlayed += played;

      if (typeof round.gir === "number" && played > 0) {
        girPctSum += (round.gir / played) * 100;
        girPctCount += 1;
      }
      if (typeof round.fairways_hit === "number" && typeof round.fairways_total === "number" && round.fairways_total > 0) {
        fwPctSum += (round.fairways_hit / round.fairways_total) * 100;
        fwPctCount += 1;
      }
      if (played === 18 && typeof round.total_putts === "number") {
        puttSum += round.total_putts;
        puttCount += 1;
      }
    });

    const scramblingPct = estimatedScramblingPct(rounds);

    return NextResponse.json({
      roundsCount: rounds.length,
      holesPlayed,
      girPctAvg: girPctCount > 0 ? Math.round((girPctSum / girPctCount) * 10) / 10 : null,
      fwPctAvg: fwPctCount > 0 ? Math.round((fwPctSum / fwPctCount) * 10) / 10 : null,
      puttAvg: puttCount > 0 ? Math.round((puttSum / puttCount) * 10) / 10 : null,
      scramblingPct,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
