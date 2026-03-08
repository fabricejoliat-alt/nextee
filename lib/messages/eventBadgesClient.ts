"use client";

import { supabase } from "@/lib/supabaseClient";

export type EventMessageBadge = {
  thread_id: string | null;
  message_count: number;
  unread_count: number;
};

export async function fetchEventMessageBadges(eventIds: string[]): Promise<Record<string, EventMessageBadge>> {
  const ids = Array.from(new Set(eventIds.map((v) => String(v).trim()).filter(Boolean)));
  if (ids.length === 0) return {};

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  if (!token) return {};

  const qs = new URLSearchParams({ event_ids: ids.join(",") });
  const res = await fetch(`/api/messages/event-badges?${qs.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return {};
  const json = await res.json().catch(() => ({}));
  return (json?.badges ?? {}) as Record<string, EventMessageBadge>;
}

