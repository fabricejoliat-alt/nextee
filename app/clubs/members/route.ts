import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function checkSuperAdmin(supabase: any, token: string) {
  const { data: caller } = await supabase.auth.getUser(token);
  if (!caller?.user) return false;

  const { data } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", caller.user.id)
    .maybeSingle();

  return !!data;
}

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const supabase = createAdminClient();
  const isAdmin = await checkSuperAdmin(supabase, token);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const clubId = searchParams.get("clubId");
  if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

  const { data, error } = await supabase
    .from("club_members")
    .select(`
      id,
      role,
      profiles (
        id,
        first_name,
        last_name
      )
    `)
    .eq("club_id", clubId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ members: data });
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const supabase = createAdminClient();
  const isAdmin = await checkSuperAdmin(supabase, token);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { clubId, userId, role } = body;

  // éviter doublon
  const { data: existing } = await supabase
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Utilisateur déjà membre du club" }, { status: 400 });
  }

  const { error } = await supabase.from("club_members").insert({
    club_id: clubId,
    user_id: userId,
    role,
    is_active: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const supabase = createAdminClient();
  const isAdmin = await checkSuperAdmin(supabase, token);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { memberId } = body;

  const { error } = await supabase
    .from("club_members")
    .delete()
    .eq("id", memberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
