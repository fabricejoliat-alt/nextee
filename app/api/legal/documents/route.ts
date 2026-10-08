import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";

export async function GET(req: Request) {
  try {
    const db = legalDb(); const user = await legalActor(req, db);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const memberships = await db.from("club_members").select("club_id,role").eq("user_id", user.id).eq("is_active", true);
    if (memberships.error) throw memberships.error;
    const roles = new Set((memberships.data ?? []).map((m) => m.role));
    const admin = await db.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (admin.error) throw admin.error;
    if (admin.data) roles.add("admin");
    const docs = await db.from("legal_documents").select("id,document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,active")
      .eq("active", true);
    if (docs.error) throw docs.error;
    const eligibleRole = (doc: (typeof docs.data)[number]) => doc.audience_roles.find((role: string) =>
      doc.scope === "platform" ? roles.has(role) : (memberships.data ?? []).some((membership) =>
        membership.club_id === doc.club_id && membership.role === role));
    const visible = (docs.data ?? []).filter((doc) => Boolean(eligibleRole(doc)));
    const ids = visible.map((d) => d.id);
    const clubIds = [...new Set(visible.map((d) => d.club_id).filter((id): id is string => Boolean(id)))];
    const clubs = clubIds.length ? await db.from("organizations").select("id,name,org_type").in("id", clubIds) : { data: [], error: null };
    if (clubs.error) throw clubs.error;
    const clubNames = new Map((clubs.data ?? []).map((club) => [club.id, club.name]));
    const versions = ids.length ? await db.from("legal_versions").select("id,document_id,version_number,published_at,snapshot")
      .in("document_id", ids).order("version_number", { ascending: false }) : { data: [], error: null };
    if (versions.error) throw versions.error;
    const current = new Map<string, (typeof versions.data)[number]>();
    for (const v of versions.data ?? []) if (!current.has(v.document_id)) current.set(v.document_id, v);
    const state = ids.length ? await db.from("legal_current_state").select("document_id,version_id,decision,conflict,club_scope")
      .eq("beneficiary_id", user.id).in("document_id", ids) : { data: [], error: null };
    if (state.error) throw state.error;
    const rewriteIds = visible.filter((d) => d.purpose_key === "coaching.rewrite").map((d) => d.id);
    const ownChoices = rewriteIds.length ? await db.from("legal_decisions").select("document_id,version_id,decision,club_id,decided_at")
      .eq("actor_id", user.id).eq("beneficiary_id", user.id).eq("source", "user_flow").in("document_id", rewriteIds)
      .order("decided_at", { ascending: false }) : { data: [], error: null };
    if (ownChoices.error) throw ownChoices.error;
    return NextResponse.json({ documents: visible.map((d) => ({ ...d, club_name: d.club_id ? clubNames.get(d.club_id) ?? null : null,
      organization_id: d.club_id, organization_name: d.club_id ? clubNames.get(d.club_id) ?? null : null,
      org_type: clubs.data?.find(org => org.id === d.club_id)?.org_type ?? null,
      eligible_role: eligibleRole(d) ?? null, version: current.get(d.id) ?? null,
      own_choice: (ownChoices.data ?? []).find((s) => s.document_id === d.id && s.club_id === d.club_id) ?? null,
      state: (state.data ?? []).find((s) => s.document_id === d.id && s.club_scope === d.club_id) ?? null })) }, { headers: legalNoStore });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: 503, headers: legalNoStore }); }
}
