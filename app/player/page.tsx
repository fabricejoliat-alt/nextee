"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null; // ✅
};

type ClubMember = { club_id: string };
type Club = { id: string; name: string | null };

type Item = {
  id: string;
  title: string;
  created_at: string;
  price: number | null;
  is_free: boolean | null;
  category: string | null;
  condition: string | null;
  brand: string | null;
  model: string | null;
  club_id: string;
};

type TrainingSessionRow = {
  id: string;
  start_at: string;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
};

type TrainingItemRow = {
  session_id: string;
  category:
    | "warmup_mobility"
    | "long_game"
    | "putting"
    | "wedging"
    | "pitching"
    | "chipping"
    | "bunker"
    | "course"
    | "mental"
    | "fitness"
    | "other";
  minutes: number;
};

const TRAINING_CAT_LABEL: Record<TrainingItemRow["category"], string> = {
  warmup_mobility: "Échauffement",
  long_game: "Long jeu",
  putting: "Putting",
  wedging: "Wedging",
  pitching: "Pitching",
  chipping: "Chipping",
  bunker: "Bunker",
  course: "Parcours",
  mental: "Mental",
  fitness: "Fitness",
  other: "Autre",
};

function displayHello(p?: Profile | null) {
  const f = (p?.first_name ?? "").trim();
  if (!f) return "Salut";
  return `Salut ${f}`;
}

function getInitials(p?: Profile | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  if (!fi && !li) return "👤";
  return `${fi}${li}`;
}

function initialsName(p?: Profile | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  if (!f && !l) return "Utilisateur";
  if (f && l) return `${f} ${l[0].toUpperCase()}.`;
  return f || l;
}

function priceLabel(it: Item) {
  if (it.is_free) return "À donner";
  if (it.price == null) return "—";
  return `${it.price} CHF`;
}

function compactMeta(it: Item) {
  const parts: string[] = [];
  if (it.category) parts.push(it.category);
  if (it.condition) parts.push(it.condition);

  const bm = `${it.brand ?? ""} ${it.model ?? ""}`.trim();
  if (bm) parts.push(bm);

  return parts.join(" • ");
}

function truncate(s: string, max: number) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function avg(values: Array<number | null>) {
  const v = values.filter((x): x is number => typeof x === "number");
  if (v.length === 0) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return Math.round((sum / v.length) * 10) / 10;
}

function monthRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function monthTitle(now = new Date()) {
  return new Intl.DateTimeFormat("fr-CH", {
    month: "long",
    year: "numeric",
  })
    .format(now)
    .toUpperCase();
}

function Donut({ percent }: { percent: number }) {
  const p = clamp(percent, 0, 100);
  const r = 54;
  const c = 2 * Math.PI * r;

  const [animatedP, setAnimatedP] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimatedP(p), 60);
    return () => clearTimeout(t);
  }, [p]);

  const dash = (animatedP / 100) * c;
  const done = p >= 100;

  return (
    <svg width="150" height="150" viewBox="0 0 140 140" aria-label={`Progression ${p}%`}>
      <defs>
        <linearGradient id="donutGrad" x1="70" y1="16" x2="124" y2="124" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--green-light)" />
          <stop offset="100%" stopColor="var(--green-dark)" />
        </linearGradient>
      </defs>

      <circle cx="70" cy="70" r={r} strokeWidth="14" className="donut-bg" fill="rgba(255,255,255,0.22)" />

      <circle
        cx="70"
        cy="70"
        r={r}
        strokeWidth="14"
        className="donut-fg"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 70 70)"
      />

      <text x="70" y="79" textAnchor="middle" className="donut-label">
        {Math.round(p)}%
      </text>

      <g className={`donut-check-wrap ${done ? "on" : ""}`}>
        <circle className="donut-check-circle" cx="70" cy="108" r={done ? 16 : 12} />
        <path className="donut-check" d="M64 110 l4 4 l9 -10" />
      </g>
    </svg>
  );
}

export default function PlayerHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubIds, setClubIds] = useState<string[]>([]);

  const [latestItems, setLatestItems] = useState<Item[]>([]);
  const [thumbByItemId, setThumbByItemId] = useState<Record<string, string>>({});

  const [monthSessions, setMonthSessions] = useState<TrainingSessionRow[]>([]);
  const [monthItems, setMonthItems] = useState<TrainingItemRow[]>([]);

  const [roundsMonthCount, setRoundsMonthCount] = useState<number>(0);
  const [holesMonthCount, setHolesMonthCount] = useState<number>(0);

  const bucket = "marketplace";

  const placeholderThumb = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="180">
        <rect width="100%" height="100%" fill="#f3f4f6"/>
        <path d="M70 118l28-28 26 26 18-18 28 28" fill="none" stroke="#9ca3af" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="92" cy="78" r="10" fill="#9ca3af"/>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const thisMonthTitle = useMemo(() => monthTitle(new Date()), []);

  const heroClubLine = useMemo(() => {
    const names = clubs.map((c) => c.name).filter(Boolean) as string[];
    if (names.length === 0) return "—";
    return names.join(" • ");
  }, [clubs]);

  const handicapDelta = -0.4;

  const trainingsSummary = useMemo(() => {
    const totalMinutes = monthSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    const count = monthSessions.length;

    const motivationAvg = avg(monthSessions.map((s) => s.motivation));
    const satisfactionAvg = avg(monthSessions.map((s) => s.satisfaction));
    const difficultyAvg = avg(monthSessions.map((s) => s.difficulty));

    const formeApprox = difficultyAvg == null ? null : Math.round((6.2 - difficultyAvg) * 10) / 10;

    const byCat: Record<string, number> = {};
    for (const it of monthItems) byCat[it.category] = (byCat[it.category] ?? 0) + (it.minutes || 0);

    const top = Object.entries(byCat)
      .map(([cat, minutes]) => ({
        cat: cat as TrainingItemRow["category"],
        label: TRAINING_CAT_LABEL[cat as TrainingItemRow["category"]] ?? cat,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 3);

    const objective = 500;
    const percent = objective > 0 ? (totalMinutes / objective) * 100 : 0;

    return {
      totalMinutes,
      count,
      objective,
      percent,
      top,
      motivationAvg,
      satisfactionAvg,
      formeApprox,
    };
  }, [monthSessions, monthItems]);

  const topMax = useMemo(() => {
    const m = trainingsSummary.top.reduce((max, x) => Math.max(max, x.minutes), 0);
    return m || 1;
  }, [trainingsSummary.top]);

  async function load() {
    setLoading(true);
    setError(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError("Session invalide.");
      setLoading(false);
      return;
    }
    const uid = userRes.user.id;

    const profRes = await supabase
      .from("profiles")
      .select("id,first_name,last_name,handicap,avatar_url")
      .eq("id", uid)
      .maybeSingle();

    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      return;
    }
    setProfile((profRes.data ?? null) as Profile | null);

    const memRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", uid)
      .eq("is_active", true);

    if (memRes.error) {
      setError(memRes.error.message);
      setClubs([]);
      setClubIds([]);
      setLatestItems([]);
      setThumbByItemId({});
      setMonthSessions([]);
      setMonthItems([]);
      setLoading(false);
      return;
    }

    const cids = ((memRes.data ?? []) as ClubMember[]).map((m) => m.club_id).filter(Boolean);
    setClubIds(cids);

    if (cids.length > 0) {
      const clubsRes = await supabase.from("clubs").select("id,name").in("id", cids);
      if (!clubsRes.error) setClubs((clubsRes.data ?? []) as Club[]);
      else setClubs(cids.map((id) => ({ id, name: null })));
    } else {
      setClubs([]);
    }

    // Latest marketplace items
    if (cids.length > 0) {
      const itemsRes = await supabase
        .from("marketplace_items")
        .select("id,title,created_at,price,is_free,category,condition,brand,model,club_id")
        .in("club_id", cids)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(3);

      if (itemsRes.error) {
        setLatestItems([]);
        setThumbByItemId({});
      } else {
        const list = (itemsRes.data ?? []) as Item[];
        setLatestItems(list);

        const ids = list.map((x) => x.id);
        if (ids.length > 0) {
          const imgRes = await supabase
            .from("marketplace_images")
            .select("item_id,path,sort_order")
            .in("item_id", ids)
            .eq("sort_order", 0);

          if (!imgRes.error) {
            const map: Record<string, string> = {};
            (imgRes.data ?? []).forEach((r: any) => {
              const { data } = supabase.storage.from(bucket).getPublicUrl(r.path);
              if (data?.publicUrl) map[r.item_id] = data.publicUrl;
            });
            setThumbByItemId(map);
          } else {
            setThumbByItemId({});
          }
        } else {
          setThumbByItemId({});
        }
      }
    } else {
      setLatestItems([]);
      setThumbByItemId({});
    }

    // Trainings month
    const { start, end } = monthRangeLocal(new Date());
    const sRes = await supabase
      .from("training_sessions")
      .select("id,start_at,total_minutes,motivation,difficulty,satisfaction")
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .order("start_at", { ascending: false });

    if (!sRes.error) {
      const sess = (sRes.data ?? []) as TrainingSessionRow[];
      setMonthSessions(sess);

      const sIds = sess.map((s) => s.id);
      if (sIds.length > 0) {
        const iRes = await supabase.from("training_session_items").select("session_id,category,minutes").in(
          "session_id",
          sIds
        );
        setMonthItems((iRes.data ?? []) as TrainingItemRow[]);
      } else {
        setMonthItems([]);
      }
    } else {
      setMonthSessions([]);
      setMonthItems([]);
    }

    // Rounds month
    try {
      const { start, end } = monthRangeLocal(new Date());
      const rRes = await supabase
        .from("golf_rounds")
        .select("id,start_at")
        .gte("start_at", start.toISOString())
        .lt("start_at", end.toISOString())
        .order("start_at", { ascending: false });

      const rounds = (rRes.data ?? []) as Array<{ id: string }>;
      setRoundsMonthCount(rounds.length);

      if (rounds.length > 0) {
        const roundIds = rounds.map((r) => r.id);
        const hRes = await supabase.from("golf_round_holes").select("round_id,hole_no").in("round_id", roundIds);
        setHolesMonthCount((hRes.data ?? []).length);
      } else {
        setHolesMonthCount(0);
      }
    } catch {
      setRoundsMonthCount(0);
      setHolesMonthCount(0);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const avatarUrl = useMemo(() => {
  const base = profile?.avatar_url?.trim() || "";
  if (!base) return null;
  return `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
}, [profile?.avatar_url]);

  const focusGIR = 57;
  const focusFairway = 72;
  const focusPuttingAvg = 43;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        <div className="player-hero">
          <div className="avatar" aria-hidden="true" style={{ overflow: "hidden" }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 28,
                  letterSpacing: 1,
                  color: "white",
                  background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                }}
              >
                {getInitials(profile)}
              </div>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="hero-title">{loading ? "Salut…" : `${displayHello(profile)} 👋`}</div>

            <div className="hero-sub">
              <div>Handicap {typeof profile?.handicap === "number" ? profile.handicap.toFixed(1) : "—"}</div>
              <div className="delta-pill">{handicapDelta >= 0 ? `+${handicapDelta}` : `${handicapDelta}`}</div>
            </div>

            <div className="hero-club truncate">{heroClubLine}</div>
          </div>
        </div>

        {error && <div style={{ marginTop: 10, color: "#ffd1d1", fontWeight: 800 }}>{error}</div>}

        {/* ===== Volume d’entrainement ===== */}
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">Volume d’entraînement</div>

          <div className="glass-card">
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12, alignItems: "center" }}>
              <div>
                <div className="muted-uc">{thisMonthTitle}</div>

                <div style={{ marginTop: 6 }}>
                  <span className="big-number">{trainingsSummary.totalMinutes}</span>
                  <span className="unit">MINUTES</span>
                </div>

                <div className="hr-soft" />

                <div style={{ fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>
                  Objectif : {trainingsSummary.objective} min
                </div>

                <div style={{ marginTop: 10 }}>
                  <span className="pill-soft">⛳ {trainingsSummary.count} séances</span>
                </div>
              </div>

              <div className="donut-wrap">
                <Donut percent={trainingsSummary.percent} />
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 12 }}>
            {/* Top secteurs */}
            <div className="glass-card">
              <div className="card-title">Top Secteurs</div>

              {trainingsSummary.top.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Pas encore de données ce mois-ci.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {trainingsSummary.top.map((x) => {
                    const w = Math.round((x.minutes / topMax) * 100);
                    return (
                      <div key={x.cat}>
                        <div className="bar-row">
                          <div>{x.label}</div>
                          <div>{x.minutes}min</div>
                        </div>
                        <div className="bar">
                          <span style={{ width: `${w}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sensations */}
            <div className="glass-card">
              <div className="card-title">Sensations</div>

              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div className="sense-row">
                    <div>Motivation</div>
                    <div className="sense-val up">▲ {trainingsSummary.motivationAvg ?? "—"}</div>
                  </div>
                  <div className="bar">
                    <span
                      style={{
                        width: `${clamp(((trainingsSummary.motivationAvg ?? 0) / 6) * 100, 0, 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="sense-row">
                    <div>Satisfaction</div>
                    <div className="sense-val up">▲ {trainingsSummary.satisfactionAvg ?? "—"}</div>
                  </div>
                  <div className="bar">
                    <span
                      style={{
                        width: `${clamp(((trainingsSummary.satisfactionAvg ?? 0) / 6) * 100, 0, 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="sense-row">
                    <div>Forme</div>
                    <div className="sense-val down">▼ {trainingsSummary.formeApprox ?? "—"}</div>
                  </div>
                  <div className="bar">
                    <span
                      style={{
                        width: `${clamp(((trainingsSummary.formeApprox ?? 0) / 6) * 100, 0, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Link href="/player/trainings/new" className="cta-green">
            <span style={{ fontSize: 20, lineHeight: 0 }}>＋</span>
            Ajouter un entraînement
          </Link>
        </section>

        {/* ===== Mes parcours ===== */}
        <section className="glass-section">
          <div className="section-title">Mes parcours</div>

          <div className="grid-2">
            <div className="glass-card">
              <div className="muted-uc">{thisMonthTitle}</div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <div>
                  <span className="big-number">{roundsMonthCount}</span>
                  <span className="unit">PARCOURS</span>
                </div>
                <div>
                  <span className="big-number">{holesMonthCount}</span>
                  <span className="unit">TROUS</span>
                </div>
              </div>
            </div>

            <div className="glass-card">
              <div className="muted-uc">FOCUS</div>
              <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                <div className="sense-row">
                  <div>GIR</div>
                  <div className="sense-val up">▲ {focusGIR}%</div>
                </div>
                <div className="sense-row">
                  <div>Putting Avg</div>
                  <div className="sense-val down">▲ {focusPuttingAvg}</div>
                </div>
                <div className="sense-row">
                  <div>FAIRWAY</div>
                  <div className="sense-val up">▲ {focusFairway}%</div>
                </div>
              </div>
            </div>
          </div>

          <Link href="/player/golf/rounds/new" className="cta-green">
            <span style={{ fontSize: 20, lineHeight: 0 }}>＋</span>
            Ajouter un parcours
          </Link>
        </section>

        {/* ===== Marketplace ===== */}
        <section className="glass-section">
          <div className="section-title">Marketplace</div>

          {loading ? (
            <div style={{ opacity: 0.8, fontWeight: 800 }}>Chargement…</div>
          ) : latestItems.length === 0 ? (
            <div style={{ opacity: 0.8, fontWeight: 800 }}>Aucune annonce pour le moment.</div>
          ) : (
            <div className="marketplace-list" style={{ marginTop: 10 }}>
              {latestItems.map((it) => {
                const img = thumbByItemId[it.id] || placeholderThumb;
                const meta = compactMeta(it);

                return (
                  <Link key={it.id} href={`/player/marketplace/${it.id}`} className="marketplace-link">
                    <div className="marketplace-item">
                      <div className="marketplace-row">
                        <div className="marketplace-thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={it.title} loading="lazy" />
                        </div>

                        <div className="marketplace-body">
                          <div className="marketplace-item-title">{truncate(it.title, 80)}</div>

                          {meta && <div className="marketplace-meta">{meta}</div>}

                          <div className="marketplace-price-row">
                            <div className="marketplace-price-pill">{priceLabel(it)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <Link href="/player/marketplace/new" className="cta-green">
            <span style={{ fontSize: 20, lineHeight: 0 }}>＋</span>
            Publier une annonce
          </Link>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}
