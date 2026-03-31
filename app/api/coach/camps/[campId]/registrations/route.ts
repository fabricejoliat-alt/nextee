import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, getCaller, normalizeText, resolveCoachClubIds, uniq } from "@/app/api/camps/_lib";

type CampPlayerRegistrationInput = {
  player_id?: string | null;
  registration_status?: string | null;
  day_status_by_day_index?: Record<string, string | null | undefined> | null;
};

const VALID_CAMP_REGISTRATION_STATUSES = new Set(["invited", "registered", "declined"]);
const VALID_CAMP_DAY_STATUSES = new Set(["present", "absent"]);

function normalizeRegistrationStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_REGISTRATION_STATUSES.has(normalized) ? normalized : "invited";
}

function normalizeDayStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_DAY_STATUSES.has(normalized) ? normalized : "present";
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ campId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await ctx.params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const playerRegistrations = (Array.isArray(body?.player_registrations) ? body.player_registrations : []) as CampPlayerRegistrationInput[];

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const campRes = await supabaseAdmin.from("club_camps").select("id,club_id").eq("id", campId).maybeSingle();
    if (campRes.error) return NextResponse.json({ error: campRes.error.message }, { status: 400 });
    if (!campRes.data?.id) return NextResponse.json({ error: "Stage/camp introuvable." }, { status: 404 });

    const access = await resolveCoachClubIds(supabaseAdmin, caller.userId);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!access.clubIds.includes(String(campRes.data.club_id ?? "").trim())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [campPlayersRes, campDaysRes, clubPlayersRes] = await Promise.all([
      supabaseAdmin.from("club_camp_players").select("player_id,registration_status,registered_at").eq("camp_id", campId),
      supabaseAdmin.from("club_camp_days").select("event_id,day_index").eq("camp_id", campId).order("day_index", { ascending: true }),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", String(campRes.data.club_id ?? "").trim())
        .eq("role", "player")
        .eq("is_active", true),
    ]);
    if (campPlayersRes.error) return NextResponse.json({ error: campPlayersRes.error.message }, { status: 400 });
    if (campDaysRes.error) return NextResponse.json({ error: campDaysRes.error.message }, { status: 400 });
    if (clubPlayersRes.error) return NextResponse.json({ error: clubPlayersRes.error.message }, { status: 400 });

    const existingPlayerById = new Map<string, { registration_status: string; registered_at: string | null }>();
    (campPlayersRes.data ?? []).forEach((row: any) => {
      const playerId = String(row.player_id ?? "").trim();
      if (!playerId) return;
      existingPlayerById.set(playerId, {
        registration_status: normalizeRegistrationStatus(row.registration_status),
        registered_at: row.registered_at ?? null,
      });
    });

    const allowedPlayerIds = new Set((clubPlayersRes.data ?? []).map((row: any) => String(row.user_id ?? "").trim()).filter(Boolean));
    const registrationByPlayerId = new Map<
      string,
      { registration_status: string; registered_at: string | null; day_status_by_day_index: Record<string, string> }
    >();
    Array.from(new Set([...Array.from(existingPlayerById.keys()), ...Array.from(allowedPlayerIds)])).forEach((playerId) => {
      const existing = existingPlayerById.get(playerId);
      registrationByPlayerId.set(playerId, {
        registration_status: existing?.registration_status ?? "invited",
        registered_at: existing?.registered_at ?? null,
        day_status_by_day_index: {},
      });
    });

    playerRegistrations.forEach((registration) => {
      const playerId = normalizeText(registration?.player_id);
      if (!playerId || !registrationByPlayerId.has(playerId) || !allowedPlayerIds.has(playerId)) return;
      const next = registrationByPlayerId.get(playerId)!;
      const registrationStatus = normalizeRegistrationStatus(registration?.registration_status);
      next.registration_status = registrationStatus;
      next.registered_at =
        registrationStatus === "registered"
          ? existingPlayerById.get(playerId)?.registered_at ?? new Date().toISOString()
          : null;
      const rawDayStatuses = registration?.day_status_by_day_index ?? {};
      Object.entries(rawDayStatuses).forEach(([dayIndex, status]) => {
        next.day_status_by_day_index[String(dayIndex)] = normalizeDayStatus(status);
      });
    });

    const playerIds = Array.from(registrationByPlayerId.keys()).filter((playerId) => {
      const registration = registrationByPlayerId.get(playerId);
      if (!registration) return false;
      return existingPlayerById.has(playerId) || registration.registration_status !== "invited";
    });
    const deleteCampPlayersRes = await supabaseAdmin.from("club_camp_players").delete().eq("camp_id", campId);
    if (deleteCampPlayersRes.error) return NextResponse.json({ error: deleteCampPlayersRes.error.message }, { status: 400 });

    if (playerIds.length > 0) {
      const insertCampPlayersRes = await supabaseAdmin.from("club_camp_players").insert(
        playerIds.map((playerId) => ({
          camp_id: campId,
          player_id: playerId,
          registration_status: registrationByPlayerId.get(playerId)?.registration_status ?? "invited",
          registered_at: registrationByPlayerId.get(playerId)?.registered_at ?? null,
        }))
      );
      if (insertCampPlayersRes.error) return NextResponse.json({ error: insertCampPlayersRes.error.message }, { status: 400 });
    }

    for (const day of campDaysRes.data ?? []) {
      const eventId = String(day.event_id ?? "").trim();
      const dayIndex = String(day.day_index ?? 0);
      if (!eventId) continue;
      const deleteAttendeesRes = await supabaseAdmin.from("club_event_attendees").delete().eq("event_id", eventId);
      if (deleteAttendeesRes.error) return NextResponse.json({ error: deleteAttendeesRes.error.message }, { status: 400 });
      if (playerIds.length === 0) continue;
      const insertAttendeesRes = await supabaseAdmin.from("club_event_attendees").insert(
        playerIds.map((playerId) => {
          const registration = registrationByPlayerId.get(playerId);
          return {
            event_id: eventId,
            player_id: playerId,
            status:
              registration?.registration_status === "registered"
                ? registration.day_status_by_day_index[dayIndex] ?? "present"
                : "not_registered",
          };
        })
      );
      if (insertAttendeesRes.error) return NextResponse.json({ error: insertAttendeesRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, updated_player_ids: uniq(playerIds) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
