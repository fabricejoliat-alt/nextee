import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function requireUser(req: NextRequest, supabaseAdmin: any) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Invalid token" };
  return { ok: true as const, userId: data.user.id };
}

function normalizeDate(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeValue(raw: unknown) {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 10) / 10;
  const value = String(raw ?? "").trim().replace(",", ".");
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  if (rounded < -10 || rounded > 99.9) return null;
  return rounded;
}

function normalizeNote(raw: unknown) {
  const value = String(raw ?? "").trim();
  return value ? value.slice(0, 500) : null;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function syncCurrentHandicap(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("player_handicap_history")
    .select("value,effective_date")
    .eq("user_id", userId)
    .lte("effective_date", todayIsoDate())
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const currentValue = data?.value == null ? null : Number(data.value);
  const { error: updateError } = await supabaseAdmin.from("profiles").update({ handicap: currentValue }).eq("id", userId);
  if (updateError) throw new Error(updateError.message);
}

async function listEntries(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("player_handicap_history")
    .select("id,user_id,effective_date,value,note,source,created_by,created_at,updated_at")
    .eq("user_id", userId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function requireOwnedEntry(supabaseAdmin: any, entryId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("player_handicap_history")
    .select("id,user_id")
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || String(data.user_id ?? "") !== userId) return null;
  return data;
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ entryId: string }> }) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await requireUser(req, supabaseAdmin);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const params = await context.params;
    const entryId = String(params.entryId ?? "").trim();
    if (!entryId) return NextResponse.json({ error: "Entrée introuvable." }, { status: 404 });

    const ownedEntry = await requireOwnedEntry(supabaseAdmin, entryId, auth.userId);
    if (!ownedEntry) return NextResponse.json({ error: "Entrée introuvable." }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const effectiveDate = normalizeDate(body?.effective_date);
    const value = normalizeValue(body?.value);
    const note = normalizeNote(body?.note);

    if (!effectiveDate) return NextResponse.json({ error: "Date d'effet invalide." }, { status: 400 });
    if (value == null) return NextResponse.json({ error: "Handicap invalide." }, { status: 400 });

    const { error } = await supabaseAdmin
      .from("player_handicap_history")
      .update({
        effective_date: effectiveDate,
        value,
        note,
      })
      .eq("id", entryId)
      .eq("user_id", auth.userId);

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Une entrée existe déjà pour cette date." }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await syncCurrentHandicap(supabaseAdmin, auth.userId);
    const entries = await listEntries(supabaseAdmin, auth.userId);
    return NextResponse.json({ ok: true, entries });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ entryId: string }> }) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await requireUser(req, supabaseAdmin);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const params = await context.params;
    const entryId = String(params.entryId ?? "").trim();
    if (!entryId) return NextResponse.json({ error: "Entrée introuvable." }, { status: 404 });

    const ownedEntry = await requireOwnedEntry(supabaseAdmin, entryId, auth.userId);
    if (!ownedEntry) return NextResponse.json({ error: "Entrée introuvable." }, { status: 404 });

    const { error } = await supabaseAdmin
      .from("player_handicap_history")
      .delete()
      .eq("id", entryId)
      .eq("user_id", auth.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await syncCurrentHandicap(supabaseAdmin, auth.userId);
    const entries = await listEntries(supabaseAdmin, auth.userId);
    return NextResponse.json({ ok: true, entries });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
