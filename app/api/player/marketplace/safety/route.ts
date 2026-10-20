import { createAdminClient, resolveMarketplaceAccess } from "../_lib";
import { marketplaceReportReasons, marketplaceSafetyContext, marketplaceSafetyHeaders, marketplaceUuid } from "@/lib/server/marketplaceSafety";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: marketplaceSafetyHeaders });

export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return reply({ error: "Session invalide." }, 401);
    const db = createAdminClient();
    const access = await resolveMarketplaceAccess(db, token, new URL(req.url).searchParams.get("child_id") ?? "", "view", false);
    if ("error" in access) return reply({ error: access.error }, access.status);
    const blocks = await db.from("marketplace_blocks").select("blocked_id,created_at")
      .eq("blocker_id", access.effectiveUserId).order("created_at", { ascending: false });
    if (blocks.error) throw blocks.error;
    const ids = (blocks.data ?? []).map(row => row.blocked_id);
    const profiles = ids.length ? await db.from("profiles").select("id,first_name,last_name").in("id", ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    return reply({ blocks: (blocks.data ?? []).map(row => {
      const profile = (profiles.data ?? []).find(profile => profile.id === row.blocked_id);
      return { ...row, name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") };
    }) });
  } catch { return reply({ error: "Protection Marketplace indisponible." }, 503); }
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return reply({ error: "Session invalide." }, 401);
    const raw = await req.text();
    if (raw.length > 8000) return reply({ error: "Demande trop longue." }, 413);
    const input = JSON.parse(raw);
    const db = createAdminClient();
    const access = await resolveMarketplaceAccess(db, token, String(input.child_id ?? ""), "edit", false);
    if ("error" in access) return reply({ error: access.error }, access.status);
    if (input.action === "unblock" && marketplaceUuid(input.user_id)) {
      const result = await db.from("marketplace_blocks").delete().eq("blocker_id", access.effectiveUserId).eq("blocked_id", input.user_id);
      if (result.error) throw result.error;
      return reply({ ok: true });
    }
    if (!["report", "block"].includes(input.action)) return reply({ error: "Demande invalide." }, 400);
    let subjectId: string, clubId: string, itemId: string | null = null, messageId: string | null = null;
    if (marketplaceUuid(input.message_id)) {
      const message = await db.from("marketplace_contact_messages").select("id,club_id,sender_id,recipient_id")
        .eq("id", input.message_id).eq("recipient_id", access.effectiveUserId).in("club_id", access.clubIds).maybeSingle();
      if (message.error) throw message.error;
      if (!message.data || message.data.sender_id === access.viewerUserId) return reply({ error: "Message introuvable." }, 404);
      subjectId = message.data.sender_id; clubId = message.data.club_id; messageId = message.data.id;
    } else if (marketplaceUuid(input.item_id)) {
      const item = await db.from("marketplace_items").select("id,club_id,user_id,is_active,moderation_status").eq("id", input.item_id).maybeSingle();
      if (item.error) throw item.error;
      if (!item.data || !access.clubIds.includes(item.data.club_id) || item.data.user_id === access.effectiveUserId) return reply({ error: "Annonce introuvable." }, 404);
      const safety = await marketplaceSafetyContext(db, access);
      if (!safety.visible(item.data)) return reply({ error: "Annonce indisponible." }, 404);
      subjectId = item.data.user_id; clubId = item.data.club_id; itemId = item.data.id;
    } else return reply({ error: "Demande invalide." }, 400);
    if (input.action === "block") {
      const result = await db.from("marketplace_blocks").upsert({
        blocker_id: access.effectiveUserId, blocked_id: subjectId, created_by: access.viewerUserId,
      }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
      if (result.error) throw result.error;
    } else {
      if (!marketplaceReportReasons.includes(input.reason) || typeof input.details !== "string" || input.details.length > 2000) {
        return reply({ error: "Motif invalide." }, 400);
      }
      // Count is persistent across server instances; repeated reports for an item are idempotent.
      const recent = await db.from("marketplace_reports").select("id", { count: "exact", head: true })
        .eq("reporter_id", access.viewerUserId).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
      if (recent.error) throw recent.error;
      if ((recent.count ?? 0) >= 10) return reply({ error: "Trop de signalements. Réessayez plus tard." }, 429);
      const result = await db.from("marketplace_reports").insert({
        item_id: itemId, message_id: messageId, club_id: clubId, reporter_id: access.viewerUserId,
        subject_id: subjectId, reason: input.reason, details: input.details.trim(),
      });
      if (result.error && result.error.code !== "23505") throw result.error;
    }
    return reply({ ok: true });
  } catch { return reply({ error: "Action non confirmée. Réessayez." }, 503); }
}
