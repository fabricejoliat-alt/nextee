import { legalActor, legalAdmin, legalDb } from "@/lib/server/legalAccess";
import { marketplaceUuid } from "@/lib/server/marketplaceSafety";

export async function marketplaceModerator(req: Request) {
  const db = legalDb();
  const actor = await legalActor(req, db);
  if (!actor) return null;
  const admin = await legalAdmin(req, db);
  const clubs = admin
    ? await db.from("organizations").select("id,name").eq("is_active", true)
    : await db.from("organization_members").select("organization_id,organizations!inner(id,name)")
      .eq("user_id", actor.id).eq("role", "manager").eq("is_active", true);
  if (clubs.error) throw clubs.error;
  const rows = (clubs.data ?? []).map(row => {
    const raw = row as unknown as { id?: string; name?: string; organization_id?: string; organizations?: { id: string; name: string } };
    return { id: raw.id ?? raw.organization_id ?? "", name: raw.name ?? raw.organizations?.name ?? "" };
  }).filter(row => marketplaceUuid(row.id));
  if (!admin && !rows.length) return null;
  const requested = new URL(req.url).searchParams.get("club_id");
  if (requested && !rows.some(row => row.id === requested)) return null;
  return { db, actor, clubs: rows, clubIds: requested ? [requested] : rows.map(row => row.id) };
}
