import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/app/api/validations/_lib";

const BUCKET = "validation-exercise-images";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ exerciseId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { exerciseId } = await ctx.params;
    const id = String(exerciseId ?? "").trim();
    if (!id) return NextResponse.json({ error: "Missing exercise id" }, { status: 400 });
    const formData = await req.formData();
    const image = formData.get("image");
    if (!(image instanceof File)) return NextResponse.json({ error: "Image manquante." }, { status: 400 });
    if (!ALLOWED_TYPES.has(image.type)) return NextResponse.json({ error: "Format non pris en charge. Utilisez PNG, JPEG ou WebP." }, { status: 400 });
    if (image.size > MAX_IMAGE_SIZE) return NextResponse.json({ error: "L’image est trop lourde (5 Mo maximum)." }, { status: 400 });
    const { supabaseAdmin } = await requireSuperAdmin(accessToken);
    const exerciseRes = await supabaseAdmin.from("validation_exercises").select("id").eq("id", id).maybeSingle();
    if (exerciseRes.error) return NextResponse.json({ error: exerciseRes.error.message }, { status: 400 });
    if (!exerciseRes.data) return NextResponse.json({ error: "Exercice introuvable." }, { status: 404 });
    const objectPath = `${id}/${crypto.randomUUID()}.${ALLOWED_TYPES.get(image.type)}`;
    const uploadRes = await supabaseAdmin.storage.from(BUCKET).upload(objectPath, Buffer.from(await image.arrayBuffer()), { contentType: image.type, cacheControl: "31536000", upsert: false });
    if (uploadRes.error) return NextResponse.json({ error: uploadRes.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, illustration_url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl });
  } catch (error: unknown) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
