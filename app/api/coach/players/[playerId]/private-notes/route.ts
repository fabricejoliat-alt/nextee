import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

type PrivateNoteRow = {
  id: string;
  event_id: string;
  organization_id: string;
  player_id: string;
  author_coach_id: string;
  body: string;
  source: string;
  source_report_version: number;
  validated_at: string;
  created_at: string;
};

type PrivateNoteEventRow = { id: string; group_id: string | null; title: string | null; starts_at: string | null };
type PrivateNoteAuthorRow = { id: string; first_name: string | null; last_name: string | null };

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId: rawPlayerId } = await ctx.params;
    const playerId = String(rawPlayerId ?? "").trim();
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (!access.canAccessSensitiveSections) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const notesRes = await supabaseAdmin
      .from("coach_player_private_notes")
      .select("id,event_id,organization_id,player_id,author_coach_id,body,source,source_report_version,validated_at,created_at")
      .eq("player_id", playerId)
      .in("organization_id", access.sharedClubIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (notesRes.error) throw new Error(notesRes.error.message);

    const rows = (notesRes.data ?? []) as PrivateNoteRow[];
    const eventIds = unique(rows.map((row) => row.event_id));
    const authorIds = unique(rows.map((row) => row.author_coach_id));
    const [eventsRes, authorsRes] = await Promise.all([
      eventIds.length
        ? supabaseAdmin.from("club_events").select("id,group_id,title,starts_at").in("id", eventIds)
        : Promise.resolve({ data: [], error: null }),
      authorIds.length
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (authorsRes.error) throw new Error(authorsRes.error.message);

    const eventById = new Map(
      ((eventsRes.data ?? []) as PrivateNoteEventRow[]).map((row) => [String(row.id), row])
    );
    const authorById = new Map(
      ((authorsRes.data ?? []) as PrivateNoteAuthorRow[]).map((row) => [String(row.id), row])
    );
    const notes = rows.map((row) => {
      const event = eventById.get(String(row.event_id));
      const author = authorById.get(String(row.author_coach_id));
      return {
        ...row,
        event_title: String(event?.title ?? "").trim() || null,
        event_starts_at: event?.starts_at ?? null,
        event_group_id: event?.group_id ?? null,
        author_name:
          `${String(author?.first_name ?? "").trim()} ${String(author?.last_name ?? "").trim()}`.trim() || null,
      };
    });
    return NextResponse.json({ notes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
