import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess, uniq } from "../_lib";

const BUCKET = "marketplace";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolveMarketplaceAccess(supabaseAdmin, accessToken, childId, "view");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const itemsRes = access.clubIds.length
      ? await supabaseAdmin
          .from("marketplace_items")
          .select("id,created_at,club_id,user_id,title,description,price,is_free,is_active,category,condition,brand,model,delivery")
          .in("club_id", access.clubIds)
          .eq("user_id", access.effectiveUserId)
          .order("created_at", { ascending: false })
      : ({ data: [], error: null } as const);
    if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 400 });

    const items = itemsRes.data ?? [];
    const itemIds = uniq((items as Array<{ id?: string | null }>).map((row) => row.id));
    const imagesRes = itemIds.length
      ? await supabaseAdmin.from("marketplace_images").select("item_id,path,sort_order").in("item_id", itemIds).eq("sort_order", 0)
      : ({ data: [], error: null } as const);
    if (imagesRes.error) return NextResponse.json({ error: imagesRes.error.message }, { status: 400 });

    const mainImageByItemId: Record<string, string> = {};
    (imagesRes.data ?? []).forEach((row: any) => {
      const itemId = String(row.item_id ?? "").trim();
      const path = String(row.path ?? "").trim();
      if (!itemId || !path) return;
      mainImageByItemId[itemId] = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    });

    return NextResponse.json({
      viewerUserId: access.viewerUserId,
      effectiveUserId: access.effectiveUserId,
      preferredClubId: access.preferredClubId,
      items,
      mainImageByItemId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

