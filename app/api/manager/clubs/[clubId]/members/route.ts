import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PlayerFieldDef = {
  id: string;
  club_id: string;
  field_key: string;
  label: string;
  field_type: "text" | "boolean" | "select";
  options_json: string[] | null;
  is_active: boolean;
  sort_order: number;
  applies_to_roles: Array<"manager" | "coach" | "player" | "parent">;
  visible_in_profile: boolean;
  editable_in_profile: boolean;
  legacy_binding: "player_course_track" | "player_membership_paid" | "player_playing_right_paid" | null;
};

const MEMBER_ROLES = ["manager", "coach", "player", "parent"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

function normalizePlayerFieldOptions(raw: unknown) {
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

function normalizePlayerFieldToken(raw: unknown) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isSionSpecificPlayerField(field: Pick<PlayerFieldDef, "field_key" | "label" | "legacy_binding">) {
  if (
    field.legacy_binding === "player_course_track" ||
    field.legacy_binding === "player_membership_paid" ||
    field.legacy_binding === "player_playing_right_paid"
  ) {
    return true;
  }

  const labelToken = normalizePlayerFieldToken(field.label).replace(/_/g, " ");
  if (labelToken === "cours" || labelToken === "cotisation" || labelToken === "droit de jeu") {
    return true;
  }

  const fieldKey = normalizePlayerFieldToken(field.field_key);
  return (
    fieldKey === "legacy_course_track" ||
    fieldKey === "legacy_membership_paid" ||
    fieldKey === "legacy_playing_right_paid" ||
    fieldKey.startsWith("cours_") ||
    fieldKey.startsWith("cotisation_") ||
    fieldKey.startsWith("droit_de_jeu_")
  );
}

function readLegacyPlayerFieldValue(field: PlayerFieldDef, member: any) {
  if (field.legacy_binding === "player_course_track") return member.player_course_track ?? null;
  if (field.legacy_binding === "player_membership_paid") return member.player_membership_paid ?? null;
  if (field.legacy_binding === "player_playing_right_paid") return member.player_playing_right_paid ?? null;
  return null;
}

function fieldAppliesToRole(field: Pick<PlayerFieldDef, "legacy_binding" | "applies_to_roles">, role: string) {
  if (field.legacy_binding) return role === "player";
  return normalizeFieldRoles(field.applies_to_roles).includes(role as MemberRole);
}

async function fetchClubPlayerFields(supabaseAdmin: any, clubId: string) {
  const { data, error } = await supabaseAdmin
    .from("club_player_fields")
    .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,legacy_binding")
    .eq("club_id", clubId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as any[])
    .map((row) => ({
      id: String(row.id),
      club_id: String(row.club_id),
      field_key: String(row.field_key ?? ""),
      label: String(row.label ?? ""),
      field_type: row.field_type as PlayerFieldDef["field_type"],
      options_json: normalizePlayerFieldOptions(row.options_json),
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order ?? 0),
      applies_to_roles: normalizeFieldRoles(row.applies_to_roles),
      ...normalizeProfileVisibility(row.visible_in_profile, row.editable_in_profile),
      legacy_binding: (row.legacy_binding ?? null) as PlayerFieldDef["legacy_binding"],
    }))
    .filter((field) => field.is_active || !isSionSpecificPlayerField(field)) satisfies PlayerFieldDef[];
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeAuthEmailInput(raw: string) {
  const email = (raw ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return email;
}

async function fetchAuthUsersByIds(supabaseAdmin: any, userIds: string[]) {
  const authUserById = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
  if (userIds.length === 0) return authUserById;

  const authSchema = (supabaseAdmin as any).schema("auth");
  const { data, error } = await authSchema.from("users").select("id,email,last_sign_in_at").in("id", userIds);
  if (!error) {
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const userId = String((row as any).id ?? "");
      if (!userId) continue;
      authUserById.set(userId, {
        email: (row as any).email ?? null,
        last_sign_in_at: (row as any).last_sign_in_at ?? null,
      });
    }
  } else {
    const wanted = new Set(userIds);
    const perPage = Math.min(1000, Math.max(200, userIds.length));
    let page = 1;

    while (wanted.size > 0) {
      const adminRes = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (adminRes.error) break;

      const users = adminRes.data?.users ?? [];
      if (users.length === 0) break;

      for (const user of users) {
        if (!wanted.has(user.id)) continue;
        authUserById.set(user.id, {
          email: user.email ?? null,
          last_sign_in_at: user.last_sign_in_at ?? null,
        });
        wanted.delete(user.id);
      }

      if (users.length < perPage) break;
      page += 1;
    }
  }

  for (const userId of userIds) {
    if (authUserById.has(userId)) continue;
    authUserById.set(userId, { email: null, last_sign_in_at: null });
  }

  return authUserById;
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (adminRow) return { ok: true as const, callerId };

  const { data: membership } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership || membership.role !== "manager") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, callerId };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data: membersRows, error: membersError } = await supabaseAdmin
      .from("club_members")
      .select("id,club_id,user_id,role,is_active,is_performance,player_course_track,player_membership_paid,player_playing_right_paid,player_consent_status,created_at")
      .eq("club_id", clubId)
      .order("created_at", { ascending: false });

    if (membersError) return NextResponse.json({ error: membersError.message }, { status: 400 });

    const members = membersRows ?? [];
    const playerFields = await fetchClubPlayerFields(supabaseAdmin, clubId);
    const userIds = Array.from(new Set(members.map((m: any) => String(m.user_id)).filter(Boolean)));
    const memberIds = Array.from(new Set(members.map((m: any) => String(m.id)).filter(Boolean)));
    const customFieldIds = playerFields.filter((field) => !field.legacy_binding).map((field) => field.id);

    const valuesByMemberId = new Map<string, Record<string, string | boolean | null>>();
    if (memberIds.length > 0 && customFieldIds.length > 0) {
      const { data: valueRows, error: valuesError } = await supabaseAdmin
        .from("club_member_player_field_values")
        .select("club_member_id,field_id,value_text,value_bool,value_option")
        .in("club_member_id", memberIds)
        .in("field_id", customFieldIds);
      if (valuesError) return NextResponse.json({ error: valuesError.message }, { status: 400 });

      for (const row of valueRows ?? []) {
        const memberId = String((row as any).club_member_id);
        const fieldId = String((row as any).field_id);
        const current = valuesByMemberId.get(memberId) ?? {};
        current[fieldId] =
          (row as any).value_option ??
          ((row as any).value_bool == null ? null : Boolean((row as any).value_bool)) ??
          ((row as any).value_text ?? null);
        valuesByMemberId.set(memberId, current);
      }
    }

    const consentStatusByUserId = new Map<string, "granted" | "pending" | "adult" | null>();
    if (userIds.length > 0) {
      const { data: consentRows, error: consentError } = await supabaseAdmin
        .from("club_members")
        .select("user_id,player_consent_status")
        .in("user_id", userIds)
        .eq("role", "player")
        .eq("is_active", true);
      if (consentError) return NextResponse.json({ error: consentError.message }, { status: 400 });

      const rawByUser = new Map<string, string[]>();
      for (const row of consentRows ?? []) {
        const userId = String((row as any).user_id ?? "");
        if (!userId) continue;
        const next = rawByUser.get(userId) ?? [];
        next.push(String((row as any).player_consent_status ?? ""));
        rawByUser.set(userId, next);
      }
      for (const [userId, statuses] of rawByUser.entries()) {
        if (statuses.includes("granted")) consentStatusByUserId.set(userId, "granted");
        else if (statuses.includes("adult")) consentStatusByUserId.set(userId, "adult");
        else if (statuses.includes("pending")) consentStatusByUserId.set(userId, "pending");
        else consentStatusByUserId.set(userId, null);
      }
    }

    let profileById = new Map<
      string,
      {
        id: string;
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        phone: string | null;
        birth_date: string | null;
        sex: string | null;
        handedness: string | null;
        handicap: number | null;
        address: string | null;
        postal_code: string | null;
        city: string | null;
        avs_no: string | null;
        avatar_url: string | null;
        staff_function: string | null;
      }
    >();
    if (userIds.length > 0) {
      const { data: profilesRows, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select(
          [
            "id",
            "first_name",
            "last_name",
            "username",
            "phone",
            "birth_date",
            "sex",
            "handedness",
            "handicap",
            "address",
            "postal_code",
            "city",
            "avs_no",
            "avatar_url",
            "staff_function",
          ].join(",")
        )
        .in("id", userIds);
      if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 400 });
      profileById = new Map(
        (profilesRows ?? []).map((p: any) => [
          String(p.id),
          {
            id: String(p.id),
            first_name: (p.first_name ?? null) as string | null,
            last_name: (p.last_name ?? null) as string | null,
            username: (p.username ?? null) as string | null,
            phone: (p.phone ?? null) as string | null,
            birth_date: (p.birth_date ?? null) as string | null,
            sex: (p.sex ?? null) as string | null,
            handedness: (p.handedness ?? null) as string | null,
            handicap: p.handicap == null ? null : Number(p.handicap),
            address: (p.address ?? null) as string | null,
            postal_code: (p.postal_code ?? null) as string | null,
            city: (p.city ?? null) as string | null,
            avs_no: (p.avs_no ?? null) as string | null,
            avatar_url: (p.avatar_url ?? null) as string | null,
            staff_function: (p.staff_function ?? null) as string | null,
          },
        ])
      );
    }

    const authUserById = await fetchAuthUsersByIds(supabaseAdmin, userIds);

    const hydratedMembers = members.map((m: any) => {
      const playerFieldValues = valuesByMemberId.get(String(m.id)) ?? {};
      for (const field of playerFields) {
        if (!field.legacy_binding) continue;
        playerFieldValues[field.id] = readLegacyPlayerFieldValue(field, m);
      }
      return {
        id: String(m.id),
        club_id: String(m.club_id),
        user_id: String(m.user_id),
        role: m.role,
        is_active: m.is_active,
        is_performance: m.is_performance,
        player_course_track: m.player_course_track ?? null,
        player_membership_paid: m.player_membership_paid ?? null,
        player_playing_right_paid: m.player_playing_right_paid ?? null,
        player_consent_status: consentStatusByUserId.get(String(m.user_id)) ?? m.player_consent_status ?? null,
        custom_field_values: playerFieldValues,
        player_field_values: playerFieldValues,
        auth_email: authUserById.get(String(m.user_id))?.email ?? null,
        auth_last_sign_in_at: authUserById.get(String(m.user_id))?.last_sign_in_at ?? null,
        profiles: profileById.get(String(m.user_id)) ?? null,
      };
    });

    return NextResponse.json({ members: hydratedMembers, playerFields });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const memberId = String(body.memberId ?? "");
    const role = String(body.role ?? "").trim();
    const isActive = body.is_active;
    const isPerformance = body.is_performance;
    const authEmailRaw = typeof body.auth_email === "string" ? body.auth_email : "";
    const authEmail = normalizeAuthEmailInput(authEmailRaw);
    const authPassword = typeof body.auth_password === "string" ? body.auth_password : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : null;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

    if (!memberId) return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    if (role && !["manager", "coach", "player", "parent"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const playerCourseTrackRaw = has("player_course_track") ? String(body.player_course_track ?? "").trim().toLowerCase() : "";
    const playerCourseTrack =
      playerCourseTrackRaw === ""
        ? null
        : playerCourseTrackRaw === "junior" || playerCourseTrackRaw === "competition" || playerCourseTrackRaw === "no_course"
        ? playerCourseTrackRaw
        : "__invalid__";
    if (playerCourseTrack === "__invalid__") {
      return NextResponse.json({ error: "Invalid player course track" }, { status: 400 });
    }

    const playerConsentStatusRaw = has("player_consent_status") ? String(body.player_consent_status ?? "").trim().toLowerCase() : "";
    const playerConsentStatus =
      playerConsentStatusRaw === ""
        ? null
        : playerConsentStatusRaw === "granted" || playerConsentStatusRaw === "pending" || playerConsentStatusRaw === "adult"
        ? playerConsentStatusRaw
        : "__invalid__";
    if (playerConsentStatus === "__invalid__") {
      return NextResponse.json({ error: "Invalid player consent status" }, { status: 400 });
    }

    const playerMembershipPaid =
      has("player_membership_paid") ? (body.player_membership_paid == null ? null : Boolean(body.player_membership_paid)) : undefined;
    const playerPlayingRightPaid =
      has("player_playing_right_paid") ? (body.player_playing_right_paid == null ? null : Boolean(body.player_playing_right_paid)) : undefined;

    const { data: memberRow, error: memberErr } = await supabaseAdmin
      .from("club_members")
      .select("id,user_id,club_id,role")
      .eq("id", memberId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 400 });
    if (!memberRow) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const memberPatch: Record<string, any> = {};
    if (role) memberPatch.role = role;
    if (typeof isActive === "boolean") memberPatch.is_active = isActive;
    if (typeof isPerformance === "boolean") memberPatch.is_performance = isPerformance;
    const effectiveRole = role || (memberRow as any).role || "";
    const playerFields = await fetchClubPlayerFields(supabaseAdmin, clubId);
    const fieldById = new Map(playerFields.map((field) => [field.id, field]));
    if (effectiveRole === "player") {
      if (has("player_course_track")) memberPatch.player_course_track = playerCourseTrack;
      if (has("player_membership_paid")) memberPatch.player_membership_paid = playerMembershipPaid;
      if (has("player_playing_right_paid")) memberPatch.player_playing_right_paid = playerPlayingRightPaid;
      if (has("player_consent_status")) memberPatch.player_consent_status = playerConsentStatus;
    } else if (role && role !== "player") {
      memberPatch.player_course_track = null;
      memberPatch.player_membership_paid = null;
      memberPatch.player_playing_right_paid = null;
      memberPatch.player_consent_status = null;
    }

    if (Object.keys(memberPatch).length > 0) {
      const { error } = await supabaseAdmin.from("club_members").update(memberPatch).eq("id", memberId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (effectiveRole === "player" && has("player_consent_status")) {
      const { error: consentSyncError } = await supabaseAdmin
        .from("club_members")
        .update({ player_consent_status: playerConsentStatus })
        .eq("user_id", memberRow.user_id)
        .eq("role", "player")
        .eq("is_active", true);
      if (consentSyncError) return NextResponse.json({ error: consentSyncError.message }, { status: 400 });
    }

    const fieldIdsToClear = playerFields.filter((field) => !fieldAppliesToRole(field, effectiveRole)).map((field) => field.id);
    if (fieldIdsToClear.length > 0) {
      const { error: deleteFieldValuesError } = await supabaseAdmin
        .from("club_member_player_field_values")
        .delete()
        .eq("club_member_id", memberId)
        .in("field_id", fieldIdsToClear);
      if (deleteFieldValuesError) return NextResponse.json({ error: deleteFieldValuesError.message }, { status: 400 });
    }

    const customFieldValues =
      has("custom_field_values") && body.custom_field_values && typeof body.custom_field_values === "object"
        ? (body.custom_field_values as Record<string, unknown>)
        : has("player_field_values") && body.player_field_values && typeof body.player_field_values === "object"
        ? (body.player_field_values as Record<string, unknown>)
        : null;

    if (customFieldValues) {
      const playerFieldValues = customFieldValues;
      for (const [fieldId, rawValue] of Object.entries(playerFieldValues)) {
        const field = fieldById.get(fieldId);
        if (!field) continue;
        if (!fieldAppliesToRole(field, effectiveRole)) continue;

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

        const valuePatch: Record<string, any> = {
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
          if (field.options_json && field.options_json.length > 0 && !field.options_json.includes(option)) {
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

    if (has("auth_email") || has("auth_password")) {
      const authPatch: Record<string, any> = {};
      if (has("auth_email")) {
        if (authEmailRaw.trim() && !authEmail) {
          // ignore technical placeholder addresses like *@noemail.local
        } else if (authEmail && !authEmail.includes("@")) {
          return NextResponse.json({ error: "Invalid email" }, { status: 400 });
        }
        if (authEmail) authPatch.email = authEmail;
      }
      if (has("auth_password")) {
        if (authPassword && authPassword.length < 8) {
          return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
        }
        if (authPassword) authPatch.password = authPassword;
      }
      if (Object.keys(authPatch).length > 0) {
        if (authPatch.email) authPatch.email_confirm = true;
        const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(memberRow.user_id, authPatch);
        if (authUpdateErr) return NextResponse.json({ error: authUpdateErr.message }, { status: 400 });
      }
    }

    const profilePatch: Record<string, any> = {};
    const putString = (key: string) => {
      if (!has(key)) return;
      const value = body[key];
      profilePatch[key] = typeof value === "string" ? value.trim() || null : value == null ? null : String(value).trim() || null;
    };

    putString("first_name");
    putString("last_name");
    if (has("username")) {
      profilePatch.username = username || null;
    }
    putString("phone");
    putString("birth_date");
    putString("sex");
    putString("address");
    putString("postal_code");
    putString("city");
    putString("avs_no");
    putString("staff_function");

    if (has("handedness")) {
      const raw = body.handedness;
      const v = typeof raw === "string" ? raw.trim().toLowerCase() : raw == null ? "" : String(raw).trim().toLowerCase();
      if (v !== "" && v !== "right" && v !== "left") {
        return NextResponse.json({ error: "Invalid handedness" }, { status: 400 });
      }
      profilePatch.handedness = v || null;
    }

    if (has("handicap")) {
      const raw = body.handicap;
      if (raw == null || raw === "") {
        profilePatch.handicap = null;
      } else {
        const rawText = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        if (rawText === "AP") {
          profilePatch.handicap = null;
          // AP is accepted as a non-numeric handicap marker.
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            return NextResponse.json({ error: "Invalid handicap" }, { status: 400 });
          }
          profilePatch.handicap = n;
        }
      }
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(profilePatch).eq("id", memberRow.user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
