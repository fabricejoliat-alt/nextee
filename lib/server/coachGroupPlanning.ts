import { authorizedCoachPlayers } from "@/lib/coachAccess";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachPlanningData, CoachPlanningEvent, CoachPlanningPerson } from "../coachPlanning.ts";
import { loadCoachPreparationStatus } from "./coachPreparationStatus";
import { coachClubCount } from "./coachClubCount";
import { loadCoachEvaluationState } from "@/lib/server/coachEvaluation";

export class CoachPlanningAccessError extends Error {
  constructor(public status: number) { super(status === 404 ? "group_not_found" : "forbidden"); }
}

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error("planning_load_failed");
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}
function chunks<T>(values: T[], size = 150) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}
type EventSource = Omit<CoachPlanningEvent, "evaluation_complete" | "coaches" | "attendees">;
type Attendee = { event_id: string; player_id: string; status: string | null; coach_recorded_status: "present" | "absent" | null };
type Coach = { event_id: string; coach_id: string };

/** Read-only, group-scoped projection. Never return evaluation answers, ratings or private notes. */
export async function loadCoachGroupPlanning(db: SupabaseClient, callerId: string, groupId: string): Promise<CoachPlanningData> {
  const groupResult = await db.from("coach_groups").select("id,name,club_id,head_coach_user_id").eq("id", groupId).maybeSingle();
  if (groupResult.error) throw new Error("planning_load_failed");
  const group = groupResult.data as { id: string; name: string | null; club_id: string; head_coach_user_id: string | null } | null;
  if (!group) throw new CoachPlanningAccessError(404);
  const [membershipResult, linkResult] = await Promise.all([
    db.from("club_members").select("role,can_manage_assigned_group_planning,can_transfer_players_between_club_groups")
      .eq("club_id", group.club_id).eq("user_id", callerId).eq("is_active", true).maybeSingle(),
    db.from("coach_group_coaches").select("id").eq("group_id", group.id).eq("coach_user_id", callerId).limit(1).maybeSingle(),
  ]);
  if (membershipResult.error || linkResult.error) throw new Error("planning_load_failed");
  const member = membershipResult.data as { role: string; can_manage_assigned_group_planning: boolean | null; can_transfer_players_between_club_groups: boolean | null } | null;
  const assigned = group.head_coach_user_id === callerId || Boolean(linkResult.data);
  if (!member || !["coach", "manager"].includes(member.role) ||
    (member.role !== "manager" && !assigned && !member.can_transfer_players_between_club_groups)) throw new CoachPlanningAccessError(403);
  const ready=await db.rpc("organization_actor_legal_ready",{p_org:group.club_id,p_actor:callerId});
  if(ready.error||ready.data!==true)throw new CoachPlanningAccessError(403);
  const canPlan = member.role === "manager" || (assigned && Boolean(member.can_manage_assigned_group_planning));

  const [clubResult, events] = await Promise.all([
    db.from("organizations").select("name").eq("id", group.club_id).maybeSingle(),
    allRows<EventSource>((from, to) => db.from("club_events")
      .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,series_id,status,requires_evaluation")
      .eq("group_id", group.id).eq("club_id", group.club_id).order("starts_at").order("id").range(from, to)),
  ]);
  if (clubResult.error) throw new Error("planning_load_failed");
  const attendees: Attendee[] = [];
  const coaches: Coach[] = [];
  const completion: Record<string, boolean> = {};
  for (const batch of chunks(events.map((event) => event.id))) {
    const trainingIds = events.filter((event) => batch.includes(event.id) && event.event_type === "training").map((event) => event.id);
    const [batchAttendees, batchCoaches, evaluation] = await Promise.all([
      allRows<Attendee>((from, to) => db.from("club_event_attendees").select("event_id,player_id,status,coach_recorded_status")
        .in("event_id", batch).order("event_id").order("player_id").range(from, to)),
      allRows<Coach>((from, to) => db.from("club_event_coaches").select("event_id,coach_id")
        .in("event_id", batch).order("event_id").order("coach_id").range(from, to)),
      loadCoachEvaluationState(db, trainingIds),
    ]);
    attendees.push(...batchAttendees); coaches.push(...batchCoaches);
    Object.assign(completion, evaluation.completeByEvent);
  }
  // Fetch only people actually attached to authorized events, not the whole club directory.
  const allowedPlayers=await authorizedCoachPlayers(db,callerId,group.club_id,attendees.map(row=>row.player_id));
  const visibleAttendees=attendees.filter(row=>allowedPlayers.has(row.player_id));
  const personIds = [...new Set([...visibleAttendees.map((row) => row.player_id), ...coaches.map((row) => row.coach_id)])];
  const profiles = new Map<string, CoachPlanningPerson>();
  const playerIds = new Set<string>();
  for (const batch of chunks(personIds)) {
    const [people, memberships] = await Promise.all([
      allRows<CoachPlanningPerson>((from, to) => db.from("profiles").select("id,first_name,last_name,avatar_url")
        .in("id", batch).order("id").range(from, to)),
      allRows<{ user_id: string }>((from, to) => db.from("club_members").select("user_id")
        .eq("club_id", group.club_id).eq("role", "player").in("user_id", batch).order("user_id").range(from, to)),
    ]);
    people.forEach((person) => profiles.set(person.id, person));
    memberships.forEach((member) => playerIds.add(member.user_id));
  }
  const person = (id: string): CoachPlanningPerson => {
    const profile = profiles.get(id);
    return { id, first_name: profile?.first_name ?? null, last_name: profile?.last_name ?? null, avatar_url: profile?.avatar_url ?? null };
  };
  const preparation = await loadCoachPreparationStatus(db, callerId, events);
  return {
    coachClubCount: await coachClubCount(db, callerId),
    group: { id: group.id, name: group.name, club_id: group.club_id }, club_name: clubResult.data?.name ?? null, can_plan: canPlan,
    events: events.map((event) => ({
      id: event.id, group_id: event.group_id, club_id: event.club_id, event_type: event.event_type,
      title: event.title, starts_at: event.starts_at, ends_at: event.ends_at, duration_minutes: event.duration_minutes,
      location_text: event.location_text, series_id: event.series_id, status: event.status, requires_evaluation: event.requires_evaluation,
      evaluation_complete: completion[event.id] ?? false,
      preparation_pending: preparation[event.id] ?? false,
      coaches: [...new Set(coaches.filter((row) => row.event_id === event.id).map((row) => row.coach_id))].map(person),
      attendees: [...new Map(visibleAttendees.filter((row) => row.event_id === event.id).map((row) => [row.player_id, row])).values()]
        .map((row) => ({ ...person(row.player_id), is_player: playerIds.has(row.player_id), status: row.status, coach_recorded_status: row.coach_recorded_status })),
    })),
  };
}
