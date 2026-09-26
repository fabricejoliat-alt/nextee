import { isOrgStaffMember } from "@/app/api/messages/_lib";
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
  if (event.club_id && (await isOrgStaffMember(supabaseAdmin, event.club_id, callerId))) return event;

  const [headRes, assistantRes, assignedRes] = await Promise.all([
    supabaseAdmin.from("coach_groups").select("id").eq("id", event.group_id).eq("head_coach_user_id", callerId).maybeSingle(),
    supabaseAdmin.from("coach_group_coaches").select("id").eq("group_id", event.group_id).eq("coach_user_id", callerId).maybeSingle(),
    supabaseAdmin.from("club_event_coaches").select("event_id").eq("event_id", eventId).eq("coach_id", callerId).maybeSingle(),
  ]);
  if (headRes.error) throw new Error(headRes.error.message);
  if (assistantRes.error) throw new Error(assistantRes.error.message);
  if (assignedRes.error) throw new Error(assignedRes.error.message);
  if (!headRes.data?.id && !assistantRes.data?.id && !assignedRes.data?.event_id) throw new Error("forbidden");
  return event;
}
