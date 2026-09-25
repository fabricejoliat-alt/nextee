import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MEMBER_ROLES = ["manager", "coach", "player", "parent"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

type PlayerFieldDef = {
  id: string;
  club_id: string;
  field_key: string;
  label: string;
  field_type: "text" | "short_text" | "long_text" | "number" | "date" | "boolean" | "select" | "radio" | "checkbox";
  options_json: string[];
  is_active: boolean;
  sort_order: number;
  applies_to_roles: MemberRole[];
  visible_in_profile: boolean;
  editable_in_profile: boolean;
  visible_to_player: boolean;
  editable_by_player: boolean;
  visible_to_coach: boolean;
  editable_by_coach: boolean;
  scope: "permanent" | "season";
  legacy_binding: "player_course_track" | "player_membership_paid" | "player_playing_right_paid" | null;
};

type MembershipRow = {
  id: string;
  club_id: string;
  role: MemberRole;
  player_course_track: string | null;
  player_membership_paid: boolean | null;
  player_playing_right_paid: boolean | null;
};

type CurrentSeasonRow = {
  id: string;
  club_id: string;
  name: string;
};

type PlayerSeasonRecordRow = {
  id: string;
  club_season_id: string;
  club_member_id: string;
  course_label: string | null;
  membership_status: "pending" | "paid" | "waived" | "overdue";
  playing_right_status: "pending" | "paid" | "waived" | "not_applicable";
};

type PlayerFieldSourceRow = {
  id: unknown;
  club_id: unknown;
  field_key: unknown;
  label: unknown;
  field_type: unknown;
  options_json: unknown;
  is_active: unknown;
  sort_order: unknown;
  applies_to_roles: unknown;
  visible_in_profile: unknown;
  editable_in_profile: unknown;
  visible_to_player: unknown;
  editable_by_player: unknown;
  visible_to_coach: unknown;
  editable_by_coach: unknown;
  legacy_binding: unknown;
  scope: unknown;
};

type MemberFieldValueRow = {
  club_member_id: unknown;
  field_id: unknown;
  value_text: unknown;
  value_bool: unknown;
  value_option: unknown;
};

type SeasonFieldValueRow = {
  club_player_season_record_id: unknown;
  field_id: unknown;
  value_json: unknown;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeOptions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeFieldRoles(raw: unknown) {
  const fallback: MemberRole[] = ["player"];
  if (!Array.isArray(raw)) return fallback;
  const roles = Array.from(
    new Set(
      raw
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter((item): item is MemberRole => MEMBER_ROLES.includes(item as MemberRole))
    )
  );
  return roles.length > 0 ? roles : fallback;
}

function normalizeProfileVisibility(rawVisible: unknown, rawEditable: unknown) {
  const visibleInProfile = Boolean(rawVisible);
  return {
    visible_in_profile: visibleInProfile,
    editable_in_profile: visibleInProfile && Boolean(rawEditable),
  };
}

function roleProfilePermissions(field: PlayerFieldDef, role: MemberRole) {
  if (role === "player") {
    return { visible: field.visible_to_player, editable: field.visible_to_player && field.editable_by_player };
  }
  if (role === "coach") {
    return { visible: field.visible_to_coach, editable: field.visible_to_coach && field.editable_by_coach };
  }
  return { visible: field.visible_in_profile, editable: field.visible_in_profile && field.editable_in_profile };
}

function fieldAppliesToRole(field: Pick<PlayerFieldDef, "legacy_binding" | "applies_to_roles">, role: MemberRole) {
  if (field.legacy_binding) return role === "player";
  return normalizeFieldRoles(field.applies_to_roles).includes(role);
}

function normalizeLegacyCourseTrackValue(field: Pick<PlayerFieldDef, "options_json">, rawValue: unknown) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  const configuredOptions = Array.isArray(field.options_json)
    ? field.options_json.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (configuredOptions.length > 0) {
    return configuredOptions.includes(value) ? value : "__invalid__";
  }

  return value === "junior" || value === "competition" || value === "no_course" ? value : "__invalid__";
}

function readLegacyPlayerFieldValue(field: PlayerFieldDef, member: MembershipRow) {
  if (field.legacy_binding === "player_course_track") return member.player_course_track ?? null;
  if (field.legacy_binding === "player_membership_paid") return member.player_membership_paid ?? null;
  if (field.legacy_binding === "player_playing_right_paid") return member.player_playing_right_paid ?? null;
  return null;
}

function fieldScope(field: Pick<PlayerFieldDef, "scope" | "legacy_binding">): "permanent" | "season" {
  return field.legacy_binding ? "season" : field.scope;
}

function readSeasonFieldValue(field: PlayerFieldDef, record: PlayerSeasonRecordRow | undefined, member: MembershipRow) {
  if (!record) return readLegacyPlayerFieldValue(field, member);
  if (field.legacy_binding === "player_course_track") return record.course_label ?? member.player_course_track ?? null;
  if (field.legacy_binding === "player_membership_paid") {
    return record.membership_status === "paid" || record.membership_status === "waived";
  }
  if (field.legacy_binding === "player_playing_right_paid") {
    if (record.playing_right_status === "not_applicable") return null;
    return record.playing_right_status === "paid" || record.playing_right_status === "waived";
  }
  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

async function requireUser(
  req: NextRequest,
  getUser: (accessToken: string) => PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>
) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data, error } = await getUser(accessToken);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Invalid token" };

  return { ok: true as const, userId: data.user.id };
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await requireUser(req, (accessToken) => supabaseAdmin.auth.getUser(accessToken));
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data: membershipRows, error: membershipError } = await supabaseAdmin
      .from("club_members")
      .select("id,club_id,role,player_course_track,player_membership_paid,player_playing_right_paid")
      .eq("user_id", auth.userId)
      .eq("is_active", true)
      .in("role", [...MEMBER_ROLES]);

    if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 400 });

    const memberships = (membershipRows ?? []) as MembershipRow[];
    if (memberships.length === 0) return NextResponse.json({ memberships: [] });

    const clubIds = Array.from(new Set(memberships.map((membership) => String(membership.club_id ?? "")).filter(Boolean)));
    const memberIds = memberships.map((membership) => membership.id);

    const [
      { data: clubsRows, error: clubsError },
      { data: fieldRows, error: fieldsError },
      { data: seasonRows, error: seasonsError },
    ] = await Promise.all([
      supabaseAdmin.from("clubs").select("id,name").in("id", clubIds),
      supabaseAdmin
        .from("club_player_fields")
        .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,visible_to_player,editable_by_player,visible_to_coach,editable_by_coach,legacy_binding,scope")
        .in("club_id", clubIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("club_seasons").select("id,club_id,name").in("club_id", clubIds).eq("is_current", true),
    ]);

    if (clubsError) return NextResponse.json({ error: clubsError.message }, { status: 400 });
    if (fieldsError) return NextResponse.json({ error: fieldsError.message }, { status: 400 });
    if (seasonsError) return NextResponse.json({ error: seasonsError.message }, { status: 400 });

    const clubNameById = new Map<string, string>();
    for (const row of (clubsRows ?? []) as Array<{ id: unknown; name: unknown }>) {
      const clubId = String(row.id ?? "");
      if (!clubId) continue;
      clubNameById.set(clubId, String(row.name ?? "Organisation"));
    }

    const fields = ((fieldRows ?? []) as PlayerFieldSourceRow[]).map(
      (row): PlayerFieldDef => ({
        id: String(row.id),
        club_id: String(row.club_id),
        field_key: String(row.field_key ?? ""),
        label: String(row.label ?? ""),
        field_type: row.field_type as PlayerFieldDef["field_type"],
        options_json: normalizeOptions(row.options_json),
        is_active: Boolean(row.is_active),
        sort_order: Number(row.sort_order ?? 0),
        applies_to_roles: normalizeFieldRoles(row.applies_to_roles),
        ...normalizeProfileVisibility(row.visible_in_profile, row.editable_in_profile),
        visible_to_player: Boolean(row.visible_to_player),
        editable_by_player: Boolean(row.visible_to_player) && Boolean(row.editable_by_player),
        visible_to_coach: Boolean(row.visible_to_coach),
        editable_by_coach: Boolean(row.visible_to_coach) && Boolean(row.editable_by_coach),
        scope: row.scope === "season" ? "season" : "permanent",
        legacy_binding: (row.legacy_binding ?? null) as PlayerFieldDef["legacy_binding"],
      })
    );

    const currentSeasons = (seasonRows ?? []) as CurrentSeasonRow[];
    const seasonByClubId = new Map(currentSeasons.map((season) => [season.club_id, season]));
    const seasonIds = currentSeasons.map((season) => season.id);
    const seasonRecordByMemberId = new Map<string, PlayerSeasonRecordRow>();
    if (seasonIds.length > 0 && memberIds.length > 0) {
      const { data: recordRows, error: recordsError } = await supabaseAdmin
        .from("club_player_season_records")
        .select("id,club_season_id,club_member_id,course_label,membership_status,playing_right_status")
        .in("club_season_id", seasonIds)
        .in("club_member_id", memberIds);
      if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 400 });
      for (const record of (recordRows ?? []) as PlayerSeasonRecordRow[]) seasonRecordByMemberId.set(record.club_member_id, record);
    }

    const valueFieldIds = fields.filter((field) => fieldScope(field) === "permanent" && !field.legacy_binding).map((field) => field.id);
    const valuesByMemberId = new Map<string, Record<string, string | boolean | null>>();
    if (memberIds.length > 0 && valueFieldIds.length > 0) {
      const { data: valueRows, error: valuesError } = await supabaseAdmin
        .from("club_member_player_field_values")
        .select("club_member_id,field_id,value_text,value_bool,value_option")
        .in("club_member_id", memberIds)
        .in("field_id", valueFieldIds);
      if (valuesError) return NextResponse.json({ error: valuesError.message }, { status: 400 });

      for (const row of (valueRows ?? []) as MemberFieldValueRow[]) {
        const memberId = String(row.club_member_id ?? "");
        const fieldId = String(row.field_id ?? "");
        if (!memberId || !fieldId) continue;
        const current = valuesByMemberId.get(memberId) ?? {};
        current[fieldId] = row.value_option != null
          ? String(row.value_option)
          : row.value_bool != null
            ? Boolean(row.value_bool)
            : row.value_text != null
              ? String(row.value_text)
              : null;
        valuesByMemberId.set(memberId, current);
      }
    }

    const seasonValueByRecordId = new Map<string, Record<string, string | boolean | null>>();
    const seasonRecordIds = Array.from(seasonRecordByMemberId.values()).map((record) => record.id);
    const seasonFieldIds = fields.filter((field) => fieldScope(field) === "season" && !field.legacy_binding).map((field) => field.id);
    if (seasonRecordIds.length > 0 && seasonFieldIds.length > 0) {
      const { data: seasonValueRows, error: seasonValuesError } = await supabaseAdmin
        .from("club_player_season_field_values")
        .select("club_player_season_record_id,field_id,value_json")
        .in("club_player_season_record_id", seasonRecordIds)
        .in("field_id", seasonFieldIds);
      if (seasonValuesError) return NextResponse.json({ error: seasonValuesError.message }, { status: 400 });
      for (const row of (seasonValueRows ?? []) as SeasonFieldValueRow[]) {
        const recordId = String(row.club_player_season_record_id ?? "");
        const fieldId = String(row.field_id ?? "");
        if (!recordId || !fieldId) continue;
        const current = seasonValueByRecordId.get(recordId) ?? {};
        current[fieldId] = (row.value_json ?? null) as string | boolean | null;
        seasonValueByRecordId.set(recordId, current);
      }
    }

    const fieldsByClubId = new Map<string, PlayerFieldDef[]>();
    for (const field of fields) {
      const current = fieldsByClubId.get(field.club_id) ?? [];
      current.push(field);
      fieldsByClubId.set(field.club_id, current);
    }

    const membershipsPayload = memberships
      .map((membership) => {
        const applicableFields = (fieldsByClubId.get(membership.club_id) ?? [])
          .filter((field) => roleProfilePermissions(field, membership.role).visible && fieldAppliesToRole(field, membership.role))
          .map((field) => {
            const permissions = roleProfilePermissions(field, membership.role);
            const scope = fieldScope(field);
            const seasonRecord = seasonRecordByMemberId.get(membership.id);
            return {
            id: field.id,
            field_key: field.field_key,
            label: field.label,
            field_type: field.field_type,
            options_json: field.options_json,
            visible_in_profile: permissions.visible,
            editable_in_profile: permissions.editable,
            scope,
            value: scope === "season"
              ? field.legacy_binding
                ? readSeasonFieldValue(field, seasonRecord, membership)
                : seasonRecord
                  ? (seasonValueByRecordId.get(seasonRecord.id) ?? {})[field.id] ?? null
                  : null
              : field.legacy_binding
                ? readLegacyPlayerFieldValue(field, membership)
                : (valuesByMemberId.get(membership.id) ?? {})[field.id] ?? null,
            };
          });

        return {
          member_id: membership.id,
          club_id: membership.club_id,
          club_name: clubNameById.get(membership.club_id) ?? "Organisation",
          season_name: seasonByClubId.get(membership.club_id)?.name ?? null,
          role: membership.role,
          fields: applicableFields,
        };
      })
      .filter((membership) => membership.fields.length > 0);

    return NextResponse.json({ memberships: membershipsPayload });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await requireUser(req, (accessToken) => supabaseAdmin.auth.getUser(accessToken));
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length === 0) return NextResponse.json({ ok: true });

    const memberIds = Array.from(
      new Set(
        updates
          .map((item) => String(item?.member_id ?? ""))
          .filter(Boolean)
      )
    );
    if (memberIds.length === 0) return NextResponse.json({ ok: true });

    const { data: membershipRows, error: membershipError } = await supabaseAdmin
      .from("club_members")
      .select("id,club_id,role,player_course_track,player_membership_paid,player_playing_right_paid")
      .eq("user_id", auth.userId)
      .eq("is_active", true)
      .in("id", memberIds);
    if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 400 });

    const memberships = (membershipRows ?? []) as MembershipRow[];
    const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));
    const clubIds = Array.from(new Set(memberships.map((membership) => membership.club_id)));

    const wantedFieldIds = Array.from(
      new Set(
        updates.flatMap((item) =>
          item?.values && typeof item.values === "object" ? Object.keys(item.values as Record<string, unknown>) : []
        )
      )
    );
    if (wantedFieldIds.length === 0) return NextResponse.json({ ok: true });

    const { data: fieldRows, error: fieldsError } = await supabaseAdmin
      .from("club_player_fields")
      .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,visible_to_player,editable_by_player,visible_to_coach,editable_by_coach,legacy_binding,scope")
      .in("club_id", clubIds)
      .in("id", wantedFieldIds);
    if (fieldsError) return NextResponse.json({ error: fieldsError.message }, { status: 400 });

    const fields = ((fieldRows ?? []) as PlayerFieldSourceRow[]).map(
      (row): PlayerFieldDef => ({
        id: String(row.id),
        club_id: String(row.club_id),
        field_key: String(row.field_key ?? ""),
        label: String(row.label ?? ""),
        field_type: row.field_type as PlayerFieldDef["field_type"],
        options_json: normalizeOptions(row.options_json),
        is_active: Boolean(row.is_active),
        sort_order: Number(row.sort_order ?? 0),
        applies_to_roles: normalizeFieldRoles(row.applies_to_roles),
        ...normalizeProfileVisibility(row.visible_in_profile, row.editable_in_profile),
        visible_to_player: Boolean(row.visible_to_player),
        editable_by_player: Boolean(row.visible_to_player) && Boolean(row.editable_by_player),
        visible_to_coach: Boolean(row.visible_to_coach),
        editable_by_coach: Boolean(row.visible_to_coach) && Boolean(row.editable_by_coach),
        scope: row.scope === "season" ? "season" : "permanent",
        legacy_binding: (row.legacy_binding ?? null) as PlayerFieldDef["legacy_binding"],
      })
    );
    const fieldById = new Map(fields.map((field) => [field.id, field]));

    const { data: currentSeasonRows, error: currentSeasonsError } = await supabaseAdmin
      .from("club_seasons")
      .select("id,club_id,name")
      .in("club_id", clubIds)
      .eq("is_current", true);
    if (currentSeasonsError) return NextResponse.json({ error: currentSeasonsError.message }, { status: 400 });
    const currentSeasonByClubId = new Map(
      ((currentSeasonRows ?? []) as CurrentSeasonRow[]).map((season) => [season.club_id, season])
    );

    const seasonIds = Array.from(currentSeasonByClubId.values()).map((season) => season.id);
    const seasonRecordByMemberId = new Map<string, PlayerSeasonRecordRow>();
    if (seasonIds.length > 0) {
      const { data: seasonRecordRows, error: seasonRecordsError } = await supabaseAdmin
        .from("club_player_season_records")
        .select("id,club_season_id,club_member_id,course_label,membership_status,playing_right_status")
        .in("club_season_id", seasonIds)
        .in("club_member_id", memberIds);
      if (seasonRecordsError) return NextResponse.json({ error: seasonRecordsError.message }, { status: 400 });
      for (const record of (seasonRecordRows ?? []) as PlayerSeasonRecordRow[]) seasonRecordByMemberId.set(record.club_member_id, record);
    }

    for (const update of updates) {
      const memberId = String(update?.member_id ?? "");
      const values = update?.values && typeof update.values === "object" ? (update.values as Record<string, unknown>) : {};
      const membership = membershipById.get(memberId);
      if (!membership) continue;

      for (const [fieldId, rawValue] of Object.entries(values)) {
        const field = fieldById.get(fieldId);
        if (!field || field.club_id !== membership.club_id) continue;
        const permissions = roleProfilePermissions(field, membership.role);
        if (!field.is_active || !permissions.visible || !permissions.editable || !fieldAppliesToRole(field, membership.role)) {
          continue;
        }

        if (fieldScope(field) === "season") {
          const currentSeason = currentSeasonByClubId.get(membership.club_id);
          if (!currentSeason) {
            return NextResponse.json({ error: `Aucune saison courante pour ${field.label}` }, { status: 400 });
          }

          let seasonRecord = seasonRecordByMemberId.get(memberId);
          if (!seasonRecord) {
            const { data: createdRecord, error: createRecordError } = await supabaseAdmin
              .from("club_player_season_records")
              .upsert(
                { club_season_id: currentSeason.id, club_member_id: memberId },
                { onConflict: "club_season_id,club_member_id" }
              )
              .select("id,club_season_id,club_member_id,course_label,membership_status,playing_right_status")
              .single();
            if (createRecordError) return NextResponse.json({ error: createRecordError.message }, { status: 400 });
            seasonRecord = createdRecord as PlayerSeasonRecordRow;
            seasonRecordByMemberId.set(memberId, seasonRecord);
          }

          if (field.legacy_binding) {
            const seasonPatch: Record<string, string | null> = {};
            if (field.legacy_binding === "player_course_track") {
              const next = normalizeLegacyCourseTrackValue(field, rawValue);
              if (next === "__invalid__") {
                return NextResponse.json({ error: `Valeur invalide pour ${field.label}` }, { status: 400 });
              }
              seasonPatch.course_label = next;
            } else if (field.legacy_binding === "player_membership_paid") {
              seasonPatch.membership_status = Boolean(rawValue) ? "paid" : "pending";
            } else if (field.legacy_binding === "player_playing_right_paid") {
              seasonPatch.playing_right_status = Boolean(rawValue) ? "paid" : "pending";
            }
            const { error } = await supabaseAdmin.from("club_player_season_records").update(seasonPatch).eq("id", seasonRecord.id);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
            continue;
          }

          const isEmpty = rawValue == null || (typeof rawValue === "string" && rawValue.trim() === "");
          if (isEmpty) {
            const { error } = await supabaseAdmin
              .from("club_player_season_field_values")
              .delete()
              .eq("club_player_season_record_id", seasonRecord.id)
              .eq("field_id", fieldId);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          } else {
            const { error } = await supabaseAdmin.from("club_player_season_field_values").upsert(
              { club_player_season_record_id: seasonRecord.id, field_id: fieldId, value_json: rawValue },
              { onConflict: "club_player_season_record_id,field_id" }
            );
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          }
          continue;
        }

        if (field.legacy_binding) {
          if (field.legacy_binding === "player_course_track") {
            const next = normalizeLegacyCourseTrackValue(field, rawValue);
            if (next === "__invalid__") {
              return NextResponse.json({ error: `Valeur invalide pour ${field.label}` }, { status: 400 });
            }
            const { error } = await supabaseAdmin.from("club_members").update({ player_course_track: next }).eq("id", memberId);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          } else if (field.legacy_binding === "player_membership_paid") {
            const next = rawValue == null || rawValue === "" ? null : Boolean(rawValue);
            const { error } = await supabaseAdmin.from("club_members").update({ player_membership_paid: next }).eq("id", memberId);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          } else if (field.legacy_binding === "player_playing_right_paid") {
            const next = rawValue == null || rawValue === "" ? null : Boolean(rawValue);
            const { error } = await supabaseAdmin.from("club_members").update({ player_playing_right_paid: next }).eq("id", memberId);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          }
          continue;
        }

        const isEmpty =
          rawValue == null ||
          (typeof rawValue === "string" && rawValue.trim() === "") ||
          (field.field_type === "select" && String(rawValue ?? "").trim() === "");

        if (isEmpty) {
          const { error } = await supabaseAdmin
            .from("club_member_player_field_values")
            .delete()
            .eq("club_member_id", memberId)
            .eq("field_id", fieldId);
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          continue;
        }

        const valuePatch: Record<string, string | boolean | null> & { club_member_id: string; field_id: string } = {
          club_member_id: memberId,
          field_id: fieldId,
          value_text: null,
          value_bool: null,
          value_option: null,
        };

        if (["text", "short_text", "long_text", "number", "date", "checkbox"].includes(field.field_type)) {
          valuePatch.value_text = String(rawValue).trim();
        } else if (field.field_type === "boolean") {
          valuePatch.value_bool = Boolean(rawValue);
        } else if (field.field_type === "select" || field.field_type === "radio") {
          const option = String(rawValue).trim();
          if (field.options_json.length > 0 && !field.options_json.includes(option)) {
            return NextResponse.json({ error: `Valeur invalide pour ${field.label}` }, { status: 400 });
          }
          valuePatch.value_option = option;
        }

        const { error } = await supabaseAdmin
          .from("club_member_player_field_values")
          .upsert(valuePatch, { onConflict: "club_member_id,field_id" });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
