"use client";

import { supabase } from "@/lib/supabaseClient";
import { inFlightRead } from "@/lib/inFlightRead";
import { currentOrganizationFilter } from "@/lib/organizationFetch";
import { claimInitialPlayerHome, matchesInitialPlayerHome, type InitialPlayerHomeRead } from "@/lib/playerHomeBootstrap";

export type EffectivePlayerPayload = {
  viewerUserId: string;
  effectiveUserId: string;
  role: "player" | "parent";
  roles: string[];
  childIds: string[];
  organizationIds: string[];
  organizationId: string;
  permissions: { view: boolean; edit: boolean };
  home?: {
    profile: { id: string; first_name: string | null; last_name: string | null; handicap: number | null; avatar_url: string | null } | null;
    organizations: Array<{ id: string; name: string | null }>;
    performanceEnabled: boolean;
  };
};

function selectedChild() {
  const explicit = typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("child_id")?.trim() ?? "" : "";
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("parent:selected_child_id")?.trim() ?? "" : "";
  return { explicit, stored, childId: explicit || stored };
}

export function startInitialPlayerHomeRead(credential: string): InitialPlayerHomeRead {
  const read = { credential, childId: selectedChild().childId, organizationId: currentOrganizationFilter(),
    result: resolveEffectivePlayerContext({ home: true }) };
  // The gate can refuse the screen before this checked read is consumed.
  void read.result.catch(() => {});
  return read;
}

export async function resolveEffectivePlayerContext(options: { home?: boolean; initialRead?: InitialPlayerHomeRead | null; initialReadOwner?: object } = {}) {
  // The API verifies the bearer token and authorization. getSession supplies
  // credentials only; a second browser getUser round trip adds no protection.
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? "";
  if (!token) throw new Error("Invalid session");

  const { explicit: explicitChildId, stored: storedChildId, childId } = selectedChild();
  const current = { credential: token, childId, organizationId: currentOrganizationFilter() };
  if (options.home && options.initialRead && options.initialReadOwner && options.initialRead.credential === token
    && options.initialRead.organizationId === current.organizationId && claimInitialPlayerHome(options.initialRead, options.initialReadOwner)) {
    const result = await options.initialRead.result.then(value => ({ value, error: null }), error => ({ value: null, error }));
    if (matchesInitialPlayerHome(options.initialRead, current, result.value?.effectiveUserId)) {
      if (result.error) throw result.error;
      return result.value!;
    }
  }

  async function loadContext(childId: string) {
    const params = new URLSearchParams();
    if (childId) params.set("child_id", childId);
    if (options.home) params.set("home", "1");
    const query = params.size ? `?${params}` : "";
    return inFlightRead(`player-context:${token}:${currentOrganizationFilter() ?? ""}:${query}`, async () => {
      const response = await fetch(`/api/player/context${query}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<EffectivePlayerPayload> & {
        error?: string;
      };
      if (!response.ok) throw Object.assign(new Error(payload.error ?? "Unable to resolve player context"), { status: response.status });
      return payload as EffectivePlayerPayload;
    });
  }

  let context: EffectivePlayerPayload;
  try {
    context = await loadContext(explicitChildId || storedChildId);
  } catch (error: unknown) {
    // A revoked or deleted stored selection must not keep the Player space
    // unusable. An explicit URL selection remains a visible authorization error.
    if (explicitChildId || !storedChildId || (error as { status?: number })?.status !== 403) throw error;
    window.localStorage.removeItem("parent:selected_child_id");
    context = await loadContext("");
  }

  if (typeof window !== "undefined") {
    if (context.role === "parent") {
      window.localStorage.setItem("parent:selected_child_id", context.effectiveUserId);
    } else if (!explicitChildId) {
      window.localStorage.removeItem("parent:selected_child_id");
    }
  }

  return context;
}
