import { NextResponse } from "next/server";
import { legalActor, legalDb } from "@/lib/server/legalAccess";
import { adminNoStore, verifiedAdminAssurance } from "@/lib/server/adminSecurity";

/** Bootstrap exposes assurance only; aal1 may enroll a factor, never read Admin data. */
export async function GET(req: Request) {
  try {
    const db = legalDb();
    const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: adminNoStore });
    const admin = await db.from("app_admins").select("user_id").eq("user_id", actor.id).maybeSingle();
    if (admin.error) throw admin.error;
    if (!admin.data) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: adminNoStore });
    const token = req.headers.get("authorization")!.replace(/^Bearer\s+/i, "").trim();
    const assurance = await verifiedAdminAssurance(db, token, actor.id);
    return NextResponse.json(assurance, { headers: adminNoStore });
  } catch { return NextResponse.json({ error: "Verification unavailable" }, { status: 503, headers: adminNoStore }); }
}
