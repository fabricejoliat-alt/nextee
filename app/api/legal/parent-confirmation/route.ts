import { createHash, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { sendLegalParentCode } from "@/lib/server/legalParentMail";

export async function POST(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const input = await req.json();
    const presentationId = String(input.presentation_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(presentationId)) {
      return NextResponse.json({ error: "Presentation unavailable" }, { status: 400, headers: legalNoStore });
    }
    const auth = await db.auth.admin.getUserById(actor.id);
    const email = auth.data.user?.email?.trim().toLowerCase();
    if (auth.error || !email || !auth.data.user?.email_confirmed_at || email.endsWith("@noemail.local")) {
      return NextResponse.json({ error: "Verified parent email required; contact support" }, { status: 409, headers: legalNoStore });
    }
    if (process.env.LEGAL_PARENT_MAIL_ENABLED !== "true" || !process.env.BREVO_API_KEY) return NextResponse.json({ error: "Confirmation delivery disabled" }, { status: 503, headers: legalNoStore });
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const secretHash = createHash("sha256").update(code).digest("hex");
    const emailHash = createHash("sha256").update(email).digest("hex");
    const issued = await db.rpc("issue_legal_parent_challenge", { p_presentation: presentationId,
      p_actor: actor.id, p_email_hash: emailHash, p_secret_hash: secretHash });
    if (issued.error) {
      const limited = issued.error.message.includes("Challenge rate limited");
      return NextResponse.json({ error: limited ? "Wait before retrying" : issued.error.message },
        { status: limited ? 429 : 409, headers: legalNoStore });
    }
    const delivered = await sendLegalParentCode({ email, code, apiKey: process.env.BREVO_API_KEY!,
      from: process.env.LEGAL_MAIL_FROM ?? "noreply@activitee.golf" }).catch(() => false);
    if (!delivered) {
      await db.from("legal_parent_challenges").update({ used_at: new Date().toISOString() })
        .eq("id", issued.data).eq("actor_id", actor.id).is("used_at", null);
      return NextResponse.json({ error: "Confirmation delivery failed" }, { status: 503, headers: legalNoStore });
    }
    return NextResponse.json({ sent: true }, { headers: legalNoStore });
  } catch { return NextResponse.json({ error: "Confirmation unavailable" }, { status: 503, headers: legalNoStore }); }
}
