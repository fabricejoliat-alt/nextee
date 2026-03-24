import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, minutesBetween, normalizeText, resolvePlayerAccess } from "@/app/api/camps/_lib";

type DraftItem = {
  category?: string | null;
  minutes?: number | string | null;
  note?: string | null;
};

type DraftDay = {
  session_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  location_text?: string | null;
  items?: DraftItem[] | null;
};

async function assertCampOwnership(supabaseAdmin: ReturnType<typeof createAdminClient>, campId: string, userId: string) {
  const campRes = await supabaseAdmin
    .from("player_camps")
    .select("id,user_id,title,coach_name,notes,status")
    .eq("id", campId)
    .eq("user_id", userId)
    .maybeSingle();
  if (campRes.error) return { error: campRes.error.message, status: 400 as const };
  if (!campRes.data?.id) return { error: "Not found", status: 404 as const };
  return { camp: campRes.data as any };
}

async function deleteSessionDeep(supabaseAdmin: ReturnType<typeof createAdminClient>, sessionId: string) {
  const delItemsRes = await supabaseAdmin.from("training_session_items").delete().eq("session_id", sessionId);
  if (delItemsRes.error) return { error: delItemsRes.error.message, status: 400 as const };

  const delDayRes = await supabaseAdmin.from("player_camp_days").delete().eq("session_id", sessionId);
  if (delDayRes.error) return { error: delDayRes.error.message, status: 400 as const };

  const delSessionRes = await supabaseAdmin.from("training_sessions").delete().eq("id", sessionId);
  if (delSessionRes.error) return { error: delSessionRes.error.message, status: 400 as const };

  return { ok: true as const };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const childId = normalizeText(new URL(req.url).searchParams.get("child_id"));
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const owned = await assertCampOwnership(supabaseAdmin, campId, access.effectiveUserId);
    if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

    const daysRes = await supabaseAdmin
      .from("player_camp_days")
      .select("session_id,day_index,starts_at,ends_at,location_text")
      .eq("camp_id", campId)
      .order("day_index", { ascending: true });
    if (daysRes.error) return NextResponse.json({ error: daysRes.error.message }, { status: 400 });

    const sessionIds = (daysRes.data ?? []).map((row: any) => String(row.session_id ?? "").trim()).filter(Boolean);
    const itemsRes = sessionIds.length
      ? await supabaseAdmin
          .from("training_session_items")
          .select("session_id,category,minutes,note")
          .in("session_id", sessionIds)
          .order("created_at", { ascending: true })
      : ({ data: [], error: null } as const);
    if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 400 });

    const itemsBySessionId: Record<string, Array<{ category: string; minutes: number; note: string | null }>> = {};
    (itemsRes.data ?? []).forEach((row: any) => {
      const sessionId = String(row.session_id ?? "").trim();
      if (!sessionId) return;
      if (!itemsBySessionId[sessionId]) itemsBySessionId[sessionId] = [];
      itemsBySessionId[sessionId].push({
        category: String(row.category ?? ""),
        minutes: Number(row.minutes ?? 0),
        note: row.note ?? null,
      });
    });

    return NextResponse.json({
      camp: {
        ...owned.camp,
        days: (daysRes.data ?? []).map((row: any) => ({
          session_id: String(row.session_id ?? "").trim(),
          day_index: Number(row.day_index ?? 0),
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          location_text: row.location_text ?? null,
          items: itemsBySessionId[String(row.session_id ?? "").trim()] ?? [],
        })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const childId = normalizeText(body?.child_id);
    const title = normalizeText(body?.title);
    const coachName = normalizeText(body?.coach_name) || null;
    const notes = normalizeText(body?.notes) || null;
    const days = (Array.isArray(body?.days) ? body.days : []) as DraftDay[];

    if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });
    if (days.length === 0) return NextResponse.json({ error: "Missing days" }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const owned = await assertCampOwnership(supabaseAdmin, campId, access.effectiveUserId);
    if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

    for (let i = 0; i < days.length; i += 1) {
      const day = days[i] ?? {};
      const startsAt = normalizeText(day.starts_at);
      const endsAt = normalizeText(day.ends_at);
      const duration = minutesBetween(startsAt, endsAt);
      if (!startsAt || !endsAt || duration <= 0) {
        return NextResponse.json({ error: `Invalid day ${i + 1}` }, { status: 400 });
      }
    }

    const updCampRes = await supabaseAdmin
      .from("player_camps")
      .update({
        title,
        coach_name: coachName,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campId);
    if (updCampRes.error) return NextResponse.json({ error: updCampRes.error.message }, { status: 400 });

    const existingDaysRes = await supabaseAdmin
      .from("player_camp_days")
      .select("session_id,day_index")
      .eq("camp_id", campId)
      .order("day_index", { ascending: true });
    if (existingDaysRes.error) return NextResponse.json({ error: existingDaysRes.error.message }, { status: 400 });

    const existingSessionIds = new Set((existingDaysRes.data ?? []).map((row: any) => String(row.session_id ?? "").trim()).filter(Boolean));
    const nextSessionIds = new Set(days.map((day) => normalizeText(day.session_id)).filter(Boolean));

    for (const sessionId of existingSessionIds) {
      if (nextSessionIds.has(sessionId)) continue;
      const del = await deleteSessionDeep(supabaseAdmin, sessionId);
      if ("error" in del) return NextResponse.json({ error: del.error }, { status: del.status });
    }

    for (let i = 0; i < days.length; i += 1) {
      const day = days[i] ?? {};
      const sessionId = normalizeText(day.session_id);
      const startsAt = normalizeText(day.starts_at);
      const endsAt = normalizeText(day.ends_at);
      const locationText = normalizeText(day.location_text) || null;
      const duration = minutesBetween(startsAt, endsAt);
      const items = (Array.isArray(day.items) ? day.items : [])
        .map((item) => ({
          category: normalizeText(item?.category),
          minutes: Number(item?.minutes ?? 0),
          note: normalizeText(item?.note) || null,
        }))
        .filter((item) => item.category && Number.isFinite(item.minutes) && item.minutes > 0);

      let finalSessionId = sessionId;

      if (sessionId) {
        const updSessionRes = await supabaseAdmin
          .from("training_sessions")
          .update({
            start_at: startsAt,
            location_text: locationText,
            coach_name: coachName,
            total_minutes: duration,
          })
          .eq("id", sessionId)
          .eq("user_id", access.effectiveUserId);
        if (updSessionRes.error) return NextResponse.json({ error: updSessionRes.error.message }, { status: 400 });

        const updDayRes = await supabaseAdmin
          .from("player_camp_days")
          .update({
            day_index: i,
            starts_at: startsAt,
            ends_at: endsAt,
            location_text: locationText,
            updated_at: new Date().toISOString(),
          })
          .eq("camp_id", campId)
          .eq("session_id", sessionId);
        if (updDayRes.error) return NextResponse.json({ error: updDayRes.error.message }, { status: 400 });

        const delItemsRes = await supabaseAdmin.from("training_session_items").delete().eq("session_id", sessionId);
        if (delItemsRes.error) return NextResponse.json({ error: delItemsRes.error.message }, { status: 400 });
      } else {
        const insertSessionRes = await supabaseAdmin
          .from("training_sessions")
          .insert({
            user_id: access.effectiveUserId,
            start_at: startsAt,
            location_text: locationText,
            session_type: "individual",
            club_id: null,
            coach_name: coachName,
            motivation: null,
            difficulty: null,
            satisfaction: null,
            notes: null,
            total_minutes: duration,
            club_event_id: null,
          })
          .select("id")
          .single();
        if (insertSessionRes.error || !insertSessionRes.data?.id) {
          return NextResponse.json({ error: insertSessionRes.error?.message ?? `Unable to create day ${i + 1}` }, { status: 400 });
        }
        finalSessionId = String(insertSessionRes.data.id);

        const insDayRes = await supabaseAdmin.from("player_camp_days").insert({
          camp_id: campId,
          session_id: finalSessionId,
          day_index: i,
          starts_at: startsAt,
          ends_at: endsAt,
          location_text: locationText,
        });
        if (insDayRes.error) return NextResponse.json({ error: insDayRes.error.message }, { status: 400 });
      }

      if (items.length > 0) {
        const insItemsRes = await supabaseAdmin.from("training_session_items").insert(
          items.map((item) => ({
            session_id: finalSessionId,
            category: item.category,
            minutes: item.minutes,
            note: item.note,
          }))
        );
        if (insItemsRes.error) return NextResponse.json({ error: insItemsRes.error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true, campId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
