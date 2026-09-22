import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clubLeaderboard, type ClubScore } from "@/lib/rulesLearning";

function db() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }); }

type Database = ReturnType<typeof db>;
type Attempt = { player_user_id: string; club_id: string; total_score: number | null; correct_count: number | null; perfect_bonus: number | null; speed_bonus: number | null; submitted_at: string | null };

async function loadPlayerLeaderboard(admin: Database, seriesId: string, season: Record<string, unknown>, clubId: string | null, userId: string) {
  const attempts: Attempt[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("rules_quiz_attempts")
      .select("player_user_id,club_id,total_score,correct_count,perfect_bonus,speed_bonus,submitted_at")
      .eq("series_id", seriesId).eq("status", "submitted").order("submitted_at", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    attempts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const clubIds = [...new Set(attempts.map(item => item.club_id))];
  const [{ data: clubs, error: clubsError }, { data: participations, error: participationsError }, { data: profiles, error: profilesError }] = await Promise.all([
    clubIds.length ? admin.from("clubs").select("id,name").in("id", clubIds) : Promise.resolve({ data: [], error: null }),
    admin.from("rules_club_participations").select("club_id,enabled,visibility,retained_scores_override,minimum_participants_override").eq("season_id", String(season.id)),
    clubId && attempts.some(item => item.club_id === clubId)
      ? admin.from("profiles").select("id,first_name,last_name").in("id", attempts.filter(item => item.club_id === clubId).map(item => item.player_user_id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (clubsError || participationsError || profilesError) throw clubsError ?? participationsError ?? profilesError;
  const clubNames = new Map((clubs ?? []).map(item => [item.id, item.name]));
  const participationByClub = new Map((participations ?? []).map(item => [item.club_id, item]));
  const profileById = new Map((profiles ?? []).map(item => [item.id, item]));
  const validAttempts = attempts.filter(item => Number.isFinite(item.total_score) && participationByClub.get(item.club_id)?.enabled !== false);
  const sortedPlayers = validAttempts.filter(item => item.club_id === clubId).sort((a, b) =>
    Number(b.total_score) - Number(a.total_score) || Number(b.correct_count) - Number(a.correct_count)
    || Number(b.perfect_bonus) - Number(a.perfect_bonus) || Number(b.speed_bonus) - Number(a.speed_bonus)
    || String(a.submitted_at).localeCompare(String(b.submitted_at)));
  const visibility = clubId ? participationByClub.get(clubId)?.visibility ?? "first_initial" : "first_initial";
  const playerRows = sortedPlayers.map((item, index) => {
    const profile = profileById.get(item.player_user_id);
    const first = String(profile?.first_name ?? "").trim();
    const last = String(profile?.last_name ?? "").trim();
    const name = visibility === "anonymous" ? null : visibility === "display_name"
      ? [first, last].filter(Boolean).join(" ") || null
      : [first, last ? `${last[0]}.` : ""].filter(Boolean).join(" ") || null;
    return { rank: index + 1, name, score: Number(item.total_score), isMe: item.player_user_id === userId };
  });
  const visiblePlayers = playerRows.slice(0, 5);
  const myPlayerRow = playerRows.find(item => item.isMe);
  if (myPlayerRow && myPlayerRow.rank > 5) visiblePlayers.push(myPlayerRow);

  const byClub = new Map<string, ClubScore[]>();
  for (const item of validAttempts) {
    const rows = byClub.get(item.club_id) ?? [];
    rows.push({ clubId: item.club_id, score: Number(item.total_score), correct: Number(item.correct_count ?? 0), perfect: Number(item.perfect_bonus ?? 0) > 0, speed: Number(item.speed_bonus ?? 0), submittedAt: String(item.submitted_at ?? "") });
    byClub.set(item.club_id, rows);
  }
  const interclubRows = [...byClub.entries()].map(([id, rows]) => {
    const settings = participationByClub.get(id);
    const retained = settings?.retained_scores_override === 15 ? 15 : settings?.retained_scores_override === 10 ? 10 : season.retained_scores === 15 ? 15 : 10;
    const minimum = Number(settings?.minimum_participants_override ?? season.minimum_club_participants ?? 3);
    const result = clubLeaderboard(rows, retained, minimum)[0];
    return { clubId: id, name: clubNames.get(id) ?? "Club", participants: result.participants, eligible: result.eligible, score: Math.round(result.score * 10) / 10, minimum };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || b.participants - a.participants || a.name.localeCompare(b.name));
  let eligibleRank = 0;
  const rankedClubs = interclubRows.map(item => ({ ...item, rank: item.eligible ? ++eligibleRank : null, isMyClub: item.clubId === clubId }));
  const visibleClubs = rankedClubs.filter(item => item.eligible).slice(0, 5);
  const myClubRow = rankedClubs.find(item => item.isMyClub);
  if (myClubRow && !visibleClubs.some(item => item.isMyClub)) visibleClubs.push(myClubRow);
  return { status: "published" as const, club: { name: clubId ? clubNames.get(clubId) ?? "Mon club" : null, participants: playerRows.length, rows: visiblePlayers }, interclub: { retainedScores: Number(season.retained_scores ?? 10), rows: visibleClubs } };
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = db();
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = auth.data.user.id;
  const [{ data: appAdmin }, { data: memberships }] = await Promise.all([
    admin.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    admin.from("club_members").select("club_id,role,is_active").eq("user_id", userId).eq("is_active", true),
  ]);
  const isAdmin = Boolean(appAdmin);
  const role = isAdmin ? "admin" : String(memberships?.[0]?.role ?? "");
  if (!isAdmin && !["player", "parent", "coach", "manager"].includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let seasonQuery = admin.from("rules_seasons").select("*").order("created_at", { ascending: false }).limit(1);
  if (!isAdmin) seasonQuery = seasonQuery.in("status", ["published", "archived"]);
  const { data: seasons, error } = await seasonQuery;
  if (error) return NextResponse.json({ error: "Rules module is not migrated" }, { status: 503 });
  const season = seasons?.[0] ?? null;
  if (!season) return NextResponse.json({ role, clubId: memberships?.[0]?.club_id ?? null, season: null, series: [], cards: [], progress: [] });
  let seriesQuery = admin.from("rules_series").select("*").eq("season_id", season.id).order("position");
  if (!isAdmin) seriesQuery = seriesQuery.in("status", ["published", "locked", "archived"]);
  const { data: series } = await seriesQuery;
  const current = (series ?? []).find((item) => new Date(item.discovery_starts_at) <= new Date() && (!item.archived_at || new Date(item.archived_at) > new Date())) ?? series?.[0] ?? null;
  let cards: unknown[] = [];
  if (current) {
    const { data } = await admin.from("rules_series_cards").select("position,card_version_id,rules_card_versions(id,title,situation,simple_explanation,action_text,common_mistake,coach_tip,official_reference,image_url,image_alt,human_review_required,approved_at)").eq("series_id", current.id).order("position");
    cards = data ?? [];
  }
  const { data: progress } = role === "player"
    ? await admin.from("rules_card_progress").select("card_version_id,first_read_at,last_read_at,review_count").eq("player_user_id", userId)
    : { data: [] };
  let leaderboard = null;
  if (role === "player" && current) {
    const publishesAt = current.results_published_at ?? null;
    if (!publishesAt || new Date(publishesAt) > new Date()) leaderboard = { status: "upcoming", publishesAt };
    else {
      try {
        const playerClubId = memberships?.find(item => item.role === "player")?.club_id ?? null;
        leaderboard = await loadPlayerLeaderboard(admin, current.id, season, playerClubId, userId);
      } catch (leaderboardError) {
        console.error("Rules leaderboard unavailable", leaderboardError);
        leaderboard = { status: "unavailable" };
      }
    }
  }
  return NextResponse.json({ role, clubId: memberships?.[0]?.club_id ?? null, season, series: series ?? [], currentSeriesId: current?.id ?? null, cards, progress: progress ?? [], leaderboard }, { headers: { "Cache-Control": "private, max-age=30" } });
}
