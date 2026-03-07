import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

type VolumeRow = {
  ftem_code: string;
  level_label: string;
  handicap_label: string;
  handicap_min: number | null;
  handicap_max: number | null;
  motivation_text: string | null;
  minutes_offseason: number;
  minutes_inseason: number;
  sort_order: number;
};

const DEFAULT_ROWS: VolumeRow[] = [
  { ftem_code: "F1", level_label: "Junior Explorer I", handicap_label: "54.0", handicap_min: 54, handicap_max: 54, motivation_text: "", minutes_offseason: 180, minutes_inseason: 180, sort_order: 10 },
  { ftem_code: "F2", level_label: "Junior Explorer II", handicap_label: "36.1-53.9", handicap_min: 36.1, handicap_max: 53.9, motivation_text: "", minutes_offseason: 240, minutes_inseason: 240, sort_order: 20 },
  { ftem_code: "F3", level_label: "Junior Explorer III", handicap_label: "18.1-36.0", handicap_min: 18.1, handicap_max: 36.0, motivation_text: "", minutes_offseason: 360, minutes_inseason: 360, sort_order: 30 },
  { ftem_code: "T1", level_label: "Junior Competitor", handicap_label: "10.1-18.0", handicap_min: 10.1, handicap_max: 18.0, motivation_text: "", minutes_offseason: 720, minutes_inseason: 600, sort_order: 40 },
  { ftem_code: "T2", level_label: "Junior Challenger", handicap_label: "5.1-10.0", handicap_min: 5.1, handicap_max: 10.0, motivation_text: "", minutes_offseason: 960, minutes_inseason: 840, sort_order: 50 },
  { ftem_code: "T3", level_label: "Junior Performer", handicap_label: "0.0-5.0", handicap_min: 0, handicap_max: 5.0, motivation_text: "", minutes_offseason: 1440, minutes_inseason: 1320, sort_order: 60 },
  { ftem_code: "T4", level_label: "Junior Elite", handicap_label: "+0.1 a +2.0", handicap_min: -2.0, handicap_max: -0.1, motivation_text: "", minutes_offseason: 1920, minutes_inseason: 1800, sort_order: 70 },
  { ftem_code: "E1", level_label: "International Elite", handicap_label: "+2.1 a +4.0", handicap_min: -4.0, handicap_max: -2.1, motivation_text: "", minutes_offseason: 2400, minutes_inseason: 2280, sort_order: 80 },
  { ftem_code: "E2", level_label: "World Elite", handicap_label: "+4.1 a +6.0", handicap_min: -6.0, handicap_max: -4.1, motivation_text: "", minutes_offseason: 3000, minutes_inseason: 2760, sort_order: 90 },
  { ftem_code: "M", level_label: "Champion", handicap_label: "Tour level", handicap_min: null, handicap_max: null, motivation_text: "", minutes_offseason: 3600, minutes_inseason: 3300, sort_order: 100 },
];

const DEFAULT_SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10];
const DEFAULT_OFFSEASON_MONTHS = [11, 12, 1, 2, 3];

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sanitizeMonths(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const uniq = new Set<number>();
  for (const m of value) {
    const n = Number(m);
    if (!Number.isInteger(n)) continue;
    if (n < 1 || n > 12) continue;
    uniq.add(n);
  }
  return Array.from(uniq);
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();
  if (adminRow) return { ok: true as const };

  const { data: membership } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership || membership.role !== "manager") return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const };
}

async function ensureDefaults(supabaseAdmin: any, clubId: string) {
  const settingsRes = await supabaseAdmin
    .from("training_volume_settings")
    .select("organization_id")
    .eq("organization_id", clubId)
    .maybeSingle();
  if (!settingsRes.data) {
    await supabaseAdmin.from("training_volume_settings").insert({
      organization_id: clubId,
      season_months: DEFAULT_SEASON_MONTHS,
      offseason_months: DEFAULT_OFFSEASON_MONTHS,
    });
  }

  const rowsRes = await supabaseAdmin
    .from("training_volume_targets")
    .select("id")
    .eq("organization_id", clubId)
    .limit(1);
  if (!rowsRes.data || rowsRes.data.length === 0) {
    await supabaseAdmin.from("training_volume_targets").insert(
      DEFAULT_ROWS.map((r) => ({
        organization_id: clubId,
        ...r,
      }))
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    await ensureDefaults(supabaseAdmin, clubId);

    const [settingsRes, rowsRes] = await Promise.all([
      supabaseAdmin
        .from("training_volume_settings")
        .select("season_months,offseason_months")
        .eq("organization_id", clubId)
        .maybeSingle(),
      supabaseAdmin
        .from("training_volume_targets")
        .select("id,ftem_code,level_label,handicap_label,handicap_min,handicap_max,motivation_text,minutes_offseason,minutes_inseason,sort_order")
        .eq("organization_id", clubId)
        .order("sort_order", { ascending: true })
        .order("ftem_code", { ascending: true }),
    ]);

    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 400 });
    if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 400 });

    return NextResponse.json({
      settings: {
        season_months: sanitizeMonths(settingsRes.data?.season_months ?? DEFAULT_SEASON_MONTHS),
        offseason_months: sanitizeMonths(settingsRes.data?.offseason_months ?? DEFAULT_OFFSEASON_MONTHS),
      },
      rows: rowsRes.data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const seasonMonths = sanitizeMonths(body?.season_months);
    const offseasonMonths = sanitizeMonths(body?.offseason_months);
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    if (seasonMonths.length === 0 || offseasonMonths.length === 0) {
      return NextResponse.json({ error: "Les mois de saison et hors saison sont requis." }, { status: 400 });
    }
    const overlap = seasonMonths.some((m) => offseasonMonths.includes(m));
    if (overlap) {
      return NextResponse.json({ error: "Un mois ne peut pas être à la fois en saison et hors saison." }, { status: 400 });
    }

    const normalizedRows: VolumeRow[] = rows
      .map((r: any, index: number) => {
        const ftemCode = String(r?.ftem_code ?? "").trim().toUpperCase();
        const levelLabel = String(r?.level_label ?? "").trim();
        const handicapLabel = String(r?.handicap_label ?? "").trim();
        const motivationText = String(r?.motivation_text ?? "").trim();
        const minRaw = r?.handicap_min;
        const maxRaw = r?.handicap_max;
        const handicapMin = minRaw === null || minRaw === "" || typeof minRaw === "undefined" ? null : Number(minRaw);
        const handicapMax = maxRaw === null || maxRaw === "" || typeof maxRaw === "undefined" ? null : Number(maxRaw);
        const minutesOffseason = Number(r?.minutes_offseason ?? 0);
        const minutesInseason = Number(r?.minutes_inseason ?? 0);

        return {
          ftem_code: ftemCode,
          level_label: levelLabel,
          handicap_label: handicapLabel,
          motivation_text: motivationText || null,
          handicap_min: Number.isFinite(handicapMin as number) ? handicapMin : null,
          handicap_max: Number.isFinite(handicapMax as number) ? handicapMax : null,
          minutes_offseason: Number.isFinite(minutesOffseason) ? Math.max(0, Math.round(minutesOffseason)) : 0,
          minutes_inseason: Number.isFinite(minutesInseason) ? Math.max(0, Math.round(minutesInseason)) : 0,
          sort_order: Number.isFinite(Number(r?.sort_order)) ? Number(r.sort_order) : (index + 1) * 10,
        } satisfies VolumeRow;
      })
      .filter((r: VolumeRow) => r.ftem_code && r.level_label);

    if (normalizedRows.length === 0) {
      return NextResponse.json({ error: "Aucune ligne valide à sauvegarder." }, { status: 400 });
    }

    const uniqueCodes = new Set(normalizedRows.map((r) => r.ftem_code));
    if (uniqueCodes.size !== normalizedRows.length) {
      return NextResponse.json({ error: "Les codes FTEM doivent être uniques." }, { status: 400 });
    }

    const { error: settingsErr } = await supabaseAdmin.from("training_volume_settings").upsert(
      {
        organization_id: clubId,
        season_months: seasonMonths,
        offseason_months: offseasonMonths,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );
    if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 400 });

    const { error: delErr } = await supabaseAdmin
      .from("training_volume_targets")
      .delete()
      .eq("organization_id", clubId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const { error: insErr } = await supabaseAdmin.from("training_volume_targets").insert(
      normalizedRows.map((row) => ({
        organization_id: clubId,
        ...row,
        updated_at: new Date().toISOString(),
      }))
    );
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
