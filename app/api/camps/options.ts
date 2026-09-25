/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeText, uniq } from "@/app/api/camps/_lib";

export type CampOptionPayload = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  is_active?: boolean;
  applies_to_all_days?: boolean;
  day_indexes?: number[];
  capacity?: number | null;
  allows_quantity?: boolean;
  input_type?: "checkbox" | "yes_no" | "select" | "radio" | null;
  choices?: string[] | null;
  internal_note?: string | null;
  player_assignments?: Array<{
    player_id?: string | null;
    quantity?: number | null;
    note?: string | null;
    selected_value?: string | null;
  }>;
};

export async function syncCampOptions(
  supabaseAdmin: SupabaseClient,
  campId: string,
  options: CampOptionPayload[],
  callerUserId: string,
) {
  const [existingRes, daysRes, playersRes] = await Promise.all([
    supabaseAdmin.from("club_camp_options").select("id").eq("camp_id", campId),
    supabaseAdmin
      .from("club_camp_days")
      .select("id,day_index")
      .eq("camp_id", campId),
    supabaseAdmin
      .from("club_camp_players")
      .select("player_id")
      .eq("camp_id", campId),
  ]);
  if (existingRes.error)
    return { error: existingRes.error.message, status: 400 as const };
  if (daysRes.error)
    return { error: daysRes.error.message, status: 400 as const };
  if (playersRes.error)
    return { error: playersRes.error.message, status: 400 as const };

  const existingIds = new Set(
    (existingRes.data ?? []).map((row: any) => String(row.id)),
  );
  const submittedExistingIds = new Set<string>();
  const dayIdByIndex = new Map<number, string>();
  (daysRes.data ?? []).forEach((row: any) =>
    dayIdByIndex.set(Number(row.day_index ?? 0), String(row.id)),
  );
  const allowedPlayerIds = new Set(
    (playersRes.data ?? []).map((row: any) => String(row.player_id)),
  );

  for (let sortOrder = 0; sortOrder < options.length; sortOrder += 1) {
    const option = options[sortOrder];
    const name = normalizeText(option?.name);
    if (!name)
      return {
        error: `Le nom de l’option ${sortOrder + 1} est requis.`,
        status: 400 as const,
      };
    const capacityRaw =
      option?.capacity == null || option.capacity === ("" as any)
        ? null
        : Number(option.capacity);
    const capacity =
      capacityRaw != null && Number.isFinite(capacityRaw)
        ? Math.max(1, Math.trunc(capacityRaw))
        : null;
    const inputType = ["checkbox", "yes_no", "select", "radio"].includes(String(option?.input_type ?? ""))
      ? String(option?.input_type)
      : "checkbox";
    const choices = inputType === "checkbox" || inputType === "select" || inputType === "radio"
      ? uniq((Array.isArray(option?.choices) ? option.choices : []).map((choice) => normalizeText(choice)))
      : [];
    if ((inputType === "select" || inputType === "radio") && choices.length < 2) {
      return {
        error: `Ajoutez au moins deux choix pour l’option « ${name} ».`,
        status: 400 as const,
      };
    }
    const assignments = (
      Array.isArray(option?.player_assignments) ? option.player_assignments : []
    )
      .map((assignment) => ({
        player_id: normalizeText(assignment?.player_id),
        quantity: Math.max(
          1,
          Math.trunc(Number(assignment?.quantity ?? 1) || 1),
        ),
        note: normalizeText(assignment?.note) || null,
        selected_value: normalizeText(assignment?.selected_value) || null,
      }))
      .filter(
        (assignment) =>
          assignment.player_id && allowedPlayerIds.has(assignment.player_id),
      );
    const uniqueAssignments = Array.from(
      new Map(assignments.map((entry) => [entry.player_id, entry])).values(),
    );
    const assignedQuantity = uniqueAssignments.reduce(
      (sum, entry) => sum + entry.quantity,
      0,
    );
    if (capacity != null && assignedQuantity > capacity) {
      return {
        error: `La capacité de l’option « ${name} » est dépassée.`,
        status: 400 as const,
      };
    }
    const appliesToAllDays = option?.applies_to_all_days !== false;
    const selectedDayIds = appliesToAllDays
      ? []
      : uniq(
          (option.day_indexes ?? []).map((index) =>
            dayIdByIndex.get(Number(index)),
          ),
        );
    if (!appliesToAllDays && selectedDayIds.length === 0) {
      return {
        error: `Sélectionnez au moins une journée pour l’option « ${name} ».`,
        status: 400 as const,
      };
    }

    const requestedId = normalizeText(option?.id);
    let optionId = "";
    const values = {
      camp_id: campId,
      name,
      description: normalizeText(option?.description) || null,
      is_active: option?.is_active !== false,
      applies_to_all_days: appliesToAllDays,
      capacity,
      allows_quantity: inputType === "checkbox" && choices.length === 0 && Boolean(option?.allows_quantity),
      input_type: inputType,
      choices,
      internal_note: normalizeText(option?.internal_note) || null,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    };
    if (requestedId && existingIds.has(requestedId)) {
      const updateRes = await supabaseAdmin
        .from("club_camp_options")
        .update(values)
        .eq("id", requestedId)
        .eq("camp_id", campId);
      if (updateRes.error)
        return { error: updateRes.error.message, status: 400 as const };
      optionId = requestedId;
      submittedExistingIds.add(requestedId);
    } else {
      const insertRes = await supabaseAdmin
        .from("club_camp_options")
        .insert(values)
        .select("id")
        .maybeSingle();
      if (insertRes.error || !insertRes.data?.id)
        return {
          error: insertRes.error?.message ?? "Impossible de créer l’option.",
          status: 400 as const,
        };
      optionId = String(insertRes.data.id);
    }

    const deleteDaysRes = await supabaseAdmin
      .from("club_camp_option_days")
      .delete()
      .eq("option_id", optionId);
    if (deleteDaysRes.error)
      return { error: deleteDaysRes.error.message, status: 400 as const };
    if (!values.applies_to_all_days) {
      if (selectedDayIds.length > 0) {
        const insertDaysRes = await supabaseAdmin
          .from("club_camp_option_days")
          .insert(
            selectedDayIds.map((campDayId) => ({
              option_id: optionId,
              camp_day_id: campDayId,
            })),
          );
        if (insertDaysRes.error)
          return { error: insertDaysRes.error.message, status: 400 as const };
      }
    }

    const deleteAssignmentsRes = await supabaseAdmin
      .from("club_camp_player_options")
      .delete()
      .eq("option_id", optionId);
    if (deleteAssignmentsRes.error)
      return {
        error: deleteAssignmentsRes.error.message,
        status: 400 as const,
      };
    if (uniqueAssignments.length > 0) {
      const insertAssignmentsRes = await supabaseAdmin
        .from("club_camp_player_options")
        .insert(
          uniqueAssignments.map((assignment) => ({
            option_id: optionId,
            ...assignment,
            assigned_by: callerUserId,
          })),
        );
      if (insertAssignmentsRes.error)
        return {
          error: insertAssignmentsRes.error.message,
          status: 400 as const,
        };
    }
  }

  for (const existingId of existingIds) {
    if (submittedExistingIds.has(existingId)) continue;
    const usageRes = await supabaseAdmin
      .from("club_camp_player_options")
      .select("player_id", { count: "exact", head: true })
      .eq("option_id", existingId);
    if (usageRes.error)
      return { error: usageRes.error.message, status: 400 as const };
    const removeRes =
      (usageRes.count ?? 0) > 0
        ? await supabaseAdmin
            .from("club_camp_options")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", existingId)
        : await supabaseAdmin
            .from("club_camp_options")
            .delete()
            .eq("id", existingId);
    if (removeRes.error)
      return { error: removeRes.error.message, status: 400 as const };
  }

  return { ok: true as const };
}
