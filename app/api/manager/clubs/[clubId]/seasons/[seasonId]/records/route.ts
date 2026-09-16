import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const env = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; };
const allowed = new Set(["course_label", "group_id", "registration_status", "membership_status", "playing_right_status"]);
const values: Record<string, string[]> = {
  registration_status: ["draft", "active", "waitlist", "cancelled", "completed"],
  membership_status: ["pending", "paid", "waived", "overdue"],
  playing_right_status: ["pending", "paid", "waived", "not_applicable"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function manager(req: NextRequest, db: any, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const userId = data.user?.id;
  if (!userId) return false;
  const [{ data: admin }, { data: member }] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", userId).eq("role", "manager").eq("is_active", true).maybeSingle(),
  ]);
  return Boolean(admin || member);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string; seasonId: string }> }) {
  try {
    const { clubId, seasonId } = await ctx.params; const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await manager(req, db, clubId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: season } = await db.from("club_seasons").select("id").eq("id", seasonId).eq("club_id", clubId).maybeSingle();
    if (!season) return NextResponse.json({ error: "Saison introuvable" }, { status: 404 });
    const { data, error } = await db.from("club_player_season_records").select("id,club_member_id,course_label,group_id,registration_status,membership_status,playing_right_status").eq("club_season_id", seasonId);
    if (error) throw error;
    const recordIds = (data ?? []).map((record: { id: string }) => record.id);
    const { data: customValues, error: customValuesError } = recordIds.length
      ? await db.from("club_player_season_field_values").select("club_player_season_record_id,field_id,value_json").in("club_player_season_record_id", recordIds)
      : { data: [], error: null };
    if (customValuesError) throw customValuesError;
    const valuesByRecord = new Map<string, Record<string, unknown>>();
    for (const item of customValues ?? []) {
      const recordId = String(item.club_player_season_record_id);
      valuesByRecord.set(recordId, { ...(valuesByRecord.get(recordId) ?? {}), [String(item.field_id)]: item.value_json });
    }
    return NextResponse.json({ records: (data ?? []).map((record: { id: string }) => ({ ...record, custom_field_values: valuesByRecord.get(record.id) ?? {} })) });
  } catch (error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string; seasonId: string }> }) {
  try {
    const { clubId, seasonId } = await ctx.params; const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await manager(req, db, clubId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: season } = await db.from("club_seasons").select("id").eq("id", seasonId).eq("club_id", clubId).maybeSingle();
    if (!season) return NextResponse.json({ error: "Saison introuvable" }, { status: 404 });
    const body = await req.json().catch(() => ({})); const field = String(body.field ?? ""); const memberIds = Array.isArray(body.member_ids) ? body.member_ids.map(String).filter(Boolean) : [];
    const customFieldValues = body.custom_field_values && typeof body.custom_field_values === "object" ? body.custom_field_values as Record<string, unknown> : null;
    const registrationStatus = body.registration_status == null ? null : String(body.registration_status);
    if (registrationStatus !== null && !values.registration_status.includes(registrationStatus)) return NextResponse.json({ error: "Statut d’inscription invalide" }, { status: 400 });
    if ((!customFieldValues && !allowed.has(field)) || memberIds.length === 0) return NextResponse.json({ error: "Action de masse invalide" }, { status: 400 });
    const { data: members } = await db.from("club_members").select("id").eq("club_id", clubId).eq("role", "player").in("id", memberIds);
    const validIds = (members ?? []).map((row: { id: string }) => row.id); if (validIds.length === 0) return NextResponse.json({ updated: 0 });
    if (customFieldValues) {
      const fieldIds = Object.keys(customFieldValues);
      const { data: definitions, error: definitionsError } = await db.from("club_player_fields").select("id,is_sensitive").eq("club_id", clubId).eq("scope", "season").eq("is_active", true).in("id", fieldIds);
      if (definitionsError) throw definitionsError;
      const allowedFieldIds = new Set((definitions ?? []).filter((item: { is_sensitive: boolean }) => !item.is_sensitive).map((item: { id: string }) => String(item.id)));
      const { data: seasonRecords, error: recordError } = await db.from("club_player_season_records").upsert(validIds.map((club_member_id: string) => ({ club_season_id: seasonId, club_member_id, ...(registrationStatus ? { registration_status: registrationStatus } : {}) })), { onConflict: "club_season_id,club_member_id" }).select("id,club_member_id");
      if (recordError) throw recordError;
      const valueRows = (seasonRecords ?? []).flatMap((record: { id: string }) => fieldIds.filter((fieldId) => allowedFieldIds.has(fieldId)).map((fieldId) => ({ club_player_season_record_id: record.id, field_id: fieldId, value_json: customFieldValues[fieldId] ?? null })));
      if (valueRows.length) { const { error: valuesError } = await db.from("club_player_season_field_values").upsert(valueRows, { onConflict: "club_player_season_record_id,field_id" }); if (valuesError) throw valuesError; }
      return NextResponse.json({ updated: validIds.length });
    }
    const value = body.value == null || body.value === "" ? null : String(body.value);
    if (values[field] && (value == null || !values[field].includes(value))) return NextResponse.json({ error: "Valeur invalide" }, { status: 400 });
    const rows = validIds.map((club_member_id: string) => ({ club_season_id: seasonId, club_member_id, [field]: value }));
    const { error } = await db.from("club_player_season_records").upsert(rows, { onConflict: "club_season_id,club_member_id" }); if (error) throw error;
    return NextResponse.json({ updated: validIds.length });
  } catch (error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}
