import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { legalChildren } from "@/lib/server/legalChildren";

export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const [children, control] = await Promise.all([
      legalChildren(db, actor.id), db.from("legal_parent_code_control").select("required").eq("singleton", true).single(),
    ]);
    return NextResponse.json({ children,
      parent_confirmation: { email_ready: Boolean(actor.email_confirmed_at && actor.email && !actor.email.endsWith("@noemail.local")),
        delivery_ready: process.env.LEGAL_PARENT_MAIL_ENABLED === "true" && Boolean(process.env.BREVO_API_KEY),
        code_required: control.error ? true : control.data.required !== false } }, { headers: legalNoStore });
  } catch {
    return NextResponse.json({ error: "Children unavailable" }, { status: 503, headers: legalNoStore });
  }
}
