import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function computeAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

async function resolvePlayerConsentPending(supabaseAdmin: any, userId: string) {
  const [profileRes, membershipsRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("birth_date").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("club_members")
      .select("player_consent_status")
      .eq("user_id", userId)
      .eq("role", "player")
      .eq("is_active", true),
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);

  const statuses = (membershipsRes.data ?? []).map((row: any) => String(row?.player_consent_status ?? ""));
  if (statuses.includes("pending")) return true;
  if (statuses.includes("granted") || statuses.includes("adult")) return false;
  const age = computeAge((profileRes.data?.birth_date ?? null) as string | null);
  return !(age != null && age >= 18);
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Qui est-ce ? (à partir du token utilisateur)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = userData.user.id;

    // Superadmin ?
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json({ error: adminErr.message }, { status: 400 });
    }

    const resHeaders = { "Cache-Control": "no-store" as const };

    if (adminRow) {
      return NextResponse.json({ redirectTo: "/admin" }, { headers: resHeaders });
    }

    // Sinon: membership actif (premier trouvé)
    const { data: membership, error: memErr } = await supabaseAdmin
      .from("club_members")
      .select("club_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 400, headers: resHeaders });
    }

    if (!membership) {
      return NextResponse.json({ redirectTo: "/no-access" }, { headers: resHeaders });
    }

    const role = membership.role as "manager" | "coach" | "player" | "parent";

    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers: resHeaders });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers: resHeaders });
    if (role === "parent") {
      const { data: linkRow, error: linkErr } = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", userId)
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 400, headers: resHeaders });
      }
      if (!linkRow?.player_id) return NextResponse.json({ redirectTo: "/no-access" }, { headers: resHeaders });
      return NextResponse.json({ redirectTo: "/player" }, { headers: resHeaders });
    }
    if (role === "player") {
      const pendingConsent = await resolvePlayerConsentPending(supabaseAdmin, userId);
      if (pendingConsent) return NextResponse.json({ redirectTo: "/player/consent-required" }, { headers: resHeaders });
    }
    return NextResponse.json({ redirectTo: "/player" }, { headers: resHeaders });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
