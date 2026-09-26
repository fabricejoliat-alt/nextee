export type PlayerAccessMode = "view" | "edit" | "consent" | "communication";
export type PlayerApplicationRole = "manager" | "coach" | "player" | "parent";

export type GuardianAccessLink = {
  playerId: string;
  isPrimary: boolean;
  canView: boolean | null;
  canEdit: boolean | null;
  createdAt: string | null;
};

export type PlayerSubjectSelection =
  | {
      ok: true;
      playerId: string;
      isGuardianContext: boolean;
      guardianLink: GuardianAccessLink | null;
      canView: boolean;
      canEdit: boolean;
    }
  | { ok: false; reason: "forbidden" };

function normalizedRoles(roles: Iterable<string>) {
  return new Set(Array.from(roles, (role) => String(role ?? "").trim().toLowerCase()).filter(Boolean));
}

export function selectPrimaryApplicationRole(roles: Iterable<string>): PlayerApplicationRole | null {
  const normalized = normalizedRoles(roles);
  for (const role of ["manager", "coach", "player", "parent"] as const) {
    if (normalized.has(role)) return role;
  }
  return null;
}

export function guardianCanView(link: Pick<GuardianAccessLink, "canView">) {
  return link.canView !== false;
}

export function guardianCanEdit(link: Pick<GuardianAccessLink, "canView" | "canEdit">) {
  return guardianCanView(link) && link.canEdit === true;
}

export function guardianAllows(link: GuardianAccessLink, mode: PlayerAccessMode) {
  return mode === "edit" || mode === "consent" ? guardianCanEdit(link) : guardianCanView(link);
}

export function sortGuardianLinks(links: GuardianAccessLink[]) {
  return [...links].sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    const leftCreatedAt = left.createdAt ?? "";
    const rightCreatedAt = right.createdAt ?? "";
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt);
    return left.playerId.localeCompare(right.playerId);
  });
}

export function resolvePlayerSubject(input: {
  actorUserId: string;
  actorRoles: Iterable<string>;
  guardianLinks: GuardianAccessLink[];
  requestedPlayerId?: string | null;
  mode?: PlayerAccessMode;
}): PlayerSubjectSelection {
  const actorUserId = String(input.actorUserId ?? "").trim();
  const requestedPlayerId = String(input.requestedPlayerId ?? "").trim();
  const mode = input.mode ?? "view";
  const roles = normalizedRoles(input.actorRoles);
  const permittedLinks = roles.has("parent")
    ? sortGuardianLinks(input.guardianLinks).filter((link) => guardianAllows(link, mode))
    : [];

  if (requestedPlayerId) {
    if (requestedPlayerId === actorUserId) {
      if (!roles.has("player")) return { ok: false, reason: "forbidden" };
      return {
        ok: true,
        playerId: actorUserId,
        isGuardianContext: false,
        guardianLink: null,
        canView: true,
        canEdit: true,
      };
    }

    const link = permittedLinks.find((candidate) => candidate.playerId === requestedPlayerId);
    if (!link) return { ok: false, reason: "forbidden" };
    return {
      ok: true,
      playerId: link.playerId,
      isGuardianContext: true,
      guardianLink: link,
      canView: guardianCanView(link),
      canEdit: guardianCanEdit(link),
    };
  }

  // A multi-role account defaults to its own Player identity. Switching to a
  // child is explicit through child_id, which prevents an arbitrary membership
  // row from silently changing the subject of the request.
  if (roles.has("player")) {
    return {
      ok: true,
      playerId: actorUserId,
      isGuardianContext: false,
      guardianLink: null,
      canView: true,
      canEdit: true,
    };
  }

  const fallback = permittedLinks[0];
  if (!fallback) return { ok: false, reason: "forbidden" };
  return {
    ok: true,
    playerId: fallback.playerId,
    isGuardianContext: true,
    guardianLink: fallback,
    canView: guardianCanView(fallback),
    canEdit: guardianCanEdit(fallback),
  };
}
