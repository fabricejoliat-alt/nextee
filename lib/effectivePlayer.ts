"use client";

import { supabase } from "@/lib/supabaseClient";

type ParentChildLite = { id: string; is_primary?: boolean };

export async function resolveEffectivePlayerContext() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) throw new Error("Invalid session");

  const viewerUserId = userRes.user.id;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? "";
  if (!token) {
    return {
      viewerUserId,
      effectiveUserId: viewerUserId,
      role: "player" as const,
      childIds: [] as string[],
    };
  }

  const meRes = await fetch("/api/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const meJson = await meRes.json().catch(() => ({}));
  const role = meRes.ok ? String(meJson?.membership?.role ?? "player") : "player";

  if (role !== "parent") {
    return {
      viewerUserId,
      effectiveUserId: viewerUserId,
      role: "player" as const,
      childIds: [] as string[],
    };
  }

  const childrenRes = await fetch("/api/parent/children", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const childrenJson = await childrenRes.json().catch(() => ({}));
  const children = (childrenRes.ok ? childrenJson?.children ?? [] : []) as ParentChildLite[];

  if (children.length === 0) {
    return {
      viewerUserId,
      effectiveUserId: viewerUserId,
      role: "parent" as const,
      childIds: [] as string[],
    };
  }

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
  const selected =
    (queryChildId && children.find((c) => c.id === queryChildId)?.id) ||
    (stored && children.find((c) => c.id === stored)?.id) ||
    children.find((c) => c.is_primary)?.id ||
    children[0]?.id ||
    viewerUserId;

  if (typeof window !== "undefined" && selected) {
    window.localStorage.setItem("parent:selected_child_id", selected);
  }

  return {
    viewerUserId,
    effectiveUserId: selected,
    role: "parent" as const,
    childIds: children.map((c) => c.id),
  };
}
