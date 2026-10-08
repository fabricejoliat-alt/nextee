import { randomBytes, randomUUID } from "node:crypto";
import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(req: Request, ctx: Context) {
  try {
    const { organizationId } = await ctx.params, access = await organizationActor(req, organizationId);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const matches = await access.db.from("organization_identity_matches").select("id,status,subject_role,player_id,player:profiles!organization_identity_matches_player_id_fkey(id,first_name,last_name)")
      .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(50);
    if (matches.error) throw matches.error;
    return organizationReply({ matches: (matches.data ?? []).map(row => row.status === "approved" || row.status === "used"
      ? row : { id: row.id, status: row.status }) });
  } catch (error) { return organizationFailure(error); }
}
export async function POST(req: Request, ctx: Context) {
  try {
    const { organizationId } = await ctx.params, access = await organizationActor(req, organizationId);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const input = await req.json();
    if (input.action === "identity") {
      const result = await access.db.rpc("request_organization_identity_checked", { p_actor: access.actor.id, p_org: organizationId, p_username: input.username, p_kind: input.subject_role ?? "player" });
      if (result.error) throw result.error;
      return organizationReply({ id: result.data, status: "pending" });
    }
    if (input.action === "reference") {
      const result = await access.db.rpc("create_external_reference_checked", { p_actor: access.actor.id, p_org: organizationId,
        p_name: input.name, p_country: input.country_code ?? "CH", p_region: input.region_code ?? "" });
      if (result.error) throw result.error;
      return organizationReply({ id: result.data });
    }
    if (input.action === "provision_guardian") {
      const parent=input.parent as {first_name?:string;last_name?:string;email?:string};
      if(!parent?.first_name?.trim()||!parent.last_name?.trim()||!/^\S+@\S+\.\S+$/.test(parent.email??"")||!["father","mother","legal_guardian"].includes(input.relation))
        return organizationReply({error:"organization.invalidInput"},400);
      const entry=await access.db.from("academy_roster_entries").select("academy_id").eq("id",input.entry_id).single();
      if(entry.error||entry.data.academy_id!==organizationId)return organizationReply({error:"Forbidden"},403);
      const profile={first_name:parent.first_name.trim(),last_name:parent.last_name.trim(),username:`parent.${randomUUID().slice(0,8)}`};
      const created=await access.db.auth.admin.createUser({email:parent.email!.trim().toLowerCase(),password:randomBytes(32).toString("base64url"),email_confirm:false,user_metadata:profile});
      if(created.error||!created.data.user)return organizationReply({error:"organization.parentIdentityReviewRequired"},409);
      const guardianId=created.data.user.id;
      const linked=await access.db.rpc("provision_academy_guardian_checked",{p_actor:access.actor.id,p_entry:input.entry_id,p_guardian:guardianId,p_profile:profile,p_relation:input.relation});
      if(linked.error){
        const member=await access.db.from("organization_members").select("user_id").eq("user_id",guardianId).limit(1);
        if(!member.error&&!member.data?.length)await access.db.auth.admin.deleteUser(guardianId);
        throw linked.error;
      }
      return organizationReply({ok:true},201);
    }
    if (input.action === "attach_guardian") {
      const entry = await access.db.from("academy_roster_entries").select("academy_id").eq("id", input.entry_id).single();
      if (entry.error || entry.data.academy_id !== organizationId) return organizationReply({ error: "Forbidden" }, 403);
      const result = await access.db.rpc("attach_academy_guardian_checked", { p_actor: access.actor.id,
        p_entry: input.entry_id, p_guardian: input.guardian_id, p_relation: input.relation });
      if (result.error) throw result.error;
      return organizationReply({ ok: true });
    }
    if (input.action !== "provision") return organizationReply({ error: "organization.invalidInput" }, 400);
    const player = input.player as { first_name?: string; last_name?: string; birth_date?: string };
    const parent = input.parent as { first_name?: string; last_name?: string; email?: string };
    if (!player?.first_name?.trim() || !player.last_name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(player.birth_date ?? "")
      || (!input.guardian_id && (!parent?.first_name?.trim() || !parent.last_name?.trim() || !/^\S+@\S+\.\S+$/.test(parent.email ?? "")))
      || !["father","mother","legal_guardian"].includes(input.relation)) return organizationReply({ error: "organization.invalidInput" }, 400);
    // A possible name/date match triggers human review, never automatic reuse.
    const existing = await access.db.from("profiles").select("id").ilike("first_name", player.first_name.trim())
      .ilike("last_name", player.last_name.trim()).eq("birth_date", player.birth_date!).limit(1);
    if (existing.error) throw existing.error;
    if (existing.data?.length) return organizationReply({ error: "organization.identityReviewRequired" }, 409);
    const createdIds: string[] = [];
    let playerId: string = randomUUID();
    let guardianId = input.guardian_id ?? randomUUID();
    const playerProfile = { ...player, username: `junior.${playerId.slice(0,8)}` };
    const guardianProfile = { first_name: parent?.first_name, last_name: parent?.last_name, username: `parent.${guardianId.slice(0,8)}` };
    try {
      // Supabase Auth rejects a duplicate parent email; existing parents are handled
      // through a human-reviewed match and are never given another account.
      if (input.guardian_id) {
        const match = await access.db.from("organization_identity_matches").select("id")
          .eq("organization_id", organizationId).eq("player_id", guardianId).in("status", ["approved","used"]).eq("subject_role","parent").maybeSingle();
        if (match.error || !match.data) return organizationReply({ error: "organization.parentIdentityReviewRequired" }, 409);
      } else {
        const guardian = await access.db.auth.admin.createUser({ email: parent.email!.trim().toLowerCase(),
          password: randomBytes(32).toString("base64url"), email_confirm: false, user_metadata: guardianProfile });
        if (guardian.error || !guardian.data.user) return organizationReply({ error: "organization.parentIdentityReviewRequired" }, 409);
        guardianId = guardian.data.user.id;
        createdIds.push(guardianId);
      }
      const junior = await access.db.auth.admin.createUser({ email: `${playerId}@noemail.local`,
        password: randomBytes(32).toString("base64url"), email_confirm: false, user_metadata: playerProfile });
      if (junior.error) throw junior.error;
      if (!junior.data.user) throw new Error("Auth identity unavailable");
      playerId = junior.data.user.id;
      createdIds.push(playerId);
      const linked = await access.db.rpc("provision_academy_family_checked", { p_actor: access.actor.id, p_academy: organizationId,
        p_player: playerId, p_player_profile: playerProfile, p_guardian: guardianId, p_guardian_profile: guardianProfile,
        p_relation: input.relation, p_external: input.external_club_reference_id ?? null });
      if (linked.error) throw linked.error;
      return organizationReply({ id: linked.data, username: playerProfile.username, guardian_username: input.guardian_id ? undefined : guardianProfile.username }, 201);
    } catch (error) {
      // Never remove a committed or ambiguously committed affiliation.
      for (const id of createdIds.reverse()) {
        const member = await access.db.from("organization_members").select("user_id").eq("user_id", id).limit(1);
        if (!member.error && !member.data?.length) await access.db.auth.admin.deleteUser(id);
      }
      throw error;
    }
  } catch (error) { return organizationFailure(error); }
}
