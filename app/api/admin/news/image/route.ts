import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, requirePlatformAdmin } from "../_lib";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  try {
    const database = createAdminClient(); const auth = await requirePlatformAdmin(req, database);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const form = await req.formData(); const image = form.get("image");
    if (!(image instanceof File) || !ALLOWED.has(image.type)) return NextResponse.json({ error: "Format accepté : JPG, PNG ou WebP." }, { status: 400 });
    if (image.size > 8 * 1024 * 1024) return NextResponse.json({ error: "L’image ne doit pas dépasser 8 Mo." }, { status: 400 });
    const extension = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    const path = `platform/${randomUUID()}.${extension}`;
    const upload = await database.storage.from("club-news-images").upload(path, Buffer.from(await image.arrayBuffer()), { contentType: image.type, cacheControl: "31536000" });
    if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 400 });
    return NextResponse.json({ image_url: database.storage.from("club-news-images").getPublicUrl(path).data.publicUrl });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Upload impossible." }, { status: 500 }); }
}
