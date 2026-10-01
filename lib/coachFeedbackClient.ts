import { supabase } from "@/lib/supabaseClient";

type CoachFeedback = {
  event_id: string; player_id: string; coach_id: string;
  engagement: number | null; attitude: number | null; performance: number | null;
  visible_to_player: boolean; private_note: string | null; player_note: string | null;
};

/** Shared by Coach and Manager readers; the API checks active event access. */
export async function loadCoachEventFeedback(eventId: string, playerId: string) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Session invalide.");
    const response = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/players/${encodeURIComponent(playerId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(String(body.error ?? "Impossible de charger l’évaluation."));
    return { data: (body.feedback ?? null) as CoachFeedback | null, error: null };
  } catch (error: unknown) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Load failed" } };
  }
}
