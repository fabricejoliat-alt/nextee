import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rulesSeasonClubLeaderboard, rulesSeasonPlayerLeaderboard, type RulesSeasonAttemptScore } from "@/lib/rulesLearning";

function db() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }); }

type Database = ReturnType<typeof db>;
type Attempt = { id: string; series_id: string; player_user_id: string; club_id: string; question_order: string[] | null; total_score: number | null; submitted_at: string | null };

async function loadPlayerLeaderboard(admin: Database, seriesIds: string[], season: Record<string, unknown>, playerClubIds: string[], userId: string) {
  const attempts: Attempt[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("rules_quiz_attempts")
      .select("id,series_id,player_user_id,club_id,question_order,total_score,submitted_at")
      .in("series_id", seriesIds).eq("status", "submitted").order("submitted_at", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    attempts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const clubIdsByAttempt = new Map<string, string[]>();
  for (let offset = 0; offset < attempts.length; offset += 500) {
    const attemptIds = attempts.slice(offset, offset + 500).map(item => item.id);
    if (!attemptIds.length) continue;
    const { data, error } = await admin.from("rules_quiz_attempt_clubs").select("attempt_id,club_id").in("attempt_id", attemptIds);
    if (error) throw error;
    for (const link of data ?? []) clubIdsByAttempt.set(link.attempt_id, [...(clubIdsByAttempt.get(link.attempt_id) ?? []), link.club_id]);
  }
  for (const attempt of attempts) {
    if (!clubIdsByAttempt.has(attempt.id)) clubIdsByAttempt.set(attempt.id, [attempt.club_id]);
  }

  const clubIds = [...new Set([...clubIdsByAttempt.values()].flat().concat(playerClubIds))];
  const playerIdsInMyClubs = [...new Set(attempts
    .filter(item => (clubIdsByAttempt.get(item.id) ?? []).some(id => playerClubIds.includes(id)))
    .map(item => item.player_user_id))];
  const [{ data: clubs, error: clubsError }, { data: participations, error: participationsError }, { data: profiles, error: profilesError }] = await Promise.all([
    clubIds.length ? admin.from("clubs").select("id,name").in("id", clubIds) : Promise.resolve({ data: [], error: null }),
    admin.from("rules_club_participations").select("club_id,enabled,visibility,retained_scores_override,minimum_participants_override").eq("season_id", String(season.id)),
    playerIdsInMyClubs.length
      ? admin.from("profiles").select("id,first_name,last_name").in("id", playerIdsInMyClubs)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (clubsError || participationsError || profilesError) throw clubsError ?? participationsError ?? profilesError;
  const clubNames = new Map((clubs ?? []).map(item => [item.id, item.name]));
  const participationByClub = new Map((participations ?? []).map(item => [item.club_id, item]));
  const profileById = new Map((profiles ?? []).map(item => [item.id, item]));
  const pointsPerCorrect = Number(season.points_per_correct ?? 100);
  const maxSpeedBonus = season.speed_bonus_enabled === false ? 0 : Number(season.max_speed_bonus ?? 15);
  const perfectBonus = Number(season.perfect_bonus ?? 50);
  const minimumSeries = Number(season.minimum_player_series ?? 4);
  const validAttempts = attempts.filter(item => Number.isFinite(item.total_score));
  const seasonAttempts: RulesSeasonAttemptScore[] = validAttempts.flatMap(item => {
    const questionCount = Math.max(1, item.question_order?.length ?? 6);
    return (clubIdsByAttempt.get(item.id) ?? [item.club_id])
      .filter(clubId => participationByClub.get(clubId)?.enabled !== false)
      .map(clubId => ({
      seriesId: item.series_id,
      playerId: item.player_user_id,
      clubId,
      score: Number(item.total_score),
      possible: questionCount * (pointsPerCorrect + maxSpeedBonus) + perfectBonus,
      submittedAt: String(item.submitted_at ?? ""),
    }));
  });
  const seasonPlayers = rulesSeasonPlayerLeaderboard(seasonAttempts, minimumSeries);
  const playerClubs = playerClubIds.map(clubId => {
    const visibility = participationByClub.get(clubId)?.visibility ?? "first_initial";
    const playerRows = seasonPlayers.filter(item => item.clubId === clubId).map((item) => {
      const profile = profileById.get(item.playerId);
      const first = String(profile?.first_name ?? "").trim();
      const last = String(profile?.last_name ?? "").trim();
      const name = visibility === "anonymous" ? null : visibility === "display_name"
        ? [first, last].filter(Boolean).join(" ") || null
        : [first, last ? `${last[0]}.` : ""].filter(Boolean).join(" ") || null;
      return { rank: item.rank, name, score: item.percentage, eligible: item.eligible, completedSeries: item.completedSeries, minimumSeries, rawPoints: item.rawPoints, possiblePoints: item.possiblePoints, isMe: item.playerId === userId };
    });
    const visiblePlayers = playerRows.slice(0, 5);
    const myPlayerRow = playerRows.find(item => item.isMe);
    if (myPlayerRow && !visiblePlayers.some(item => item.isMe)) visiblePlayers.push(myPlayerRow);
    return { clubId, name: clubNames.get(clubId) ?? "Mon club", participants: playerRows.length, rows: visiblePlayers };
  });

  const rankedClubs = rulesSeasonClubLeaderboard(seasonPlayers, id => Number(participationByClub.get(id)?.minimum_participants_override ?? season.minimum_club_participants ?? 5))
    .map(item => ({ ...item, name: clubNames.get(item.clubId) ?? "Club", score: Math.round(item.score * 10) / 10, isMyClub: playerClubIds.includes(item.clubId) }));
  const visibleClubs = rankedClubs.filter(item => item.eligible).slice(0, 5);
  for (const myClubRow of rankedClubs.filter(item => item.isMyClub)) {
    if (!visibleClubs.some(item => item.clubId === myClubRow.clubId)) visibleClubs.push(myClubRow);
  }
  return { status: "published" as const, publishedSeries: seriesIds.length, minimumSeries, clubs: playerClubs, interclub: { minimumParticipants: Number(season.minimum_club_participants ?? 5), rows: visibleClubs } };
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
  const now = new Date();
  const requestedSeriesId = req.nextUrl.searchParams.get("series_id");
  const naturalCurrent = [...(series ?? [])].reverse().find((item) => new Date(item.discovery_starts_at) <= now && (!item.archived_at || new Date(item.archived_at) > now)) ?? series?.[0] ?? null;
  const requestedSeries = requestedSeriesId ? (series ?? []).find((item) => item.id === requestedSeriesId && (isAdmin || role !== "player" || new Date(item.discovery_starts_at) <= now)) ?? null : null;
  const current = requestedSeries ?? naturalCurrent;
  const playerClubIds = [...new Set((memberships ?? []).filter(item => item.role === "player").map(item => item.club_id))];
  const { data: playerParticipations } = role === "player" && playerClubIds.length
    ? await admin.from("rules_club_participations").select("club_id,enabled,joined_at").eq("season_id", season.id).in("club_id", playerClubIds)
    : { data: [] };
  const participationByPlayerClub = new Map((playerParticipations ?? []).map(item => [item.club_id, item]));
  const quizClubId = current ? playerClubIds.find(clubId => {
    const participation = participationByPlayerClub.get(clubId);
    return participation?.enabled !== false && (
      (now >= new Date(current.quiz_opens_at) && now <= new Date(current.quiz_closes_at))
      || Boolean(participation?.joined_at && new Date(participation.joined_at) > new Date(current.quiz_closes_at))
    );
  }) ?? null : null;
  const quizAvailable = Boolean(role === "player" && current && quizClubId);
  let cards: unknown[] = [];
  if (current) {
    const { data } = await admin.from("rules_series_cards").select("position,card_version_id,rules_card_versions(id,title,situation,simple_explanation,action_text,common_mistake,coach_tip,official_reference,image_url,image_alt,human_review_required,approved_at)").eq("series_id", current.id).order("position");
    cards = data ?? [];
  }
  const { data: progress } = role === "player"
    ? await admin.from("rules_card_progress").select("card_version_id,first_read_at,last_read_at,review_count").eq("player_user_id", userId)
    : { data: [] };
  const { data: quizAttempt, error: quizAttemptError } = role === "player" && current
    ? await admin.from("rules_quiz_attempts").select("id,status,submitted_at,total_score,correct_count").eq("series_id", current.id).eq("player_user_id", userId).maybeSingle()
    : { data: null, error: null };
  if (quizAttemptError) console.error("Rules quiz attempt unavailable", quizAttemptError);
  let leaderboard = null;
  if (role === "player" && current) {
    const publishedSeriesIds = (series ?? []).filter(item => item.results_published_at && new Date(item.results_published_at) <= now).map(item => item.id);
    const nextPublication = (series ?? []).map(item => item.results_published_at).filter((value): value is string => Boolean(value && new Date(value) > now)).sort()[0] ?? null;
    if (!publishedSeriesIds.length) leaderboard = { status: "upcoming", publishesAt: nextPublication };
    else {
      try {
        leaderboard = await loadPlayerLeaderboard(admin, publishedSeriesIds, season, playerClubIds, userId);
      } catch (leaderboardError) {
        console.error("Rules leaderboard unavailable", leaderboardError);
        leaderboard = { status: "unavailable" };
      }
    }
  }
  return NextResponse.json({ role, clubId: quizClubId ?? playerClubIds[0] ?? memberships?.[0]?.club_id ?? null, season, series: series ?? [], currentSeriesId: current?.id ?? null, quizAvailable, cards, progress: progress ?? [], quizAttempt, leaderboard }, { headers: { "Cache-Control": "private, max-age=30" } });
}
