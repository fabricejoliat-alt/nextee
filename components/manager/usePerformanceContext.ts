"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type PerformanceSeason = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
export async function performanceHeaders() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }

export function usePerformanceContext() {
  const [clubId, setClubId] = useState(""); const [seasons, setSeasons] = useState<PerformanceSeason[]>([]); const [seasonId, setSeasonId] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { void (async () => { try { const clubsResponse = await fetch("/api/manager/my-clubs", { headers: await performanceHeaders(), cache: "no-store" }); const clubsJson = await clubsResponse.json(); if (!clubsResponse.ok) throw new Error(clubsJson.error ?? "Club indisponible."); const id = String(clubsJson.clubs?.[0]?.id ?? ""); setClubId(id); if (!id) return; const seasonsResponse = await fetch(`/api/manager/clubs/${id}/seasons`, { headers: await performanceHeaders(), cache: "no-store" }); const seasonsJson = await seasonsResponse.json(); if (!seasonsResponse.ok) throw new Error(seasonsJson.error ?? "Saisons indisponibles."); const rows = (seasonsJson.seasons ?? []) as PerformanceSeason[]; setSeasons(rows); setSeasonId(rows.find((season) => season.is_current)?.id ?? rows[0]?.id ?? ""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); } finally { setLoading(false); } })(); }, []);
  return { clubId, seasons, seasonId, setSeasonId, loading, error };
}
