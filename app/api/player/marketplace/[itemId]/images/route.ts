import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess } from "../../_lib";

import { MARKETPLACE_BUCKET as BUCKET, MARKETPLACE_IMAGE_MAX_BYTES, isMarketplaceImagePath, signMarketplaceImagePaths } from "@/lib/marketplaceStorage";
import { normalizePlayerDocumentMimeType, playerDocumentSignatureMatches } from "@/lib/playerDocumentPolicy";

function safeExtFromFileName(name: string) {
  const ext = (String(name ?? "").split(".").pop() || "jpg").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "") || "jpg";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { itemId: rawItemId } = await ctx.params;
    const itemId = String(rawItemId ?? "").trim();
    if (!itemId) return NextResponse.json({ error: "Missing itemId" }, { status: 400 });

    const form = await req.formData();
    const childId = String(form.get("child_id") ?? "").trim();
    const sortOrder = Number(form.get("sort_order") ?? 0);
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const access = await resolveMarketplaceAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const itemRes = await supabaseAdmin
      .from("marketplace_items")
      .select("id,user_id,club_id")
      .eq("id", itemId)
      .maybeSingle();
    if (itemRes.error) return NextResponse.json({ error: itemRes.error.message }, { status: 400 });
    if (!itemRes.data?.id) return NextResponse.json({ error: "Annonce introuvable." }, { status: 404 });

    const ownerId = String((itemRes.data as { user_id?: string | null }).user_id ?? "").trim();
    const clubId = String((itemRes.data as { club_id?: string | null }).club_id ?? "").trim();
    if (ownerId !== access.effectiveUserId || !clubId || !access.clubIds.includes(clubId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const mimeType = normalizePlayerDocumentMimeType(file.type, file.name);
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || file.size <= 0 || file.size > MARKETPLACE_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: "Image invalide. Formats JPEG, PNG ou WebP, maximum 5 Mo." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!playerDocumentSignatureMatches(mimeType, bytes.subarray(0, 512))) return NextResponse.json({ error: "Contenu de l’image invalide." }, { status: 400 });
    const ext = safeExtFromFileName(file.name);
    const filename = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const path = `${access.effectiveUserId}/${itemId}/${filename}`;
    const uploadRes = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: mimeType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadRes.error) return NextResponse.json({ error: uploadRes.error.message }, { status: 400 });

    const imageRes = await supabaseAdmin
      .from("marketplace_images")
      .insert({
        item_id: itemId,
        path,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      })
      .select("id,item_id,path,sort_order")
      .single();
    if (imageRes.error) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: imageRes.error.message }, { status: 400 });
    }

    const urls = await signMarketplaceImagePaths(supabaseAdmin, [imageRes.data], new Map([[itemId, ownerId]]));
    return NextResponse.json({ image: imageRes.data, publicUrl: urls.get(path) ?? "" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { itemId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const imageId = String(body.image_id ?? "").trim();
    if (!imageId || !itemId) return NextResponse.json({ error: "Missing image" }, { status: 400 });
    const db = createAdminClient();
    const access = await resolveMarketplaceAccess(db, token, String(body.child_id ?? ""), "edit", false);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    const item = await db.from("marketplace_items").select("id,user_id,club_id").eq("id", itemId).maybeSingle();
    if (item.error) return NextResponse.json({ error: item.error.message }, { status: 400 });
    if (!item.data || item.data.user_id !== access.effectiveUserId || !access.clubIds.includes(item.data.club_id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const image = await db.from("marketplace_images").select("id,path").eq("id", imageId).eq("item_id", itemId).maybeSingle();
    if (image.error) return NextResponse.json({ error: image.error.message }, { status: 400 });
    if (!image.data) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    if (!isMarketplaceImagePath(image.data.path, item.data.user_id, itemId)) return NextResponse.json({ error: "Invalid image path" }, { status: 409 });
    const removed = await db.storage.from(BUCKET).remove([image.data.path]);
    if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 502 });
    const deleted = await db.from("marketplace_images").delete().eq("id", imageId).eq("item_id", itemId);
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Unable to remove image" }, { status: 500 }); }
}
