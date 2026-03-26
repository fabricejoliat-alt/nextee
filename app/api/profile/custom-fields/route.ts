import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MEMBER_ROLES = ["manager", "coach", "player", "parent"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

type PlayerFieldDef = {
  id: string;
  club_id: string;
  field_key: string;
  label: string;
  field_type: "text" | "boolean" | "select";
  options_json: string[];
  is_active: boolean;
  sort_order: number;
  applies_to_roles: MemberRole[];
  visible_in_profile: boolean;
  editable_in_profile: boolean;
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

function fieldAppliesToRole(field: Pick<PlayerFieldDef, "legacy_binding" | "applies_to_roles">, role: MemberRole) {
  if (field.legacy_binding) return role === "player";
  return normalizeFieldRoles(field.applies_to_roles).includes(role);
}

function readLegacyPlayerFieldValue(field: PlayerFieldDef, member: MembershipRow) {
  if (field.legacy_binding === "player_course_track") return member.player_course_track ?? null;
  if (field.legacy_binding === "player_membership_paid") return member.player_membership_paid ?? null;
  if (field.legacy_binding === "player_playing_right_paid") return member.player_playing_right_paid ?? null;
  return null;
}

async function requireUser(req: NextRequest, supabaseAdmin: any) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Invalid token" };

  return { ok: true as const, userId: data.user.id };
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await requireUser(req, supabaseAdmin);
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

    const [{ data: clubsRows, error: clubsError }, { data: fieldRows, error: fieldsError }] = await Promise.all([
      supabaseAdmin.from("clubs").select("id,name").in("id", clubIds),
      supabaseAdmin
        .from("club_player_fields")
        .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,legacy_binding")
        .in("club_id", clubIds)
        .eq("is_active", true)
        .eq("visible_in_profile", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (clubsError) return NextResponse.json({ error: clubsError.message }, { status: 400 });
    if (fieldsError) return NextResponse.json({ error: fieldsError.message }, { status: 400 });

    const clubNameById = new Map<string, string>();
    for (const row of clubsRows ?? []) {
      const clubId = String((row as any).id ?? "");
      if (!clubId) continue;
      clubNameById.set(clubId, String((row as any).name ?? "Organisation"));
    }

    const fields = ((fieldRows ?? []) as any[]).map(
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
        legacy_binding: (row.legacy_binding ?? null) as PlayerFieldDef["legacy_binding"],
      })
    );

    const valueFieldIds = fields.filter((field) => !field.legacy_binding).map((field) => field.id);
    const valuesByMemberId = new Map<string, Record<string, string | boolean | null>>();
    if (memberIds.length > 0 && valueFieldIds.length > 0) {
      const { data: valueRows, error: valuesError } = await supabaseAdmin
        .from("club_member_player_field_values")
        .select("club_member_id,field_id,value_text,value_bool,value_option")
        .in("club_member_id", memberIds)
        .in("field_id", valueFieldIds);
      if (valuesError) return NextResponse.json({ error: valuesError.message }, { status: 400 });

      for (const row of valueRows ?? []) {
        const memberId = String((row as any).club_member_id ?? "");
        const fieldId = String((row as any).field_id ?? "");
        if (!memberId || !fieldId) continue;
        const current = valuesByMemberId.get(memberId) ?? {};
        current[fieldId] =
          (row as any).value_option ??
          ((row as any).value_bool == null ? null : Boolean((row as any).value_bool)) ??
          ((row as any).value_text ?? null);
        valuesByMemberId.set(memberId, current);
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
          .filter((field) => field.visible_in_profile && fieldAppliesToRole(field, membership.role))
          .map((field) => ({
            id: field.id,
            field_key: field.field_key,
            label: field.label,
            field_type: field.field_type,
            options_json: field.options_json,
            visible_in_profile: field.visible_in_profile,
            editable_in_profile: field.editable_in_profile,
            value: field.legacy_binding
              ? readLegacyPlayerFieldValue(field, membership)
              : (valuesByMemberId.get(membership.id) ?? {})[field.id] ?? null,
          }));

        return {
          member_id: membership.id,
          club_id: membership.club_id,
          club_name: clubNameById.get(membership.club_id) ?? "Organisation",
          role: membership.role,
          fields: applicableFields,
        };
      })
      .filter((membership) => membership.fields.length > 0);

    return NextResponse.json({ memberships: membershipsPayload });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await requireUser(req, supabaseAdmin);
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
      .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,legacy_binding")
      .in("club_id", clubIds)
      .in("id", wantedFieldIds);
    if (fieldsError) return NextResponse.json({ error: fieldsError.message }, { status: 400 });

    const fields = ((fieldRows ?? []) as any[]).map(
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
        legacy_binding: (row.legacy_binding ?? null) as PlayerFieldDef["legacy_binding"],
      })
    );
    const fieldById = new Map(fields.map((field) => [field.id, field]));

    for (const update of updates) {
      const memberId = String(update?.member_id ?? "");
      const values = update?.values && typeof update.values === "object" ? (update.values as Record<string, unknown>) : {};
      const membership = membershipById.get(memberId);
      if (!membership) continue;

      for (const [fieldId, rawValue] of Object.entries(values)) {
        const field = fieldById.get(fieldId);
        if (!field || field.club_id !== membership.club_id) continue;
        if (!field.is_active || !field.visible_in_profile || !field.editable_in_profile || !fieldAppliesToRole(field, membership.role)) {
          continue;
        }

        if (field.legacy_binding) {
          if (field.legacy_binding === "player_course_track") {
            const next =
              rawValue == null || String(rawValue).trim() === ""
                ? null
                : ["junior", "competition", "no_course"].includes(String(rawValue).trim())
                ? String(rawValue).trim()
                : "__invalid__";
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

        if (field.field_type === "text") {
          valuePatch.value_text = String(rawValue).trim();
        } else if (field.field_type === "boolean") {
          valuePatch.value_bool = Boolean(rawValue);
        } else if (field.field_type === "select") {
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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
