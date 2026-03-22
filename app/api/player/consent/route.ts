import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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

type ConsentStatus = "granted" | "pending" | "adult";

function aggregateConsentStatus(
  statuses: Array<string | null | undefined>,
  birthDate: string | null | undefined
): ConsentStatus {
  if (statuses.some((v) => v === "granted")) return "granted";
  if (statuses.some((v) => v === "adult")) return "adult";
  if (statuses.some((v) => v === "pending")) return "pending";
  const age = computeAge(birthDate);
  if (age != null && age >= 18) return "adult";
  return "pending";
}

async function getCaller(req: NextRequest) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { error: "Missing token", status: 401 as const };

  const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { error: "Invalid token", status: 401 as const };

  const userId = callerData.user.id;
  const { data: membership, error: membershipErr } = await supabaseAdmin
    .from("club_members")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipErr) return { error: membershipErr.message, status: 400 as const };

  return {
    supabaseAdmin,
    userId,
    role: String(membership?.role ?? "player"),
  };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await getCaller(req);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const { supabaseAdmin, userId, role } = caller;

    if (role === "parent") {
      const { data: links, error: linksErr } = await supabaseAdmin
        .from("player_guardians")
        .select("player_id,is_primary")
        .eq("guardian_user_id", userId);
      if (linksErr) return NextResponse.json({ error: linksErr.message }, { status: 400 });

      const playerIds = Array.from(new Set((links ?? []).map((r: any) => String(r.player_id ?? "")).filter(Boolean)));
      if (playerIds.length === 0) {
        return NextResponse.json({ viewerRole: "parent", children: [], pendingChildren: [] });
      }

      const [profilesRes, membershipsRes] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id,first_name,last_name,birth_date")
          .in("id", playerIds),
        supabaseAdmin
          .from("club_members")
          .select("user_id,player_consent_status")
          .in("user_id", playerIds)
          .eq("role", "player")
          .eq("is_active", true),
      ]);

      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
      if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

      const profileById = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [String(p.id), p]));
      const statusesByPlayer = new Map<string, string[]>();
      for (const row of membershipsRes.data ?? []) {
        const pid = String((row as any).user_id ?? "");
        if (!pid) continue;
        const list = statusesByPlayer.get(pid) ?? [];
        list.push(((row as any).player_consent_status ?? null) as string | null);
        statusesByPlayer.set(pid, list);
      }

      const primaryById = new Map<string, boolean>();
      for (const link of links ?? []) {
        const pid = String((link as any).player_id ?? "");
        if (pid && Boolean((link as any).is_primary)) primaryById.set(pid, true);
      }

      const children = playerIds
        .map((playerId) => {
          const profile = profileById.get(playerId);
          const birthDate = (profile?.birth_date ?? null) as string | null;
          const status = aggregateConsentStatus(statusesByPlayer.get(playerId) ?? [], birthDate);
          return {
            playerId,
            firstName: (profile?.first_name ?? null) as string | null,
            lastName: (profile?.last_name ?? null) as string | null,
            birthDate,
            isPrimary: primaryById.get(playerId) ?? false,
            consentStatus: status,
            pending: status === "pending",
          };
        })
        .sort((a, b) => {
          if (a.pending !== b.pending) return a.pending ? -1 : 1;
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          const aName = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
          const bName = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim();
          return aName.localeCompare(bName, "fr");
        });

      return NextResponse.json({
        viewerRole: "parent",
        children,
        pendingChildren: children.filter((c) => c.pending).map((c) => c.playerId),
      });
    }

    const [profileRes, membershipsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,first_name,last_name,birth_date").eq("id", userId).maybeSingle(),
      supabaseAdmin
        .from("club_members")
        .select("player_consent_status")
        .eq("user_id", userId)
        .eq("role", "player")
        .eq("is_active", true),
    ]);

    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const birthDate = (profileRes.data?.birth_date ?? null) as string | null;
    const status = aggregateConsentStatus(
      (membershipsRes.data ?? []).map((row: any) => (row?.player_consent_status ?? null) as string | null),
      birthDate
    );

    return NextResponse.json({
      viewerRole: "player",
      player: {
        playerId: userId,
        firstName: (profileRes.data?.first_name ?? null) as string | null,
        lastName: (profileRes.data?.last_name ?? null) as string | null,
        birthDate,
        consentStatus: status,
        pending: status === "pending",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const { supabaseAdmin, userId, role } = caller;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();

    if (action === "grant") {
      if (role !== "parent") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const playerId = String(body?.playerId ?? "").trim();
      const confirmed = body?.confirmed === true;
      if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });
      if (!confirmed) return NextResponse.json({ error: "Consent confirmation required" }, { status: 400 });

      const { data: linkRow, error: linkErr } = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", userId)
        .eq("player_id", playerId)
        .maybeSingle();
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });
      if (!linkRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const { error: updateErr } = await supabaseAdmin
        .from("club_members")
        .update({ player_consent_status: "granted" })
        .eq("user_id", playerId)
        .eq("role", "player")
        .eq("is_active", true);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

      return NextResponse.json({ ok: true, consentStatus: "granted" });
    }

    if (action === "declare_adult") {
      if (role !== "player") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const birthDate = String(body?.birthDate ?? "").trim();
      if (!birthDate) return NextResponse.json({ error: "Missing birthDate" }, { status: 400 });
      const age = computeAge(birthDate);
      if (age == null) return NextResponse.json({ error: "Date de naissance invalide" }, { status: 400 });
      if (age < 18) {
        return NextResponse.json(
          { error: "Cette date de naissance indique un joueur mineur. Le consentement d'un parent reste nécessaire." },
          { status: 400 }
        );
      }

      const [profileUpdate, membershipUpdate] = await Promise.all([
        supabaseAdmin.from("profiles").update({ birth_date: birthDate }).eq("id", userId),
        supabaseAdmin
          .from("club_members")
          .update({ player_consent_status: "adult" })
          .eq("user_id", userId)
          .eq("role", "player")
          .eq("is_active", true),
      ]);

      if (profileUpdate.error) return NextResponse.json({ error: profileUpdate.error.message }, { status: 400 });
      if (membershipUpdate.error) return NextResponse.json({ error: membershipUpdate.error.message }, { status: 400 });

      return NextResponse.json({ ok: true, consentStatus: "adult" });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
