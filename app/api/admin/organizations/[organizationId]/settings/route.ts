import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function ensureAdmin(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: "Missing token", status: 401 } as const;
  const client = adminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: "Invalid token", status: 401 } as const;
  const { data: admin } = await client.from("app_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!admin) return { error: "Forbidden", status: 403 } as const;
  return { client, userId: data.user.id } as const;
}

export async function GET(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const access = await ensureAdmin(req);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { organizationId } = await params;
  const [organizationRes, settingsRes, profilesRes] = await Promise.all([
    access.client.from("organizations").select("id,name,slug,org_type,is_active,country_code,region_code").eq("id", organizationId).maybeSingle(),
    access.client.from("organization_settings").select("settings").eq("organization_id", organizationId).maybeSingle(),
    access.client.from("profiles").select("id,first_name,last_name,username").order("last_name"),
  ]);
  if (organizationRes.error) return NextResponse.json({ error: organizationRes.error.message }, { status: 400 });
  if (!organizationRes.data) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  if (settingsRes.error && settingsRes.error.code !== "PGRST116") return NextResponse.json({ error: settingsRes.error.message }, { status: 400 });
  if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
  return NextResponse.json({ organization: organizationRes.data, settings: settingsRes.data?.settings ?? {}, profiles: profilesRes.data ?? [] });
}

export async function PUT(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const access = await ensureAdmin(req);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { organizationId } = await params;
  const body = await req.json().catch(() => null) as { organization?: Record<string, unknown>; settings?: Record<string, unknown> } | null;
  if (!body || !body.organization || !body.settings) return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  const name = String(body.organization.name ?? "").trim();
  const slug = String(body.organization.slug ?? "").trim();
  if (!name || !slug) return NextResponse.json({ error: "Le nom et l’identifiant sont obligatoires." }, { status: 400 });
  const orgType = String(body.organization.org_type ?? "club");
  if (!['club', 'academy', 'federation'].includes(orgType)) return NextResponse.json({ error: "Type d’organisation invalide." }, { status: 400 });
  const orgPayload = { name, slug, org_type: orgType, is_active: Boolean(body.organization.is_active), country_code: String(body.organization.country_code ?? "").trim() || null, region_code: String(body.organization.region_code ?? "").trim() || null };
  const organizationRes = await access.client.from("organizations").update(orgPayload).eq("id", organizationId);
  if (organizationRes.error) return NextResponse.json({ error: organizationRes.error.message }, { status: 400 });
  const settingsRes = await access.client.from("organization_settings").upsert({ organization_id: organizationId, settings: body.settings, updated_at: new Date().toISOString(), updated_by: access.userId }, { onConflict: "organization_id" });
  if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const access = await ensureAdmin(req);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { organizationId } = await params;
  const { data: organization, error: lookupError } = await access.client.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 400 });
  if (!organization) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });

  // Legacy data uses clubs while the current administration uses organizations.
  // Remove dependent legacy records first, then both organization representations.
  const coachPlayers = await access.client.from("coach_players").delete().eq("club_id", organizationId);
  if (coachPlayers.error && !coachPlayers.error.message.toLowerCase().includes("does not exist")) return NextResponse.json({ error: coachPlayers.error.message }, { status: 400 });
  const members = await access.client.from("club_members").delete().eq("club_id", organizationId);
  if (members.error) return NextResponse.json({ error: members.error.message }, { status: 400 });
  const deleteOrganization = await access.client.from("organizations").delete().eq("id", organizationId);
  if (deleteOrganization.error) return NextResponse.json({ error: deleteOrganization.error.message }, { status: 400 });
  const deleteClub = await access.client.from("clubs").delete().eq("id", organizationId);
  if (deleteClub.error) return NextResponse.json({ error: deleteClub.error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
