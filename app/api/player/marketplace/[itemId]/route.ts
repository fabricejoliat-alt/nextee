import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess } from "../_lib";

const BUCKET = "marketplace";

export async function GET(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { itemId: rawItemId } = await ctx.params;
    const itemId = String(rawItemId ?? "").trim();
    if (!itemId) return NextResponse.json({ error: "Missing itemId" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolveMarketplaceAccess(supabaseAdmin, accessToken, childId, "view");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const itemRes = await supabaseAdmin
      .from("marketplace_items")
      .select("id,title,description,created_at,club_id,is_active,category,condition,brand,model,price,is_free,contact_email,contact_phone,user_id")
      .eq("id", itemId)
      .maybeSingle();
    if (itemRes.error) return NextResponse.json({ error: itemRes.error.message }, { status: 400 });
    if (!itemRes.data) return NextResponse.json({ error: "Annonce introuvable." }, { status: 404 });

    const item = itemRes.data as { club_id: string | null; user_id: string | null };
    const clubId = String(item.club_id ?? "").trim();
    const ownerId = String(item.user_id ?? "").trim();
    if (!clubId || (!access.clubIds.includes(clubId) && ownerId !== access.effectiveUserId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const imgRes = await supabaseAdmin
      .from("marketplace_images")
      .select("path,sort_order")
      .eq("item_id", itemId)
      .order("sort_order", { ascending: true });
    if (imgRes.error) return NextResponse.json({ error: imgRes.error.message }, { status: 400 });

    const images = (imgRes.data ?? [])
      .map((row: any) => String(row.path ?? "").trim())
      .filter(Boolean)
      .map((path) => supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);

    return NextResponse.json({
      item: itemRes.data,
      images,
      isMine: ownerId === access.effectiveUserId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
