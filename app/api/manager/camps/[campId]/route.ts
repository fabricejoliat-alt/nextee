/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  assertManagerForClub,
  createAdminClient,
  deleteClubEventDeep,
  getCaller,
  normalizeText,
  uniq,
} from "@/app/api/camps/_lib";
import { saveManagerCamp } from "@/lib/server/managerCampSave";
import type { CampCreateDayInput } from "@/app/api/manager/camps/route";

function uniqIds(values: unknown) {
  return uniq(Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : []);
}

const VALID_CAMP_DAY_STATUSES = new Set(["expected", "present", "absent", "excused", "not_registered"]);

function normalizeDayStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_DAY_STATUSES.has(normalized) ? normalized : "expected";
}

async function resolveCamp(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  campId: string
): Promise<{ error: string; status: number } | { camp: { id: string; club_id: string } }> {
  const campRes = await supabaseAdmin.from("club_camps").select("id,club_id").eq("id", campId).maybeSingle();
  if (campRes.error) return { error: campRes.error.message, status: 400 };
  if (!campRes.data?.id) return { error: "Stage/camp introuvable.", status: 404 };
  return { camp: { id: String(campRes.data.id), club_id: String(campRes.data.club_id ?? "").trim() } };
}

async function deleteCampDays(supabaseAdmin: ReturnType<typeof createAdminClient>, campId: string) {
  const dayIdsRes = await supabaseAdmin.from("club_camp_days").select("event_id").eq("camp_id", campId).order("day_index", { ascending: true });
  if (dayIdsRes.error) return { error: dayIdsRes.error.message, status: 400 as const };

  const eventIds = uniq((dayIdsRes.data ?? []).map((row: any) => row.event_id));
  for (const eventId of eventIds) {
    const deleted = await deleteClubEventDeep(supabaseAdmin, eventId);
    if ("error" in deleted) return deleted;
  }
  return { ok: true as const };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ campId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await ctx.params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const title = normalizeText(body?.title);
    const headCoachUserId = normalizeText(body?.head_coach_user_id) || null;
    const groupIds = uniqIds(body?.group_ids);
    const playerIds = uniqIds(body?.player_ids);
    const days = (Array.isArray(body?.days) ? body.days : []) as CampCreateDayInput[];
    const action = normalizeText(body?.action);
    const status = ["draft", "scheduled", "cancelled"].includes(normalizeText(body?.status)) ? normalizeText(body?.status) : "scheduled";
    const capacityRaw = body?.capacity == null || body.capacity === "" ? null : Number(body.capacity);
    const capacity = capacityRaw != null && Number.isFinite(capacityRaw) ? Math.max(1, Math.trunc(capacityRaw)) : null;

    if (!action && !title) return NextResponse.json({ error: "Le nom du stage est requis." }, { status: 400 });
    if (!action && status !== "draft" && !headCoachUserId) return NextResponse.json({ error: "Le head coach est requis pour planifier le stage." }, { status: 400 });
    if (!action && status !== "draft" && groupIds.length === 0 && playerIds.length === 0) return NextResponse.json({ error: "Ajoutez au moins un groupe ou un junior." }, { status: 400 });
    if (!action && status !== "draft" && days.length === 0) return NextResponse.json({ error: "Ajoutez au moins une journée." }, { status: 400 });
    if (!action && days.length > 0 && !headCoachUserId) return NextResponse.json({ error: "Un head coach est requis dès qu’une journée est définie." }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const resolved = await resolveCamp(supabaseAdmin, campId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, resolved.camp.club_id);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    if (action === "archive") {
      const archiveRes = await supabaseAdmin.from("club_camps").update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campId);
      if (archiveRes.error) return NextResponse.json({ error: archiveRes.error.message }, { status: 400 });
      return NextResponse.json({ ok: true, camp_id: campId });
    }

    if (action === "set_attendance") {
      const eventId = normalizeText(body?.event_id);
      const updates = (Array.isArray(body?.attendance_updates) ? body.attendance_updates : [])
        .map((entry: any) => ({ player_id: normalizeText(entry?.player_id), status: normalizeDayStatus(entry?.status) }))
        .filter((entry: { player_id: string }) => entry.player_id);
      if (!eventId || updates.length === 0) return NextResponse.json({ error: "Présences manquantes." }, { status: 400 });
      const dayCheck = await supabaseAdmin.from("club_camp_days").select("event_id").eq("camp_id", campId).eq("event_id", eventId).maybeSingle();
      if (dayCheck.error) return NextResponse.json({ error: dayCheck.error.message }, { status: 400 });
      if (!dayCheck.data?.event_id) return NextResponse.json({ error: "Journée introuvable." }, { status: 404 });
      const participantsRes = await supabaseAdmin.from("club_camp_players").select("player_id").eq("camp_id", campId);
      if (participantsRes.error) return NextResponse.json({ error: participantsRes.error.message }, { status: 400 });
      const allowed = new Set((participantsRes.data ?? []).map((row: any) => String(row.player_id)));
      const safeUpdates = updates.filter((entry: { player_id: string }) => allowed.has(entry.player_id));
      if (safeUpdates.length !== updates.length) return NextResponse.json({ error: "Un junior ne fait pas partie de ce stage." }, { status: 400 });
      const upsertRes = await supabaseAdmin.from("club_event_attendees").upsert(
        safeUpdates.map((entry: { player_id: string; status: string }) => ({ event_id: eventId, ...entry })),
        { onConflict: "event_id,player_id" }
      );
      if (upsertRes.error) return NextResponse.json({ error: upsertRes.error.message }, { status: 400 });
      return NextResponse.json({ ok: true, camp_id: campId });
    }

    const saved = await saveManagerCamp(supabaseAdmin, caller.userId, campId, resolved.camp.club_id, { ...body, status, capacity });
    return NextResponse.json(saved.data, { status: saved.status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ campId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await ctx.params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const resolved = await resolveCamp(supabaseAdmin, campId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, resolved.camp.club_id);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    const deleteDaysRes = await deleteCampDays(supabaseAdmin, campId);
    if ("error" in deleteDaysRes) return NextResponse.json({ error: deleteDaysRes.error }, { status: deleteDaysRes.status });

    const deleteCampRes = await supabaseAdmin.from("club_camps").delete().eq("id", campId);
    if (deleteCampRes.error) return NextResponse.json({ error: deleteCampRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, deleted_camp_id: campId });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
