import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess } from "../../_lib";

const BUCKET = "marketplace";

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

    const ext = safeExtFromFileName(file.name);
    const filename = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const path = `${access.effectiveUserId}/${itemId}/${filename}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const uploadRes = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "image/jpeg",
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

    return NextResponse.json({
      image: imageRes.data,
      publicUrl: supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
