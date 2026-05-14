import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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

type PlayerProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type PlayerValidationAttemptRow = {
  player_id: string;
  exercise_id: string;
  result: "success" | "failure";
};

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;
    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["coach", "manager"]);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const clubIds = Array.from(new Set(((membershipsRes.data ?? []) as Array<{ club_id: string | null }>).map((row) => String(row.club_id ?? "").trim()).filter(Boolean)));
    if (clubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [sectionsRes, exercisesRes, playerMembershipsRes] = await Promise.all([
      supabaseAdmin
        .from("validation_sections")
        .select("id,slug,name,sort_order,is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("validation_exercises")
        .select("id,section_id,external_code,sequence_no,level,name,objective,short_description,detailed_description,equipment,validation_rule_text,illustration_url,is_active")
        .eq("is_active", true)
        .order("section_id", { ascending: true })
        .order("sequence_no", { ascending: true }),
      supabaseAdmin
        .from("club_members")
        .select("user_id,club_id")
        .eq("is_active", true)
        .in("club_id", clubIds)
        .eq("role", "player"),
    ]);

    if (sectionsRes.error) return NextResponse.json({ error: sectionsRes.error.message }, { status: 400 });
    if (exercisesRes.error) return NextResponse.json({ error: exercisesRes.error.message }, { status: 400 });
    if (playerMembershipsRes.error) return NextResponse.json({ error: playerMembershipsRes.error.message }, { status: 400 });

    const playerIds = Array.from(
      new Set(((playerMembershipsRes.data ?? []) as Array<{ user_id: string | null }>).map((row) => String(row.user_id ?? "").trim()).filter(Boolean))
    );
    const profilesRes =
      playerIds.length > 0
        ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", playerIds)
        : { data: [], error: null };
    if ((profilesRes as any).error) return NextResponse.json({ error: (profilesRes as any).error.message }, { status: 400 });

    const profileById = new Map<string, PlayerProfileRow>();
    ((profilesRes.data ?? []) as PlayerProfileRow[]).forEach((profile) => {
      profileById.set(profile.id, profile);
    });

    const attemptsRes =
      playerIds.length > 0
        ? await supabaseAdmin
            .from("player_validation_attempts")
            .select("player_id,exercise_id,result")
            .in("player_id", playerIds)
        : { data: [], error: null };
    if ((attemptsRes as any).error) return NextResponse.json({ error: (attemptsRes as any).error.message }, { status: 400 });

    const attemptsByPlayer = new Map<string, Set<string>>();
    ((attemptsRes.data ?? []) as PlayerValidationAttemptRow[]).forEach((attempt) => {
      if (attempt.result !== "success") return;
      const playerId = String(attempt.player_id ?? "").trim();
      const exerciseId = String(attempt.exercise_id ?? "").trim();
      if (!playerId || !exerciseId) return;
      const set = attemptsByPlayer.get(playerId) ?? new Set<string>();
      set.add(exerciseId);
      attemptsByPlayer.set(playerId, set);
    });

    const exercisesBySection = new Map<string, ExerciseRow[]>();
    ((exercisesRes.data ?? []) as ExerciseRow[]).forEach((exercise) => {
      const sectionId = String(exercise.section_id ?? "").trim();
      const list = exercisesBySection.get(sectionId) ?? [];
      list.push(exercise);
      exercisesBySection.set(sectionId, list);
    });

    const sections = ((sectionsRes.data ?? []) as SectionRow[]).map((section) => {
      const sourceExercises = (exercisesBySection.get(section.id) ?? []).sort((a, b) => a.sequence_no - b.sequence_no);
      const exercises = sourceExercises.map((exercise, index) => {
        const challengers = playerIds
          .map((playerId) => {
            const validated = attemptsByPlayer.get(playerId) ?? new Set<string>();
            let unlocked = true;
            for (let i = 0; i < index; i += 1) {
              const previousExercise = sourceExercises[i];
              if (!validated.has(previousExercise.id)) {
                unlocked = false;
                break;
              }
            }
            const isValidated = validated.has(exercise.id);
            const isBlocked = unlocked && !isValidated;
            if (!isBlocked) return null;
            const profile = profileById.get(playerId) ?? null;
            return {
              id: playerId,
              first_name: profile?.first_name ?? null,
              last_name: profile?.last_name ?? null,
              avatar_url: profile?.avatar_url ?? null,
            };
          })
          .filter(Boolean);

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
          challengers,
        };
      });

      return {
        ...section,
        exercises,
      };
    });

    return NextResponse.json({ sections });
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
