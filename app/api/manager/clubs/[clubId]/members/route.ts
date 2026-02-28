import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (adminRow) return { ok: true as const, callerId };

  const { data: membership } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership || membership.role !== "manager") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, callerId };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data: membersRows, error: membersError } = await supabaseAdmin
      .from("club_members")
      .select("id,club_id,user_id,role,is_active,created_at")
      .eq("club_id", clubId)
      .order("created_at", { ascending: false });

    if (membersError) return NextResponse.json({ error: membersError.message }, { status: 400 });

    const members = membersRows ?? [];
    const userIds = Array.from(new Set(members.map((m: any) => String(m.user_id)).filter(Boolean)));

    let profileById = new Map<
      string,
      {
        id: string;
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        phone: string | null;
        birth_date: string | null;
        sex: string | null;
        handedness: string | null;
        handicap: number | null;
        address: string | null;
        postal_code: string | null;
        city: string | null;
        avs_no: string | null;
        avatar_url: string | null;
      }
    >();
    if (userIds.length > 0) {
      const { data: profilesRows, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select(
          [
            "id",
            "first_name",
            "last_name",
            "username",
            "phone",
            "birth_date",
            "sex",
            "handedness",
            "handicap",
            "address",
            "postal_code",
            "city",
            "avs_no",
            "avatar_url",
          ].join(",")
        )
        .in("id", userIds);
      if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 400 });
      profileById = new Map(
        (profilesRows ?? []).map((p: any) => [
          String(p.id),
          {
            id: String(p.id),
            first_name: (p.first_name ?? null) as string | null,
            last_name: (p.last_name ?? null) as string | null,
            username: (p.username ?? null) as string | null,
            phone: (p.phone ?? null) as string | null,
            birth_date: (p.birth_date ?? null) as string | null,
            sex: (p.sex ?? null) as string | null,
            handedness: (p.handedness ?? null) as string | null,
            handicap: p.handicap == null ? null : Number(p.handicap),
            address: (p.address ?? null) as string | null,
            postal_code: (p.postal_code ?? null) as string | null,
            city: (p.city ?? null) as string | null,
            avs_no: (p.avs_no ?? null) as string | null,
            avatar_url: (p.avatar_url ?? null) as string | null,
          },
        ])
      );
    }

    const authEmailById = new Map<string, string | null>();
    if (userIds.length > 0) {
      const authUsers = await Promise.all(
        userIds.map(async (id) => {
          const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
          if (error || !data?.user) return { id, email: null as string | null };
          return { id, email: data.user.email ?? null };
        })
      );
      for (const u of authUsers) authEmailById.set(u.id, u.email);
    }

    const hydratedMembers = members.map((m: any) => ({
      id: String(m.id),
      club_id: String(m.club_id),
      user_id: String(m.user_id),
      role: m.role,
      is_active: m.is_active,
      auth_email: authEmailById.get(String(m.user_id)) ?? null,
      profiles: profileById.get(String(m.user_id)) ?? null,
    }));

    return NextResponse.json({ members: hydratedMembers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const memberId = String(body.memberId ?? "");
    const role = String(body.role ?? "").trim();
    const isActive = body.is_active;
    const authEmail = typeof body.auth_email === "string" ? body.auth_email.trim().toLowerCase() : "";
    const authPassword = typeof body.auth_password === "string" ? body.auth_password : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : null;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

    if (!memberId) return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    if (role && !["manager", "coach", "player", "parent"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { data: memberRow, error: memberErr } = await supabaseAdmin
      .from("club_members")
      .select("id,user_id,club_id")
      .eq("id", memberId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 400 });
    if (!memberRow) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const memberPatch: Record<string, any> = {};
    if (role) memberPatch.role = role;
    if (typeof isActive === "boolean") memberPatch.is_active = isActive;

    if (Object.keys(memberPatch).length > 0) {
      const { error } = await supabaseAdmin.from("club_members").update(memberPatch).eq("id", memberId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (has("auth_email") || has("auth_password")) {
      const authPatch: Record<string, any> = {};
      if (has("auth_email")) {
        if (authEmail && !authEmail.includes("@")) {
          return NextResponse.json({ error: "Invalid email" }, { status: 400 });
        }
        if (authEmail) authPatch.email = authEmail;
      }
      if (has("auth_password")) {
        if (authPassword && authPassword.length < 8) {
          return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
        }
        if (authPassword) authPatch.password = authPassword;
      }
      if (Object.keys(authPatch).length > 0) {
        if (authPatch.email) authPatch.email_confirm = true;
        const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(memberRow.user_id, authPatch);
        if (authUpdateErr) return NextResponse.json({ error: authUpdateErr.message }, { status: 400 });
      }
    }

    const profilePatch: Record<string, any> = {};
    const putString = (key: string) => {
      if (!has(key)) return;
      const value = body[key];
      profilePatch[key] = typeof value === "string" ? value.trim() || null : value == null ? null : String(value).trim() || null;
    };

    putString("first_name");
    putString("last_name");
    if (has("username")) {
      profilePatch.username = username || null;
    }
    putString("phone");
    putString("birth_date");
    putString("sex");
    putString("address");
    putString("postal_code");
    putString("city");
    putString("avs_no");

    if (has("handedness")) {
      const raw = body.handedness;
      const v = typeof raw === "string" ? raw.trim().toLowerCase() : raw == null ? "" : String(raw).trim().toLowerCase();
      if (v !== "" && v !== "right" && v !== "left") {
        return NextResponse.json({ error: "Invalid handedness" }, { status: 400 });
      }
      profilePatch.handedness = v || null;
    }

    if (has("handicap")) {
      const raw = body.handicap;
      if (raw == null || raw === "") {
        profilePatch.handicap = null;
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: "Invalid handicap" }, { status: 400 });
        }
        profilePatch.handicap = n;
      }
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(profilePatch).eq("id", memberRow.user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
