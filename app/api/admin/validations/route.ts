import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/app/api/validations/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin } = await requireSuperAdmin(accessToken);
    const [sectionsRes, exercisesRes] = await Promise.all([
      supabaseAdmin
        .from("validation_sections")
        .select("id,slug,name,sort_order,is_active,created_at,updated_at")
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("validation_exercises")
        .select("id,section_id,external_code,sequence_no,level,name,objective,short_description,detailed_description,equipment,validation_rule_text,illustration_url,is_active,created_at,updated_at")
        .order("section_id", { ascending: true })
        .order("sequence_no", { ascending: true }),
    ]);

    if (sectionsRes.error) return NextResponse.json({ error: sectionsRes.error.message }, { status: 400 });
    if (exercisesRes.error) return NextResponse.json({ error: exercisesRes.error.message }, { status: 400 });

    return NextResponse.json({
      sections: sectionsRes.data ?? [],
      exercises: exercisesRes.data ?? [],
    });
  } catch (error: unknown) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
