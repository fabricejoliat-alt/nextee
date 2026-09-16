import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCaller } from "@/app/api/messages/_lib";
import { previousPeriod, type DateRange } from "@/lib/playerStatistics";

export function validYmd(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()); }
export function startIso(value: string) { return `${value}T00:00:00.000Z`; }
export function endIso(value: string) { return `${value}T23:59:59.999Z`; }
export function dateKey(value: string) { return value.slice(0, 10); }

export async function performanceContext(req: NextRequest, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { ok: false as const, status: 401, error: "Session requise." };
  const { supabaseAdmin: db, callerId } = await requireCaller(token);
  const [admin, manager] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", callerId).eq("role", "manager").eq("is_active", true).maybeSingle(),
  ]);
  if (!admin.data && !manager.data) return { ok: false as const, status: 403, error: "Accès refusé." };
  return { ok: true as const, db: db as SupabaseClient, callerId };
}

export async function resolveRange(req: NextRequest, db: SupabaseClient, clubId: string) {
  const seasonId = req.nextUrl.searchParams.get("season") ?? "";
  const seasonQuery = db.from("club_seasons").select("id,name,starts_on,ends_on,is_current").eq("club_id", clubId);
  const seasons = await seasonQuery.order("starts_on", { ascending: false });
  if (seasons.error) throw new Error(seasons.error.message);
  const seasonRows = (seasons.data ?? []) as Array<{ id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }>;
  const season = seasonRows.find((item) => item.id === seasonId) ?? seasonRows.find((item) => item.is_current) ?? seasonRows[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const requestedFrom = req.nextUrl.searchParams.get("from") ?? season?.starts_on ?? today;
  const requestedTo = req.nextUrl.searchParams.get("to") ?? (season?.ends_on && season.ends_on < today ? season.ends_on : today);
  if (!validYmd(requestedFrom) || !validYmd(requestedTo) || requestedFrom > requestedTo) throw new Error("Période invalide.");
  const range: DateRange = { from: requestedFrom, to: requestedTo };
  return { range, previous: previousPeriod(range), season, seasons: seasonRows };
}

export async function queryRows<T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const result = await promise;
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T[];
}
