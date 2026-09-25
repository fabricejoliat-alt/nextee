import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

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

function normalizePlayerFieldToken(raw: unknown) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isSionSpecificPlayerField(row: { field_key?: unknown; label?: unknown; legacy_binding?: unknown }) {
  if (
    row.legacy_binding === "player_course_track" ||
    row.legacy_binding === "player_membership_paid" ||
    row.legacy_binding === "player_playing_right_paid"
  ) {
    return true;
  }

  const labelToken = normalizePlayerFieldToken(row.label).replace(/_/g, " ");
  if (labelToken === "cours" || labelToken === "cotisation" || labelToken === "droit de jeu") {
    return true;
  }

  const fieldKey = normalizePlayerFieldToken(row.field_key);
  return (
    fieldKey === "legacy_course_track" ||
    fieldKey === "legacy_membership_paid" ||
    fieldKey === "legacy_playing_right_paid" ||
    fieldKey.startsWith("cours_") ||
    fieldKey.startsWith("cotisation_") ||
    fieldKey.startsWith("droit_de_jeu_")
  );
}

function toFieldPayload(body: any) {
  const label = String(body?.label ?? "").trim();
  const fieldType = String(body?.field_type ?? "").trim().toLowerCase();
  const options = normalizeOptions(body?.options);
  const isActive = body?.is_active == null ? true : Boolean(body.is_active);
  const sortOrder = Number(body?.sort_order ?? 0);
  const appliesToRoles = normalizeFieldRoles(body?.applies_to_roles);
  const profileVisibility = normalizeRoleProfilePermissions(body);

  if (!label) throw new Error("Label manquant");
  const scope = body?.scope === "season" ? "season" : "permanent";
  const description = String(body?.description ?? "").trim() || null;
  const isRequired = Boolean(body?.is_required);
  const visibility = ["manager", "staff", "player", "restricted"].includes(String(body?.visibility)) ? String(body.visibility) : "manager";
  const editableBy = ["manager", "staff", "player", "none"].includes(String(body?.editable_by)) ? String(body.editable_by) : "manager";
  const isSensitive = Boolean(body?.is_sensitive);
  if (!["text", "short_text", "long_text", "number", "date", "select", "radio", "checkbox", "boolean"].includes(fieldType)) throw new Error("Type invalide");
  if (["select", "radio", "checkbox"].includes(fieldType) && options.length === 0) throw new Error("Les options sont requises");
  if (isSensitive && visibility !== "restricted") throw new Error("Un champ sensible doit être restreint");

  return {
    label,
    field_type: fieldType,
    options_json: ["select", "radio", "checkbox"].includes(fieldType) ? options : [],
    is_active: isActive,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    applies_to_roles: appliesToRoles,
    ...profileVisibility,
    scope, description, is_required: isRequired, visibility, editable_by: editableBy, is_sensitive: isSensitive,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data, error } = await supabaseAdmin
      .from("club_player_fields")
      .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,applies_to_roles,visible_in_profile,editable_in_profile,visible_to_player,editable_by_player,visible_to_coach,editable_by_coach,legacy_binding,scope,description,is_required,visibility,editable_by,is_sensitive")
      .eq("club_id", clubId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      playerFields: (data ?? [])
        .map((row: any) => ({
          ...row,
          options_json: normalizeOptions(row.options_json),
          applies_to_roles: normalizeFieldRoles(row.applies_to_roles),
          ...normalizeProfileVisibility(row.visible_in_profile, row.editable_in_profile),
        }))
        .filter((row: any) => Boolean(row.is_active) || !isSionSpecificPlayerField(row)),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const payload = toFieldPayload(body);
    const baseKey = String(body?.field_key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const fieldKey = `${baseKey || "field"}_${randomUUID().slice(0, 8)}`;

    const { data, error } = await supabaseAdmin
      .from("club_player_fields")
      .insert({
        club_id: clubId,
        field_key: fieldKey,
        ...payload,
      })
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
