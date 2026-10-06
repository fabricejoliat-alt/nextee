import { NextResponse, type NextRequest } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolvePlayerConsentStatus } from "@/lib/playerConsent";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  requirePlayerActor,
  resolvePlayerAccessContext,
  visibleGuardianLinks,
} from "@/app/api/player/access";

type ConsentStatus = "granted" | "pending" | "refused" | "adult";

export async function GET(req: NextRequest) {
  try {
    const caller = await requirePlayerActor(bearerTokenFromRequest(req));
    const { supabaseAdmin, actorUserId: userId, actorRoles } = caller;
    const visibleLinks = visibleGuardianLinks(caller.guardianLinks);
    const requestedChildId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const useParentContext =
      actorRoles.includes("parent") &&
      visibleLinks.length > 0 &&
      (!actorRoles.includes("player") || Boolean(requestedChildId));

    if (useParentContext) {
      if (requestedChildId) {
        await resolvePlayerAccessContext({
          supabaseAdmin,
          actorUserId: userId,
          actorRoles,
          guardianLinks: caller.guardianLinks,
          requestedPlayerId: requestedChildId,
          mode: "view",
        });
      }
      const links = visibleLinks;

      const playerIds = Array.from(new Set(links.map((link) => link.playerId).filter(Boolean)));
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
      const editableById = new Map<string, boolean>();
      for (const link of links) {
        if (link.playerId && link.isPrimary) primaryById.set(link.playerId, true);
        if (link.playerId) editableById.set(link.playerId, link.canView !== false && link.canEdit === true);
      }

      const children = playerIds
        .map((playerId) => {
          const profile = profileById.get(playerId);
          const birthDate = (profile?.birth_date ?? null) as string | null;
          const status = resolvePlayerConsentStatus(statusesByPlayer.get(playerId) ?? []) as ConsentStatus;
          return {
            playerId,
            firstName: (profile?.first_name ?? null) as string | null,
            lastName: (profile?.last_name ?? null) as string | null,
            birthDate,
            isPrimary: primaryById.get(playerId) ?? false,
            canEdit: editableById.get(playerId) ?? false,
            consentStatus: status,
            pending: status !== "granted" && status !== "adult",
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
        pendingChildren: children.filter((c) => c.pending && c.canEdit && statusesByPlayer.has(c.playerId)).map((c) => c.playerId),
      });
    }

    if (!actorRoles.includes("player")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const status = resolvePlayerConsentStatus(
      ((membershipsRes.data ?? []) as Array<{ player_consent_status: string | null }>).map(
        (row) => row.player_consent_status
      )
    );

    return NextResponse.json({
      viewerRole: "player",
      player: {
        playerId: userId,
        firstName: (profileRes.data?.first_name ?? null) as string | null,
        lastName: (profileRes.data?.last_name ?? null) as string | null,
        birthDate,
        consentStatus: status,
        pending: status !== "granted" && status !== "adult",
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requirePlayerActor(bearerTokenFromRequest(req));
    void caller;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();

    if (action === "grant") {
      return NextResponse.json({ error: "L’autorisation se donne désormais sur le document complet dans votre espace juridique.",
        code: "VERSIONED_PARENT_AUTHORIZATION_REQUIRED", redirectTo: "/legal/my" },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) }
    );
  }
}
