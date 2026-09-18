import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "avatars";
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function createSupabaseAdmin() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function requireUser(req: NextRequest, supabaseAdmin: ReturnType<typeof createSupabaseAdmin>) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, error: "Session manquante." };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Session invalide." };
  return { ok: true as const, userId: data.user.id };
}

async function ensureAvatarBucket(supabaseAdmin: ReturnType<typeof createSupabaseAdmin>) {
  const bucket = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!bucket.error) return;

  const created = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED_TYPES],
  });
  if (created.error && !/already exists|duplicate/i.test(created.error.message)) {
    throw new Error(created.error.message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const auth = await requireUser(req, supabaseAdmin);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const formData = await req.formData();
    const image = formData.get("image");
    if (!(image instanceof File) || !ALLOWED_TYPES.has(image.type)) {
      return NextResponse.json({ error: "Format accepté : JPG, PNG ou WebP." }, { status: 400 });
    }
    if (image.size > MAX_BYTES) {
      return NextResponse.json({ error: "L’image ne doit pas dépasser 4 Mo." }, { status: 400 });
    }

    await ensureAvatarBucket(supabaseAdmin);

    const objectPath = `${auth.userId}/avatar.jpg`;
    const upload = await supabaseAdmin.storage.from(BUCKET).upload(
      objectPath,
      Buffer.from(await image.arrayBuffer()),
      { upsert: true, contentType: "image/jpeg", cacheControl: "3600" }
    );
    if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 400 });

    const avatarUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const profileUpdate = await supabaseAdmin.from("profiles").update({ avatar_url: avatarUrl }).eq("id", auth.userId);
    if (profileUpdate.error) return NextResponse.json({ error: profileUpdate.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, avatar_url: avatarUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload impossible." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const auth = await requireUser(req, supabaseAdmin);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    await ensureAvatarBucket(supabaseAdmin);
    const objectPath = `${auth.userId}/avatar.jpg`;
    const removal = await supabaseAdmin.storage.from(BUCKET).remove([objectPath]);
    if (removal.error && !/not[\s_-]?found|does not exist/i.test(removal.error.message)) {
      return NextResponse.json({ error: removal.error.message }, { status: 400 });
    }

    const profileUpdate = await supabaseAdmin.from("profiles").update({ avatar_url: null }).eq("id", auth.userId);
    if (profileUpdate.error) return NextResponse.json({ error: profileUpdate.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Suppression impossible." }, { status: 500 });
  }
}
