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
  if (adminRow) return { ok: true as const };

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
  return { ok: true as const };
}

async function readConfig(supabaseAdmin: any, clubId: string) {
  const { data: club, error: clubError } = await supabaseAdmin.from("clubs").select("id,name").eq("id", clubId).maybeSingle();
  if (clubError) throw clubError;
  if (!club) throw new Error("Club introuvable");

  const { data: config, error: configError } = await supabaseAdmin
    .from("club_parent_intake_configs")
    .select("club_id,public_token,is_enabled,title,subtitle,intro_text,recipient_email,success_message")
    .eq("club_id", clubId)
    .maybeSingle();
  if (configError) throw configError;

  return {
    club_id: clubId,
    club_name: String((club as any).name ?? "Club"),
    public_token: config?.public_token ?? null,
    is_enabled: config?.is_enabled ?? false,
    title: config?.title ?? "Activation des comptes parents",
    subtitle: config?.subtitle ?? "Section Junior",
    intro_text:
      config?.intro_text ??
      "Nous vous remercions de bien vouloir compléter le formulaire ci-dessous. Les informations recueillies permettront de créer les comptes parents et de les associer aux joueurs juniors inscrits dans la section junior. En cas de questions, merci de les adresser à info@activitee.golf",
    recipient_email: config?.recipient_email ?? "info@activitee.golf",
    success_message: config?.success_message ?? "Merci, votre formulaire a bien été envoyé.",
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json({ config: await readConfig(supabaseAdmin, clubId) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const patch = {
      club_id: clubId,
      is_enabled: body?.is_enabled == null ? true : Boolean(body.is_enabled),
      title: String(body?.title ?? "").trim() || "Activation des comptes parents",
      subtitle: String(body?.subtitle ?? "").trim() || null,
      intro_text: String(body?.intro_text ?? "").trim(),
      recipient_email: String(body?.recipient_email ?? "").trim().toLowerCase() || "info@activitee.golf",
      success_message: String(body?.success_message ?? "").trim() || "Merci, votre formulaire a bien été envoyé.",
    };

    const { error } = await supabaseAdmin
      .from("club_parent_intake_configs")
      .upsert(patch, { onConflict: "club_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ config: await readConfig(supabaseAdmin, clubId) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
