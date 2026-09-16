import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
};

async function canManage(req: NextRequest, db: any, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const userId = data.user?.id;
  if (!userId) return false;
  const [{ data: admin }, { data: manager }] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", userId).eq("role", "manager").eq("is_active", true).maybeSingle(),
  ]);
  return Boolean(admin || manager);
}

async function context(req: NextRequest, params: Promise<{ clubId: string; seasonId: string }>) {
  const { clubId, seasonId } = await params;
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  if (!(await canManage(req, db, clubId))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const { data: season } = await db.from("club_seasons").select("id").eq("id", seasonId).eq("club_id", clubId).maybeSingle();
  if (!season) return { error: NextResponse.json({ error: "Saison introuvable" }, { status: 404 }) };
  return { db, clubId, seasonId };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ clubId: string; seasonId: string }> }) {
  try {
    const current = await context(req, params); if ("error" in current) return current.error;
    const { data: records, error } = await current.db.from("club_coach_season_records").select("id,club_member_id,registration_status").eq("club_season_id", current.seasonId);
    if (error) {
      // Keep the coach profile usable while the optional coach-season migration
      // is being deployed on an existing environment.
      if ((error as { code?: string }).code === "42P01") return NextResponse.json({ records: [] });
      throw error;
    }
    const ids = (records ?? []).map((item: any) => item.id);
    const { data: values, error: valuesError } = ids.length ? await current.db.from("club_coach_season_field_values").select("club_coach_season_record_id,field_id,value_json").in("club_coach_season_record_id", ids) : { data: [], error: null };
    if (valuesError) throw valuesError;
    const byRecord = new Map<string, Record<string, unknown>>();
    for (const value of values ?? []) byRecord.set(String(value.club_coach_season_record_id), { ...(byRecord.get(String(value.club_coach_season_record_id)) ?? {}), [String(value.field_id)]: value.value_json });
    return NextResponse.json({ records: (records ?? []).map((record: any) => ({ ...record, custom_field_values: byRecord.get(String(record.id)) ?? {} })) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clubId: string; seasonId: string }> }) {
  try {
    const current = await context(req, params); if ("error" in current) return current.error;
    const body = await req.json().catch(() => ({}));
    const memberIds = Array.isArray(body.member_ids) ? body.member_ids.map(String).filter(Boolean) : [];
    const status = body.registration_status === "inactive" ? "inactive" : "active";
    const customValues = body.custom_field_values && typeof body.custom_field_values === "object" ? body.custom_field_values as Record<string, unknown> : {};
    if (!memberIds.length) return NextResponse.json({ error: "Aucun coach sélectionné" }, { status: 400 });
    const { data: members } = await current.db.from("club_members").select("id").eq("club_id", current.clubId).eq("role", "coach").in("id", memberIds);
    const validIds = (members ?? []).map((member: any) => String(member.id));
    const { data: records, error } = await current.db.from("club_coach_season_records").upsert(validIds.map((club_member_id: string) => ({ club_season_id: current.seasonId, club_member_id, registration_status: status })), { onConflict: "club_season_id,club_member_id" }).select("id,club_member_id");
    if (error) {
      if ((error as { code?: string }).code === "42P01") return NextResponse.json({ updated: 0 });
      throw error;
    }
    const fieldIds = Object.keys(customValues);
    if (fieldIds.length) {
      const { data: fields } = await current.db.from("club_player_fields").select("id").eq("club_id", current.clubId).eq("scope", "season").contains("applies_to_roles", ["coach"]).in("id", fieldIds);
      const allowed = new Set((fields ?? []).map((field: any) => String(field.id)));
      const valueRows = (records ?? []).flatMap((record: any) => fieldIds.filter((id) => allowed.has(id)).map((field_id) => ({ club_coach_season_record_id: record.id, field_id, value_json: customValues[field_id] ?? null })));
      if (valueRows.length) { const { error: valueError } = await current.db.from("club_coach_season_field_values").upsert(valueRows, { onConflict: "club_coach_season_record_id,field_id" }); if (valueError) throw valueError; }
    }
    return NextResponse.json({ updated: validIds.length });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}
