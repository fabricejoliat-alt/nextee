import { createSupabaseAdmin, requireCaller } from "@/app/api/messages/_lib";
import { resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { getValidationBadge, type ValidationAttemptItem, type ValidationDashboardPayload, type ValidationExerciseItem, type ValidationSectionItem } from "@/lib/validations";

type SectionRow = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

type ExerciseRow = {
  id: string;
  section_id: string;
  external_code: string | null;
  sequence_no: number;
  level: number | null;
  name: string;
  objective: string | null;
  short_description: string | null;
  detailed_description: string | null;
  equipment: string | null;
  validation_rule_text: string | null;
  illustration_url: string | null;
  is_active: boolean;
};

type AttemptRow = {
  id: string;
  exercise_id: string;
  attempted_at: string;
  result: "success" | "failure";
  note: string | null;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export async function requireSuperAdmin(accessToken: string) {
  const { supabaseAdmin, callerId } = await requireCaller(accessToken);
  const adminRes = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();
  if (adminRes.error) throw new Error(adminRes.error.message);
  if (!adminRes.data?.user_id) {
    const err = new Error("Forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return { supabaseAdmin, callerId };
}

export async function resolveValidationPlayerAccess(accessToken: string, childIdRaw: string, mode: "view" | "edit" = "view") {
  const supabaseAdmin = createSupabaseAdmin();
  const access = await resolveAuthenticatedPlayerAccess({
    accessToken,
    requestedPlayerId: childIdRaw,
    mode,
    supabaseAdmin,
  });

  return {
    supabaseAdmin,
    viewerUserId: access.actorUserId,
    effectivePlayerId: access.subjectPlayerId,
    isParent: access.isGuardianContext,
    canRecordAttempts: access.permissions.edit,
  };
}

export async function loadValidationDashboard(
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  effectivePlayerId: string,
  viewerUserId: string,
  canRecordAttempts: boolean
): Promise<ValidationDashboardPayload> {
  const [sectionsRes, exercisesRes, attemptsRes] = await Promise.all([
    supabaseAdmin
      .from("validation_sections")
      .select("id,slug,name,sort_order,is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("validation_exercises")
      .select("id,section_id,external_code,sequence_no,level,name,objective,short_description,detailed_description,equipment,validation_rule_text,illustration_url,is_active")
      .eq("is_active", true)
      .order("sequence_no", { ascending: true }),
    supabaseAdmin
      .from("player_validation_attempts")
      .select("id,exercise_id,attempted_at,result,note")
      .eq("player_id", effectivePlayerId)
      .order("attempted_at", { ascending: false }),
  ]);

  if (sectionsRes.error) throw new Error(sectionsRes.error.message);
  if (exercisesRes.error) throw new Error(exercisesRes.error.message);
  if (attemptsRes.error) throw new Error(attemptsRes.error.message);

  const attemptsByExerciseId = new Map<string, ValidationAttemptItem[]>();
  const validatedExerciseIds = new Set<string>();

  ((attemptsRes.data ?? []) as AttemptRow[]).forEach((attempt) => {
    const exerciseId = normalizeText(attempt.exercise_id);
    if (!exerciseId) return;
    const list = attemptsByExerciseId.get(exerciseId) ?? [];
    list.push({
      id: normalizeText(attempt.id),
      attempted_at: String(attempt.attempted_at ?? ""),
      result: attempt.result,
      note: attempt.note ?? null,
    });
    attemptsByExerciseId.set(exerciseId, list);
    if (attempt.result === "success") validatedExerciseIds.add(exerciseId);
  });

  const exercisesBySectionId = new Map<string, ExerciseRow[]>();
  ((exercisesRes.data ?? []) as ExerciseRow[]).forEach((exercise) => {
    const sectionId = normalizeText(exercise.section_id);
    const list = exercisesBySectionId.get(sectionId) ?? [];
    list.push(exercise);
    exercisesBySectionId.set(sectionId, list);
  });

  const sections: ValidationSectionItem[] = ((sectionsRes.data ?? []) as SectionRow[]).map((section) => {
    const sourceExercises = (exercisesBySectionId.get(section.id) ?? []).sort((a, b) => a.sequence_no - b.sequence_no);
    let previousValidated = true;
    const exercises: ValidationExerciseItem[] = sourceExercises.map((exercise, index) => {
      const isValidated = validatedExerciseIds.has(exercise.id);
      const isUnlocked = index === 0 ? true : previousValidated;
      previousValidated = isValidated;
      return {
        id: exercise.id,
        section_id: exercise.section_id,
        external_code: exercise.external_code ?? null,
        sequence_no: Number(exercise.sequence_no ?? 0),
        level: exercise.level == null ? null : Number(exercise.level),
        name: exercise.name,
        objective: exercise.objective ?? null,
        short_description: exercise.short_description ?? null,
        detailed_description: exercise.detailed_description ?? null,
        equipment: exercise.equipment ?? null,
        validation_rule_text: exercise.validation_rule_text ?? null,
        illustration_url: exercise.illustration_url ?? null,
        is_active: Boolean(exercise.is_active),
        is_validated: isValidated,
        is_unlocked: isUnlocked,
        attempts: attemptsByExerciseId.get(exercise.id) ?? [],
      };
    });
    const validatedCount = exercises.filter((exercise) => exercise.is_validated).length;
    return {
      id: section.id,
      slug: section.slug,
      name: section.name,
      sort_order: Number(section.sort_order ?? 0),
      is_active: Boolean(section.is_active),
      validated_count: validatedCount,
      total_count: exercises.length,
      badge: getValidationBadge(validatedCount, exercises.length),
      exercises,
    };
  });

  const overallValidatedCount = sections.reduce((sum, section) => sum + section.validated_count, 0);
  const overallTotalCount = sections.reduce((sum, section) => sum + section.total_count, 0);

  return {
    viewer_user_id: viewerUserId,
    effective_player_id: effectivePlayerId,
    can_record_attempts: canRecordAttempts,
    overall_validated_count: overallValidatedCount,
    overall_total_count: overallTotalCount,
    overall_badge: getValidationBadge(overallValidatedCount, overallTotalCount),
    sections,
  };
}

export async function ensureExerciseUnlockedForPlayer(
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  effectivePlayerId: string,
  exerciseId: string
) {
  const exerciseRes = await supabaseAdmin
    .from("validation_exercises")
    .select("id,section_id,sequence_no,is_active")
    .eq("id", exerciseId)
    .maybeSingle();
  if (exerciseRes.error) throw new Error(exerciseRes.error.message);
  if (!exerciseRes.data?.id || !exerciseRes.data.is_active) {
    const err = new Error("Exercise not found");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const exercise = exerciseRes.data as { id: string; section_id: string; sequence_no: number; is_active: boolean };
  if (Number(exercise.sequence_no ?? 0) <= 1) {
    return exercise;
  }

  const previousRes = await supabaseAdmin
    .from("validation_exercises")
    .select("id")
    .eq("section_id", exercise.section_id)
    .eq("sequence_no", Number(exercise.sequence_no) - 1)
    .maybeSingle();
  if (previousRes.error) throw new Error(previousRes.error.message);
  if (!previousRes.data?.id) return exercise;

  const successRes = await supabaseAdmin
    .from("player_validation_attempts")
    .select("id")
    .eq("player_id", effectivePlayerId)
    .eq("exercise_id", String(previousRes.data.id))
    .eq("result", "success")
    .limit(1)
    .maybeSingle();
  if (successRes.error) throw new Error(successRes.error.message);
  if (!successRes.data?.id) {
    const err = new Error("Exercise locked");
    (err as Error & { status?: number }).status = 409;
    throw err;
  }

  return exercise;
}
