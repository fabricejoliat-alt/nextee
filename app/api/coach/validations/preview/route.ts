import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { activeCoachMemberships } from "@/lib/coachAccess";
import { uuidPattern } from "@/lib/server/organizationAccess";

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  try {
    const { supabaseAdmin, callerId } = await requireCaller(token);
    const organizationId = req.nextUrl.searchParams.get("organization_id");
    if (organizationId && !uuidPattern.test(organizationId)) {
      return NextResponse.json({ error: "Invalid organization" }, { status: 400 });
    }
    const memberships = await activeCoachMemberships(supabaseAdmin, callerId);
    if (!memberships.some(row => !organizationId || row.club_id === organizationId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sections = await supabaseAdmin.from("validation_sections")
      .select("id,name").eq("is_active", true).order("sort_order").order("id").limit(4);
    if (sections.error) throw sections.error;

    const previews = await Promise.all((sections.data ?? []).map(async section => {
      const exercises = await supabaseAdmin.from("validation_exercises")
        .select("illustration_url", { count: "exact" })
        .eq("section_id", section.id).eq("is_active", true)
        .order("sequence_no").order("id").limit(1);
      if (exercises.error || exercises.count == null) throw new Error("Preview unavailable");
      return {
        id: section.id,
        name: section.name,
        imageUrl: exercises.data?.[0]?.illustration_url ?? null,
        exerciseCount: exercises.count,
      };
    }));
    return NextResponse.json({ sections: previews });
  } catch (error) {
    const invalidToken = error instanceof Error && error.message === "Invalid token";
    return NextResponse.json({ error: invalidToken ? "Invalid token" : "Preview unavailable" },
      { status: invalidToken ? 401 : 500 });
  }
}
