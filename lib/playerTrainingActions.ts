import type { SupabaseClient } from "@supabase/supabase-js";

type TrainingIdentity = { id: string; user_id: string; session_type: string; club_event_id: string | null };

export function canDeleteIndividualTraining(session: TrainingIdentity | null, playerId: string, canEdit: boolean, isCampDay: boolean) {
  return Boolean(session && canEdit && session.user_id === playerId && session.session_type === "individual" && !session.club_event_id && !isCampDay);
}

/** Use the signed-in client's RLS and confirm the row was actually deleted. */
export async function deleteIndividualTraining(db: Pick<SupabaseClient, "from">, sessionId: string, playerId: string, campCheck?: () => Promise<boolean>) {
  const current = await db.from("training_sessions").select("id,user_id,session_type,club_event_id").eq("id", sessionId).maybeSingle();
  if (current.error) throw current.error;
  if (!canDeleteIndividualTraining(current.data, playerId, true, false)) throw new Error("TRAINING_DELETE_FORBIDDEN");
  let isCampDay: boolean;
  if (campCheck) isCampDay = await campCheck();
  else {
    const camp = await db.from("player_camp_days").select("session_id").eq("session_id", sessionId).limit(1);
    if (camp.error) throw camp.error;
    isCampDay = Boolean(camp.data?.length);
  }
  if (isCampDay) throw new Error("TRAINING_DELETE_FORBIDDEN");
  const deleted = await db.from("training_sessions").delete().eq("id", sessionId).eq("user_id", playerId)
    .eq("session_type", "individual").is("club_event_id", null).select("id").maybeSingle();
  if (deleted.error) throw deleted.error;
  if (!deleted.data) throw new Error("TRAINING_DELETE_NOT_CONFIRMED");
}
