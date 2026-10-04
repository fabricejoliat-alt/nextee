import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
export async function GET(req: Request) {
  try {
  const db = legalDb(); const actor = await legalActor(req, db);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
  const links = await db.from("legal_representative_assertions").select("child_id,club_id,status")
    .eq("guardian_id", actor.id).eq("status", "verified");
  if (links.error) return NextResponse.json({ error: links.error.message }, { status: 503, headers: legalNoStore });
  const checked = await Promise.all((links.data ?? []).map(async (link) => {
    const result = await db.rpc("legal_actor_allowed", { p_actor: actor.id, p_beneficiary: link.child_id,
      p_club: link.club_id, p_role: "parent" });
    if (result.error) throw result.error;
    return result.data ? link : null;
  }));
  return NextResponse.json({ children: checked.filter(Boolean) }, { headers: legalNoStore });
  } catch {
    return NextResponse.json({ error: "Children unavailable" }, { status: 503, headers: legalNoStore });
  }
}
