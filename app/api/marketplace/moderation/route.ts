import { marketplaceModerator } from "@/lib/server/marketplaceModeration";
import { marketplaceSafetyHeaders, marketplaceUuid } from "@/lib/server/marketplaceSafety";
import { signMarketplaceImagePaths } from "@/lib/marketplaceStorage";
import { withAdminMutationAudit } from "@/lib/server/adminAudit";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: marketplaceSafetyHeaders });

export async function GET(req: Request) {
  try {
    const access = await marketplaceModerator(req);
    if (!access) return reply({ error: "Accès refusé." }, 403);
    const { db, clubIds } = access;
    if (new URL(req.url).searchParams.get("view") === "count") {
      const [pending, reports] = await Promise.all([
        db.from("marketplace_items").select("id", { count: "exact", head: true }).in("club_id", clubIds).eq("moderation_status", "pending").eq("is_active", true),
        db.from("marketplace_reports").select("id", { count: "exact", head: true }).in("club_id", clubIds).eq("status", "open"),
      ]);
      if (pending.error || reports.error) throw pending.error ?? reports.error;
      return reply({ pending: pending.count ?? 0, reports: reports.count ?? 0 });
    }
    const requested = new URL(req.url).searchParams.get("status") ?? "pending";
    const status = ["pending", "approved", "rejected"].includes(requested) ? requested : "pending";
    const [items, reports, suspensions] = await Promise.all([
      db.from("marketplace_items").select("*").in("club_id", clubIds).eq("moderation_status", status)
        .order("created_at", { ascending: true }).limit(100),
      db.from("marketplace_reports").select("*").in("club_id", clubIds).eq("status", "open")
        .order("created_at", { ascending: true }).limit(100),
      db.from("marketplace_suspensions").select("*").in("club_id", clubIds),
    ]);
    if (items.error || reports.error || suspensions.error) throw items.error ?? reports.error ?? suspensions.error;
    const messageIds = [...new Set((reports.data ?? []).flatMap(row => row.message_id ? [row.message_id] : []))];
    const messages = messageIds.length ? await db.from("marketplace_contact_messages").select("id,subject,message,reply_email,club_id")
      .in("id", messageIds).in("club_id", clubIds) : { data: [], error: null };
    if (messages.error) throw messages.error;
    const reportedIds = [...new Set((reports.data ?? []).flatMap(row => row.item_id ? [row.item_id] : []))];
    const reported = reportedIds.length ? await db.from("marketplace_items").select("*").in("id", reportedIds).in("club_id", clubIds) : { data: [], error: null };
    if (reported.error) throw reported.error;
    const all = [...new Map([...(items.data ?? []), ...(reported.data ?? [])].map(row => [row.id, row])).values()];
    const images = all.length ? await db.from("marketplace_images").select("item_id,path,sort_order")
      .in("item_id", all.map(row => row.id)).order("sort_order") : { data: [], error: null };
    if (images.error) throw images.error;
    const urls = await signMarketplaceImagePaths(db, images.data ?? [], new Map(all.map(row => [row.id, row.user_id])));
    const userIds = [...new Set([...all.map(row => row.user_id), ...(suspensions.data ?? []).map(row => row.user_id)])];
    const profiles = userIds.length ? await db.from("profiles").select("id,first_name,last_name").in("id", userIds) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const names = new Map((profiles.data ?? []).map(row => [row.id, [row.first_name, row.last_name].filter(Boolean).join(" ")]));
    return reply({
      clubs: access.clubs, items: all.map(row => ({ ...row, owner_name: names.get(row.user_id) ?? "",
        images: (images.data ?? []).filter(image => image.item_id === row.id).map(image => urls.get(image.path)).filter(Boolean),
      })), reports: reports.data, messages: messages.data, suspensions: (suspensions.data ?? []).map(row => ({ ...row, name: names.get(row.user_id) ?? "" })),
    });
  } catch { return reply({ error: "Modération indisponible." }, 503); }
}

export const POST = withAdminMutationAudit(async (req: Request) => {
  try {
    const access = await marketplaceModerator(req);
    if (!access) return reply({ error: "Accès refusé." }, 403);
    const raw = await req.text();
    if (raw.length > 8000) return reply({ error: "Demande trop longue." }, 413);
    const input = JSON.parse(raw);
    const { db, actor, clubIds } = access;
    if (input.action === "resolve" && marketplaceUuid(input.report_id)) {
      const result = await db.from("marketplace_reports").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: actor.id })
        .eq("id", input.report_id).in("club_id", clubIds).select("id");
      if (result.error) throw result.error;
      return result.data?.length ? reply({ ok: true }) : reply({ error: "Signalement introuvable." }, 404);
    }
    if (input.action === "unsuspend" && marketplaceUuid(input.user_id) && clubIds.includes(input.club_id)) {
      const result = await db.from("marketplace_suspensions").delete().eq("user_id", input.user_id).eq("club_id", input.club_id);
      if (result.error) throw result.error;
      return reply({ ok: true });
    }
    if (input.action === "suspend" && marketplaceUuid(input.message_id)) {
      const message = await db.from("marketplace_contact_messages").select("sender_id,club_id").eq("id", input.message_id).in("club_id", clubIds).maybeSingle();
      if (message.error) throw message.error;
      if (!message.data) return reply({ error: "Message introuvable." }, 404);
      const note = String(input.note ?? "").trim();
      if (note.length < 3 || note.length > 2000) return reply({ error: "Précisez le motif de la suspension." }, 400);
      const result = await db.from("marketplace_suspensions").upsert({
        user_id: message.data.sender_id, club_id: message.data.club_id, reason: note, created_by: actor.id,
      }, { onConflict: "user_id,club_id" });
      if (result.error) throw result.error;
      return reply({ ok: true });
    }
    if (!marketplaceUuid(input.item_id)) return reply({ error: "Annonce invalide." }, 400);
    const item = await db.from("marketplace_items").select("id,user_id,club_id,moderation_revision").eq("id", input.item_id).in("club_id", clubIds).maybeSingle();
    if (item.error) throw item.error;
    if (!item.data) return reply({ error: "Annonce introuvable." }, 404);
    const note = String(input.note ?? "").trim();
    if (note.length > 2000) return reply({ error: "Motif trop long." }, 400);
    if (input.action === "suspend") {
      if (note.length < 3) return reply({ error: "Précisez le motif de la suspension." }, 400);
      const result = await db.from("marketplace_suspensions").upsert({
        user_id: item.data.user_id, club_id: item.data.club_id, reason: note, created_by: actor.id,
      }, { onConflict: "user_id,club_id" });
      if (result.error) throw result.error;
      return reply({ ok: true });
    }
    if (!["approve", "reject"].includes(input.action) || !Number.isInteger(input.revision)) return reply({ error: "Décision invalide." }, 400);
    const result = await db.rpc("moderate_marketplace_item", {
      p_actor: actor.id, p_item: input.item_id, p_revision: input.revision, p_action: input.action, p_note: note,
    });
    if (result.error) return reply({ error: result.error.code === "40001"
      ? "L’annonce a changé. Actualisez et vérifiez à nouveau le texte et les photos."
      : "Décision impossible. Vérifiez le motif et les éventuelles suspensions." }, 409);
    return reply({ ok: true });
  } catch { return reply({ error: "Action non confirmée." }, 503); }
});
