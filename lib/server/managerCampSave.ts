import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateTimeInputToIso } from "@/app/api/camps/_lib";
import { managerMutationError } from "@/lib/server/managerMutationError";

type Input = Record<string, unknown>;
const rows = (value: unknown): Input[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => String(value ?? "").trim();
const ids = (value: unknown) => Array.from(new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean)));

export async function saveManagerCamp(db: SupabaseClient, actor: string, campId: string | null, clubId: string, body: Input) {
  const days = rows(body.days).map((day) => ({ ...day,
    event_id: text(day.event_id) || null,
    starts_at: localDateTimeInputToIso(text(day.starts_at)), ends_at: localDateTimeInputToIso(text(day.ends_at)),
    coach_ids: ids(day.coach_ids), evaluation_criterion_ids: ids(day.evaluation_criterion_ids),
  }));
  if (days.some((day) => !day.starts_at || !day.ends_at || new Date(day.ends_at) <= new Date(day.starts_at))) {
    return { status: 400, data: { error: "Vérifiez les dates et heures de chaque journée." } };
  }
  const result = await db.rpc("save_manager_camp_v1", {
    p_actor: actor, p_camp: campId, p_club: clubId,
    p_expected_version: text(body.edit_version) || null,
    p_values: { ...body, title: text(body.title), head_coach_user_id: text(body.head_coach_user_id) || null,
      season_id: text(body.season_id) || null, group_ids: ids(body.group_ids), player_ids: ids(body.player_ids),
      coach_ids: ids(body.coach_ids), days, player_registrations: rows(body.player_registrations),
      options: rows(body.options).map((option) => ({ ...option, id: text(option.id) || null,
        choices: ids(option.choices), day_indexes: Array.isArray(option.day_indexes) ? option.day_indexes : [],
        player_assignments: rows(option.player_assignments),
      })),
    },
  });
  if (result.error) {
    if ((result.error.code === "PT409" || result.error.code === "40001")) return { status: 409, data: { error: "Le stage a changé depuis l’ouverture du formulaire. Rechargez la page pour conserver les dernières réponses." } };
    if (result.error.message.includes("camp_history_removal")) return { status: 409, data: { error: "Cette suppression ferait perdre un historique de présence, d’option ou d’évaluation. Conservez la journée ou le participant." } };
    if (result.error.message.includes("option_capacity")) return { status: 400, data: { error: "La capacité d’une option est dépassée." } };
    const failure = managerMutationError(result.error);
    return { status: failure.status, data: { error: failure.error } };
  }
  return { status: campId ? 200 : 201, data: result.data };
}
