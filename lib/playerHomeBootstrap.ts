import type { EffectivePlayerPayload } from "./effectivePlayer";

/** A single initial render's checked response, never a permission cache. */
export type InitialPlayerHomeRead = {
  credential: string;
  childId: string;
  organizationId: string | null;
  result: Promise<EffectivePlayerPayload>;
  claimant?: object;
};

/** Strict Mode may consume twice for one mount; a later page must revalidate. */
export function claimInitialPlayerHome(read: InitialPlayerHomeRead, owner: object) {
  if (read.claimant && read.claimant !== owner) return false;
  read.claimant = owner;
  return true;
}

export function matchesInitialPlayerHome(read: Pick<InitialPlayerHomeRead, "credential" | "childId" | "organizationId">,
  current: { credential: string; childId: string; organizationId: string | null }, resolvedPlayerId?: string) {
  return read.credential === current.credential && read.organizationId === current.organizationId
    && (read.childId === current.childId || (Boolean(resolvedPlayerId) && current.childId === resolvedPlayerId));
}
