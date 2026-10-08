"use client";

import { supabase } from "@/lib/supabaseClient";
import { inFlightRead } from "@/lib/inFlightRead";
import { currentOrganizationFilter, organizationFetch } from "@/lib/organizationFetch";

type PlayerPageIdentity = { viewerUserId: string; effectiveUserId: string; role: "player" | "parent" };

/** GET-only, concurrency-only sharing. Every completed read is checked again by the server. */
export async function readPlayerPage<T extends PlayerPageIdentity>(path: string): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Invalid session");
  const explicit = new URL(window.location.href).searchParams.get("child_id")?.trim() ?? "";
  const stored = window.localStorage.getItem("parent:selected_child_id")?.trim() ?? "";
  const load = (childId: string) => {
    const url = new URL(path, window.location.origin);
    if (childId) url.searchParams.set("child_id", childId);
    const route = `${url.pathname}${url.search}`;
    return inFlightRead(`player-page:${token}:${currentOrganizationFilter() ?? ""}:${route}`, async () => {
      const response = await organizationFetch(route, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error ?? "Unable to load player data"), { status: response.status });
      return payload as T;
    });
  };
  let result: T;
  try { result = await load(explicit || stored); }
  catch (error) {
    if (explicit || !stored || (error as { status?: number }).status !== 403) throw error;
    window.localStorage.removeItem("parent:selected_child_id");
    result = await load("");
  }
  if (result.role === "parent") window.localStorage.setItem("parent:selected_child_id", result.effectiveUserId);
  else if (!explicit) window.localStorage.removeItem("parent:selected_child_id");
  return result;
}
