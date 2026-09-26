"use client";

import { supabase } from "@/lib/supabaseClient";

type EffectivePlayerPayload = {
  viewerUserId: string;
  effectiveUserId: string;
  role: "player" | "parent";
  roles: string[];
  childIds: string[];
  organizationIds: string[];
  organizationId: string;
  permissions: { view: boolean; edit: boolean };
};

export async function resolveEffectivePlayerContext() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) throw new Error("Invalid session");

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? "";
  if (!token) throw new Error("Invalid session");

  const stored = typeof window !== "undefined" ? window.localStorage.getItem("parent:selected_child_id") : null;
  const queryChildId =
    typeof window !== "undefined"
      ? (() => {
          try {
            return new URL(window.location.href).searchParams.get("child_id");
          } catch {
            return null;
          }
        })()
      : null;
  const explicitChildId = String(queryChildId ?? "").trim();
  const storedChildId = String(stored ?? "").trim();

  async function loadContext(childId: string) {
    const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
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
