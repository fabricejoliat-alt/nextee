import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";
import { uuidPattern } from "@/lib/server/organizationAccess";
import { buildCoachValidations } from "@/lib/coachValidations";

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

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;
    const organizationId = req.nextUrl.searchParams.get("organization_id");
    if (organizationId && !uuidPattern.test(organizationId)) return NextResponse.json({ error: "Invalid organization" }, { status: 400 });
    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["coach", "manager"]);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const membershipClubIds = Array.from(new Set(((membershipsRes.data ?? []) as Array<{ club_id: string | null }>).map((row) => String(row.club_id ?? "").trim()).filter(Boolean)));
    const clubIds = organizationId ? membershipClubIds.filter(id => id === organizationId) : membershipClubIds;
    if (clubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [sectionRows, exerciseRows, playerMemberships] = await Promise.all([
      allRows<SectionRow>((from, to) => supabaseAdmin.from("validation_sections")
        .select("id,slug,name,sort_order,is_active").eq("is_active", true).order("sort_order").order("id").range(from, to)),
      allRows<ExerciseRow>((from, to) => supabaseAdmin.from("validation_exercises")
        .select("id,section_id,external_code,sequence_no,level,name,objective,short_description,detailed_description,equipment,validation_rule_text,illustration_url,is_active")
        .eq("is_active", true).order("section_id").order("sequence_no").order("id").range(from, to)),
      allRows<{ user_id: string }>((from, to) => supabaseAdmin.from("club_members").select("user_id,club_id")
        .eq("is_active", true).in("club_id", clubIds).eq("role", "player").order("user_id").order("club_id").range(from, to)),
    ]);

    const candidatePlayerIds = Array.from(new Set(playerMemberships.map((row) => row.user_id).filter(Boolean)));
    const playerIds: string[] = [];
    // Shared membership alone does not grant access to a junior's progression.
    for (let index = 0; index < candidatePlayerIds.length; index += 10) {
      const eligible = await Promise.all(candidatePlayerIds.slice(index, index + 10).map(async playerId => {
        const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId, organizationId);
        if (!access.canAccessSensitiveSections) return null;
        const authorized = await Promise.all(access.sensitiveClubIds.map(async org => {
          const result = await supabaseAdmin.rpc("organization_player_authorized", { p_org: org, p_player: playerId });
          if (result.error) throw result.error;
          return result.data === true;
        }));
        return authorized.some(Boolean) ? playerId : null;
      }));
      playerIds.push(...eligible.filter((id): id is string => id !== null));
    }
    const profiles: PlayerProfileRow[] = [];
    const attempts: PlayerValidationAttemptRow[] = [];
    // Bound URL size as well as PostgREST row limits for large clubs.
    for (let index = 0; index < playerIds.length; index += 200) {
      const batch = playerIds.slice(index, index + 200);
      const [batchProfiles, batchAttempts] = await Promise.all([
        allRows<PlayerProfileRow>((from, to) => supabaseAdmin.from("profiles")
          .select("id,first_name,last_name,avatar_url").in("id", batch).order("id").range(from, to)),
        allRows<PlayerValidationAttemptRow>((from, to) => supabaseAdmin.from("player_validation_attempts")
          .select("player_id,exercise_id,result").in("player_id", batch).eq("result", "success").order("id").range(from, to)),
      ]);
      profiles.push(...batchProfiles);
      attempts.push(...batchAttempts);
    }
    const sections = buildCoachValidations(sectionRows, exerciseRows, playerIds, profiles, attempts);
    return NextResponse.json({ sections, player_count: playerIds.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
