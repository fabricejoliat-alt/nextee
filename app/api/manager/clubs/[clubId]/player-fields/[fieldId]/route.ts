import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;
  const { data: adminRow } = await supabaseAdmin.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle();
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

function normalizeOptions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeProfileVisibility(rawVisible: unknown, rawEditable: unknown) {
  const visibleInProfile = Boolean(rawVisible);
  return {
    visible_in_profile: visibleInProfile,
    editable_in_profile: visibleInProfile && Boolean(rawEditable),
  };
}

function normalizeRoleProfilePermissions(body: Record<string, unknown>) {
  const visibleToPlayer = Boolean(body?.visible_to_player);
  const visibleToCoach = Boolean(body?.visible_to_coach);
  return {
    visible_to_player: visibleToPlayer,
    editable_by_player: visibleToPlayer && Boolean(body?.editable_by_player),
    visible_to_coach: visibleToCoach,
    editable_by_coach: visibleToCoach && Boolean(body?.editable_by_coach),
    visible_in_profile: visibleToPlayer || visibleToCoach,
    editable_in_profile:
      (visibleToPlayer && Boolean(body?.editable_by_player)) ||
      (visibleToCoach && Boolean(body?.editable_by_coach)),
  };
}

const MEMBER_ROLES = ["manager", "coach", "player", "parent"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string; fieldId: string }> }) {
  try {
    const { clubId, fieldId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const { data: field, error: fieldError } = await supabaseAdmin
      .from("club_player_fields")
      .select("id,legacy_binding,field_type,applies_to_roles,visible_in_profile,editable_in_profile,visible_to_player,editable_by_player,visible_to_coach,editable_by_coach")
      .eq("id", fieldId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (fieldError) return NextResponse.json({ error: fieldError.message }, { status: 400 });
    if (!field) return NextResponse.json({ error: "Champ introuvable" }, { status: 404 });

    const patch: Record<string, any> = {};
    if (Object.prototype.hasOwnProperty.call(body, "label")) {
      const label = String(body.label ?? "").trim();
      if (!label) return NextResponse.json({ error: "Label manquant" }, { status: 400 });
      patch.label = label;
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
      patch.is_active = Boolean(body.is_active);
    }
    if (Object.prototype.hasOwnProperty.call(body, "sort_order")) {
      const sortOrder = Number(body.sort_order ?? 0);
      patch.sort_order = Number.isFinite(sortOrder) ? sortOrder : 0;
    }
    if (!field.legacy_binding && Object.prototype.hasOwnProperty.call(body, "field_type")) {
      const fieldType = String(body.field_type ?? "").trim().toLowerCase();
      if (!["text", "short_text", "long_text", "number", "date", "select", "radio", "checkbox", "boolean"].includes(fieldType)) {
        return NextResponse.json({ error: "Type invalide" }, { status: 400 });
      }
      patch.field_type = fieldType;
    }
    if (!field.legacy_binding && Object.prototype.hasOwnProperty.call(body, "applies_to_roles")) {
      patch.applies_to_roles = normalizeFieldRoles(body.applies_to_roles);
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "visible_to_player") ||
      Object.prototype.hasOwnProperty.call(body, "editable_by_player") ||
      Object.prototype.hasOwnProperty.call(body, "visible_to_coach") ||
      Object.prototype.hasOwnProperty.call(body, "editable_by_coach")
    ) {
      Object.assign(patch, normalizeRoleProfilePermissions({ ...field, ...body }));
    }
    if (Object.prototype.hasOwnProperty.call(body, "options")) {
      const nextType = String(patch.field_type ?? field.field_type);
      const options = normalizeOptions(body.options);
      if (["select", "radio", "checkbox"].includes(nextType) && options.length === 0) {
        return NextResponse.json({ error: "Les options sont requises" }, { status: 400 });
      }
      patch.options_json = ["select", "radio", "checkbox"].includes(nextType) ? options : [];
    }
    if (Object.prototype.hasOwnProperty.call(body, "scope")) patch.scope = body.scope === "season" ? "season" : "permanent";
    if (Object.prototype.hasOwnProperty.call(body, "description")) patch.description = String(body.description ?? "").trim() || null;

    const { data, error } = await supabaseAdmin
      .from("club_player_fields")
      .update(patch)
      .eq("id", fieldId)
      .eq("club_id", clubId)
      .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,visible_to_player,editable_by_player,visible_to_coach,editable_by_coach,legacy_binding,scope,description,is_required,visibility,editable_by,is_sensitive")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      field: {
        ...data,
        options_json: normalizeOptions((data as any).options_json),
        applies_to_roles: normalizeFieldRoles((data as any).applies_to_roles),
        ...normalizeProfileVisibility((data as any).visible_in_profile, (data as any).editable_in_profile),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ clubId: string; fieldId: string }> }) {
  try {
    const { clubId, fieldId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data: field, error: fieldError } = await supabaseAdmin
      .from("club_player_fields")
      .select("id,legacy_binding")
      .eq("id", fieldId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (fieldError) return NextResponse.json({ error: fieldError.message }, { status: 400 });
    if (!field) return NextResponse.json({ error: "Champ introuvable" }, { status: 404 });
    if (field.legacy_binding) return NextResponse.json({ error: "Ce champ système ne peut pas être supprimé" }, { status: 400 });

    const { error } = await supabaseAdmin.from("club_player_fields").delete().eq("id", fieldId).eq("club_id", clubId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
