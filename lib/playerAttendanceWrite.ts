"use client";

import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { supabase } from "@/lib/supabaseClient";
import { organizationFetch } from "@/lib/organizationFetch";
import { invalidateClientPageCacheByPrefix } from "@/lib/clientPageCache";

/** Update visible attendance only after the server confirms a persisted row. */
export async function savePlayerAttendance(playerId: string, eventId: string, status: "present" | "absent", locale = "fr") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error(pickLocaleText(locale, "Session expirée. Reconnectez-vous.", "Session expired. Sign in again.", "Sitzung abgelaufen. Bitte melde dich erneut an.", "Sessione scaduta. Accedi di nuovo."));
  const response = await organizationFetch(`/api/player/training-attendance?child_id=${encodeURIComponent(playerId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ eventId, status }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== status) {
    const error = new Error(response.status === 409
      ? pickLocaleText(locale, "La présence a changé ou une évaluation a été enregistrée. Actualisez la page.", "Attendance changed or an evaluation was recorded. Refresh the page.", "Die Anwesenheit wurde geändert oder eine Bewertung wurde gespeichert. Lade die Seite neu.", "La presenza è cambiata o è stata salvata una valutazione. Aggiorna la pagina.")
      : pickLocaleText(locale, "Impossible de modifier la présence.", "Unable to update attendance.", "Die Anwesenheit konnte nicht geändert werden.", "Impossibile modificare la presenza."));
    Object.assign(error, { status: response.status });
    throw error;
  }
  invalidateClientPageCacheByPrefix("page-cache:player-home:");
  invalidateClientPageCacheByPrefix("page-cache:player-trainings:");
  return { status: result.status as "present" | "absent", notificationWarning: result.notificationWarning === true };
}
