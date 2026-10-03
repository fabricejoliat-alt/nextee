import type { SupabaseClient } from "@supabase/supabase-js";
import { isFutureTraining } from "../coachPreparationInsights.ts";
import { loadCoachPreparationSources } from "./coachPreparationSources.ts";
import { loadCoachPreparationReads } from "./coachPreparationReads.ts";
import { isCoachTrainingAssistanceEnabled } from "./coachTrainingAssistance.ts";
import { coachRows } from "./coachRows.ts";

type Event = { id: string; group_id: string; club_id: string; event_type: string | null; starts_at: string; status: string };
/** Authorized events only. Returns booleans, never private notes or generated points. No AI calls. */
export async function loadCoachPreparationStatus(db: SupabaseClient, coachId: string, events: Event[]) {
  const result: Record<string, boolean> = {};
  const future = events.filter((event) => event.status !== "cancelled"
    && isFutureTraining({ ...event, event_type: event.event_type ?? "" }));
  const enabled = new Map<string, boolean>();
  for (const clubId of new Set(future.map((event) => event.club_id))) {
    enabled.set(clubId, await isCoachTrainingAssistanceEnabled(db, clubId, coachId));
  }
  const eligible = future.filter((event) => {
    result[event.id] = false;
    return enabled.get(event.club_id);
  });
  const attendees: { event_id: string; player_id: string }[] = [];
  for (let index = 0; index < eligible.length; index += 150) {
    attendees.push(...await coachRows<{ event_id: string; player_id: string }>((from, to) =>
      db.from("club_event_attendees").select("event_id,player_id")
        .in("event_id", eligible.slice(index, index + 150).map((event) => event.id))
        .order("event_id").order("player_id").range(from, to)));
  }
  const reads = await loadCoachPreparationReads(db, coachId, eligible.map((event) => event.id));
  const seen = new Map(reads.rows.map((read) => [`${read.target_event_id}:${read.player_id}`, read.source_fingerprint]));
  const groups = new Map<string, Event[]>();
  eligible.forEach((event) => {
    const key = `${event.club_id}:${event.group_id}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  });
  // Share history reads across future occurrences of the same authorized group.
  for (const groupEvents of groups.values()) {
    const ids = new Set(groupEvents.map((event) => event.id));
    const people = attendees.filter((attendee) => ids.has(attendee.event_id));
    const playerIds = [...new Set(people.map((person) => person.player_id))];
    const hashes = new Map<string, string>();
    for (let index = 0; index < playerIds.length; index += 150) {
      const sources = await loadCoachPreparationSources(db, groupEvents[0], playerIds.slice(index, index + 150));
      sources.sourceByPlayerId.forEach((source, playerId) => hashes.set(playerId, source.sourceHash));
    }
    for (const event of groupEvents) {
      result[event.id] = people.some((person) => person.event_id === event.id
        && hashes.has(person.player_id)
        && seen.get(`${event.id}:${person.player_id}`) !== hashes.get(person.player_id));
    }
  }
  return result;
}
