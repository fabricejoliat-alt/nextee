import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin, getManagerContext } from "@/app/api/manager/news/_lib";

const BUCKET = "club-news-images";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const ctx = await getManagerContext(req, supabaseAdmin);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const formData = await req.formData();
    const clubId = String(formData.get("club_id") ?? "").trim();
    const image = formData.get("image");
    if (!clubId || !ctx.managedClubs.some((club) => club.id === clubId)) {
      return NextResponse.json({ error: "Club invalide." }, { status: 400 });
    }
    if (!(image instanceof File) || !ALLOWED_TYPES.has(image.type)) {
      return NextResponse.json({ error: "Format accepté : JPG, PNG ou WebP." }, { status: 400 });
    }
    if (image.size > MAX_BYTES) {
      return NextResponse.json({ error: "L’image ne doit pas dépasser 8 Mo." }, { status: 400 });
    }

    const extension = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    const path = `${clubId}/${randomUUID()}.${extension}`;
    const uploadRes = await supabaseAdmin.storage.from(BUCKET).upload(path, Buffer.from(await image.arrayBuffer()), {
      contentType: image.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadRes.error) return NextResponse.json({ error: uploadRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, image_url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload impossible." }, { status: 500 });
  }
}
