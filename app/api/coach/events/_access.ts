import { canCoachAccessEvent } from "@/lib/coachAccess";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CoachEventAccessRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  status: string;
};

export async function requireCoachEventAccess(
  supabaseAdmin: SupabaseClient,
  callerId: string,
  eventId: string
): Promise<CoachEventAccessRow> {
  const eventRes = await supabaseAdmin
    .from("club_events")
    .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,status")
    .eq("id", eventId)
    .maybeSingle();
  if (eventRes.error) throw new Error(eventRes.error.message);
  if (!eventRes.data?.id) throw new Error("event_not_found");

  const event = eventRes.data as CoachEventAccessRow;
  if (!(await canCoachAccessEvent(supabaseAdmin, callerId, eventId, event.group_id, event.club_id))) {
    throw new Error("forbidden");
  }
  return event;
}
