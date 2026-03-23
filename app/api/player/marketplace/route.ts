import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess, uniq } from "./_lib";

const BUCKET = "marketplace";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolveMarketplaceAccess(supabaseAdmin, accessToken, childId, "view");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    if (access.clubIds.length === 0) {
      return NextResponse.json({
        viewerUserId: access.viewerUserId,
        effectiveUserId: access.effectiveUserId,
        items: [],
        profilesById: {},
        mainImageByItemId: {},
      });
    }

    const itemsRes = await supabaseAdmin
      .from("marketplace_items")
      .select("id,created_at,club_id,user_id,title,description,price,is_free,is_active,category,condition,brand,model,delivery")
      .in("club_id", access.clubIds)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 400 });

    const items = itemsRes.data ?? [];
    const authorIds = uniq((items as Array<{ user_id?: string | null }>).map((row) => row.user_id));
    const itemIds = uniq((items as Array<{ id?: string | null }>).map((row) => row.id));

    const [profilesRes, imagesRes] = await Promise.all([
      authorIds.length
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", authorIds)
        : ({ data: [], error: null } as const),
      itemIds.length
        ? supabaseAdmin.from("marketplace_images").select("item_id,path,sort_order").in("item_id", itemIds).eq("sort_order", 0)
        : ({ data: [], error: null } as const),
    ]);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (imagesRes.error) return NextResponse.json({ error: imagesRes.error.message }, { status: 400 });

    const profilesById: Record<string, { id: string; first_name: string | null; last_name: string | null }> = {};
    (profilesRes.data ?? []).forEach((row: any) => {
      const id = String(row.id ?? "").trim();
      if (!id) return;
      profilesById[id] = {
        id,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
      };
    });

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
      items,
      profilesById,
      mainImageByItemId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const childId = String(body?.child_id ?? "").trim();

    const supabaseAdmin = createAdminClient();
    const access = await resolveMarketplaceAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const clubId = String(body?.club_id ?? access.preferredClubId ?? "").trim();
    if (!clubId || !access.clubIds.includes(clubId)) {
      return NextResponse.json({ error: "Invalid club_id" }, { status: 400 });
    }

    const title = String(body?.title ?? "").trim();
    const category = String(body?.category ?? "").trim();
    const condition = String(body?.condition ?? "").trim();
    const contactEmail = String(body?.contact_email ?? "").trim();
    const contactPhone = String(body?.contact_phone ?? "").trim() || null;
    const isFree = Boolean(body?.is_free);
    const rawPrice = body?.price;
    const price = isFree || rawPrice == null || rawPrice === "" ? null : Number(rawPrice);

    if (title.length < 3) return NextResponse.json({ error: "Titre invalide." }, { status: 400 });
    if (!category) return NextResponse.json({ error: "Catégorie manquante." }, { status: 400 });
    if (!condition) return NextResponse.json({ error: "État manquant." }, { status: 400 });
    if (!contactEmail) return NextResponse.json({ error: "E-mail de contact manquant." }, { status: 400 });
    if (!isFree && (price == null || Number.isNaN(price) || price <= 0)) {
      return NextResponse.json({ error: "Prix invalide." }, { status: 400 });
    }

    const insertRes = await supabaseAdmin
      .from("marketplace_items")
      .insert({
        club_id: clubId,
        user_id: access.effectiveUserId,
        title,
        description: String(body?.description ?? "").trim() || null,
        category,
        condition,
        brand: String(body?.brand ?? "").trim() || null,
        model: String(body?.model ?? "").trim() || null,
        is_free: isFree,
        price,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        is_active: true,
        attributes: {},
      })
      .select("id")
      .single();
    if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 400 });

    return NextResponse.json({
      itemId: String(insertRes.data?.id ?? ""),
      effectiveUserId: access.effectiveUserId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

