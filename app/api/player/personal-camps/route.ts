import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, minutesBetween, normalizeText, resolvePlayerAccess } from "@/app/api/camps/_lib";

type DraftItem = {
  category?: string | null;
  minutes?: number | string | null;
  note?: string | null;
};

type DraftDay = {
  starts_at?: string | null;
  ends_at?: string | null;
  location_text?: string | null;
  items?: DraftItem[] | null;
};

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

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

    for (let i = 0; i < days.length; i += 1) {
      const day = days[i] ?? {};
      const startsAt = normalizeText(day.starts_at);
      const endsAt = normalizeText(day.ends_at);
      const duration = minutesBetween(startsAt, endsAt);
      if (!startsAt || !endsAt || duration <= 0) {
        return NextResponse.json({ error: `Invalid day ${i + 1}` }, { status: 400 });
      }
    }

    const campRes = await supabaseAdmin
      .from("player_camps")
      .insert({
        user_id: access.effectiveUserId,
        title,
        coach_name: coachName,
        notes,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (campRes.error || !campRes.data?.id) {
      return NextResponse.json({ error: campRes.error?.message ?? "Unable to create camp" }, { status: 400 });
    }

    const campId = String(campRes.data.id);
    const createdSessionIds: string[] = [];

    for (let i = 0; i < days.length; i += 1) {
      const day = days[i] ?? {};
      const startsAt = normalizeText(day.starts_at);
      const endsAt = normalizeText(day.ends_at);
      const locationText = normalizeText(day.location_text) || null;
      const duration = minutesBetween(startsAt, endsAt);

      const sessionRes = await supabaseAdmin
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

      if (sessionRes.error || !sessionRes.data?.id) {
        return NextResponse.json({ error: sessionRes.error?.message ?? `Unable to create day ${i + 1}` }, { status: 400 });
      }

      const sessionId = String(sessionRes.data.id);
      createdSessionIds.push(sessionId);

      const dayRes = await supabaseAdmin.from("player_camp_days").insert({
        camp_id: campId,
        session_id: sessionId,
        day_index: i,
        starts_at: startsAt,
        ends_at: endsAt,
        location_text: locationText,
      });
      if (dayRes.error) return NextResponse.json({ error: dayRes.error.message }, { status: 400 });

      const items = (Array.isArray(day.items) ? day.items : [])
        .map((item) => ({
          category: normalizeText(item?.category),
          minutes: Number(item?.minutes ?? 0),
          note: normalizeText(item?.note) || null,
        }))
        .filter((item) => item.category && Number.isFinite(item.minutes) && item.minutes > 0);

      if (items.length > 0) {
        const itemsRes = await supabaseAdmin.from("training_session_items").insert(
          items.map((item) => ({
            session_id: sessionId,
            category: item.category,
            minutes: item.minutes,
            note: item.note,
          }))
        );
        if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ campId, sessionIds: createdSessionIds });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
