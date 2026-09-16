import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
};

type SourceSeasonRecord = {
  id: string;
  club_member_id: string;
  course_label: string | null;
  group_id: string | null;
  registration_status: string;
  membership_status: string;
  playing_right_status: string;
};

type CopiedSeasonRecord = Pick<SourceSeasonRecord, "id" | "club_member_id">;

type SourceSeasonFieldValue = {
  club_player_season_record_id: string;
  field_id: string;
  value_json: unknown;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

// The existing protected manager APIs use an untyped service-role client because
// this project does not generate Supabase database types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canManage(req: NextRequest, db: any, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  const userId = data.user?.id;
  if (!userId) return false;
  const [{ data: admin }, { data: member }] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", userId).eq("role", "manager").eq("is_active", true).maybeSingle(),
  ]);
  return Boolean(admin || member);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await canManage(req, db, clubId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data, error } = await db.from("club_seasons").select("id,name,starts_on,ends_on,is_current").eq("club_id", clubId).order("starts_on", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ seasons: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await canManage(req, db, clubId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const seasonId = String(body.season_id ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!seasonId || !name) return NextResponse.json({ error: "Le nom de la saison est obligatoire." }, { status: 400 });

    const { data, error } = await db
      .from("club_seasons")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", seasonId)
      .eq("club_id", clubId)
      .select("id,name,starts_on,ends_on,is_current")
      .maybeSingle();
    if (error?.code === "23505") return NextResponse.json({ error: "Une saison porte déjà ce nom dans ce club." }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Saison introuvable." }, { status: 404 });
    return NextResponse.json({ season: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await canManage(req, db, clubId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const startsOn = String(body.starts_on ?? "");
    const endsOn = String(body.ends_on ?? "");
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn) {
      return NextResponse.json({ error: "Saison invalide" }, { status: 400 });
    }

    const { data: sourceSeason, error: sourceSeasonError } = await db
      .from("club_seasons")
      .select("id,ends_on")
      .eq("club_id", clubId)
      .lte("ends_on", startsOn)
      .order("ends_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sourceSeasonError) throw sourceSeasonError;

    if (body.is_current) await db.from("club_seasons").update({ is_current: false }).eq("club_id", clubId).eq("is_current", true);
    const { data, error } = await db.from("club_seasons").insert({ club_id: clubId, name, starts_on: startsOn, ends_on: endsOn, is_current: Boolean(body.is_current) }).select("id,name,starts_on,ends_on,is_current").single();
    if (error) throw error;

    let copiedRecords = 0;
    if (sourceSeason?.id) {
      const { data: copiedGroups, error: copiedGroupsError } = await db
        .from("coach_groups")
        .select("id,copied_from_group_id")
        .eq("club_season_id", data.id);
      if (copiedGroupsError) throw copiedGroupsError;
      const copiedGroupBySourceId = new Map((copiedGroups ?? []).map((group: { id: string; copied_from_group_id: string | null }) => [group.copied_from_group_id, group.id]));
      const { data: sourceRecords, error: sourceRecordsError } = await db
        .from("club_player_season_records")
        .select("id,club_member_id,course_label,group_id,registration_status,membership_status,playing_right_status")
        .eq("club_season_id", sourceSeason.id);
      if (sourceRecordsError) throw sourceRecordsError;

      const recordsToCopy = (sourceRecords ?? []) as SourceSeasonRecord[];
      if (recordsToCopy.length > 0) {
        const copies = recordsToCopy.map((record) => ({
          club_season_id: data.id,
          club_member_id: record.club_member_id,
          course_label: record.course_label,
          group_id: record.registration_status === "active" && record.group_id ? copiedGroupBySourceId.get(record.group_id) ?? null : null,
          registration_status: record.registration_status,
          membership_status: record.membership_status,
          playing_right_status: record.playing_right_status,
        }));
        const { data: copiedRows, error: copyRecordsError } = await db
          .from("club_player_season_records")
          .insert(copies)
          .select("id,club_member_id");
        if (copyRecordsError) throw copyRecordsError;
        copiedRecords = copiedRows?.length ?? 0;

        const copiedByMemberId = new Map(((copiedRows ?? []) as CopiedSeasonRecord[]).map((row) => [row.club_member_id, row.id]));
        const sourceRecordIds = recordsToCopy.map((record) => record.id);
        const { data: sourceValues, error: sourceValuesError } = await db
          .from("club_player_season_field_values")
          .select("club_player_season_record_id,field_id,value_json")
          .in("club_player_season_record_id", sourceRecordIds);
        if (sourceValuesError) throw sourceValuesError;
        const sourceMemberByRecordId = new Map(recordsToCopy.map((record) => [record.id, record.club_member_id]));
        const valueCopies = ((sourceValues ?? []) as SourceSeasonFieldValue[]).flatMap((value) => {
          const memberId = sourceMemberByRecordId.get(value.club_player_season_record_id);
          const newRecordId = memberId ? copiedByMemberId.get(memberId) : null;
          return newRecordId ? [{ club_player_season_record_id: newRecordId, field_id: value.field_id, value_json: value.value_json }] : [];
        });
        if (valueCopies.length > 0) {
          const { error: copyValuesError } = await db.from("club_player_season_field_values").insert(valueCopies);
          if (copyValuesError) throw copyValuesError;
        }
      }
    }
    return NextResponse.json({ season: data, copied_records: copiedRecords }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
