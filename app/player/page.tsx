"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { PlusCircle } from "lucide-react";

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

type GolfRoundRow = { id: string; start_at: string };
type GolfHoleRow = { round_id: string; hole_no: number; par: number | null; score: number | null; putts: number | null; fairway_hit: boolean | null };

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
  return new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(now).toUpperCase();
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

/** Flèche uniquement (comme sensations) */
function ArrowOnly({ delta }: { delta: number | null }) {
  if (delta == null || !Number.isFinite(delta)) return <span className="sense-val">—</span>;
  const up = delta > 0;
  const down = delta < 0;
  const cls = up ? "sense-val up" : down ? "sense-val down" : "sense-val";
  const sign = up ? "▲" : down ? "▼" : "•";
  return <span className={cls}>{sign}</span>;
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

  // ✅ Parcours du mois (liste ids) + trous (pour stats focus)
  const [roundsMonth, setRoundsMonth] = useState<GolfRoundRow[]>([]);
  const [holesMonth, setHolesMonth] = useState<GolfHoleRow[]>([]);

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

  const trainingsSummary = useMemo(() => {
    const totalMinutes = monthSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    const count = monthSessions.length;

    const motivationAvg = avg(monthSessions.map((s) => s.motivation));
    const satisfactionAvg = avg(monthSessions.map((s) => s.satisfaction));
    const difficultyAvg = avg(monthSessions.map((s) => s.difficulty));

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

    // ✅ Dernière séance (la plus récente)
    const last = monthSessions?.[0] ?? null;

    const deltaMotivation =
      typeof last?.motivation === "number" && typeof motivationAvg === "number" ? Math.round((last.motivation - motivationAvg) * 10) / 10 : null;

    const deltaDifficulty =
      typeof last?.difficulty === "number" && typeof difficultyAvg === "number" ? Math.round((last.difficulty - difficultyAvg) * 10) / 10 : null;

    const deltaSatisfaction =
      typeof last?.satisfaction === "number" && typeof satisfactionAvg === "number" ? Math.round((last.satisfaction - satisfactionAvg) * 10) / 10 : null;

    return {
      totalMinutes,
      count,
      objective,
      percent,
      top,
      motivationAvg,
      difficultyAvg,
      satisfactionAvg,
      deltaMotivation,
      deltaDifficulty,
      deltaSatisfaction,
    };
  }, [monthSessions, monthItems]);

  const topMax = useMemo(() => {
    const m = trainingsSummary.top.reduce((max, x) => Math.max(max, x.minutes), 0);
    return m || 1;
  }, [trainingsSummary.top]);

  // ===== Focus stats calculées à partir des trous du mois + trends vs mois précédent (flèche seulement) =====
  const { start: curStart, end: curEnd } = useMemo(() => monthRangeLocal(new Date()), []);
  const prevRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start, end };
  }, []);

  const [prevHoles, setPrevHoles] = useState<GolfHoleRow[]>([]);

  const focus = useMemo(() => {
    // Fairways: par4/5 où fairway_hit non null
    let fwTot = 0;
    let fwHit = 0;

    // Putts: moyenne par trou (si renseigné)
    const puttVals: number[] = [];

    // GIR: approximation (si tu ne stockes pas "gir" par trou)
    // => on calcule UNIQUEMENT fairways/putts ici (solide avec holes),
    // et on laisse GIR à "—" si pas de champ fiable.
    // Si tu veux un vrai GIR: utilise golf_rounds.gir côté API (comme sur dashboard).
    // Ici on met GIR à null.
    const girPct: number | null = null;

    for (const h of holesMonth) {
      if (typeof h.putts === "number") puttVals.push(h.putts);

      // fairways: par4/5 + bool présent
      if (typeof h.par === "number" && h.par >= 4 && typeof h.fairway_hit === "boolean") {
        fwTot += 1;
        if (h.fairway_hit) fwHit += 1;
      }
    }

    const fwPct = fwTot ? Math.round((fwHit / fwTot) * 1000) / 10 : null;
    const puttAvg = puttVals.length ? Math.round((puttVals.reduce((a, b) => a + b, 0) / puttVals.length) * 10) / 10 : null;

    return { girPct, fwPct, puttAvg };
  }, [holesMonth]);

  const prevFocus = useMemo(() => {
    let fwTot = 0;
    let fwHit = 0;
    const puttVals: number[] = [];
    const girPct: number | null = null;

    for (const h of prevHoles) {
      if (typeof h.putts === "number") puttVals.push(h.putts);
      if (typeof h.par === "number" && h.par >= 4 && typeof h.fairway_hit === "boolean") {
        fwTot += 1;
        if (h.fairway_hit) fwHit += 1;
      }
    }

    const fwPct = fwTot ? Math.round((fwHit / fwTot) * 1000) / 10 : null;
    const puttAvg = puttVals.length ? Math.round((puttVals.reduce((a, b) => a + b, 0) / puttVals.length) * 10) / 10 : null;

    return { girPct, fwPct, puttAvg };
  }, [prevHoles]);

  const focusDelta = useMemo(() => {
    const d = (cur: number | null, prev: number | null) => {
      if (cur == null || prev == null) return null;
      const v = cur - prev;
      return v === 0 ? 0 : v;
    };
    return {
      gir: d(focus.girPct, prevFocus.girPct), // null si GIR non calculé
      fw: d(focus.fwPct, prevFocus.fwPct),
      putt: d(focus.puttAvg, prevFocus.puttAvg),
    };
  }, [focus, prevFocus]);

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

    const profRes = await supabase.from("profiles").select("id,first_name,last_name,handicap,avatar_url").eq("id", uid).maybeSingle();
    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      return;
    }
    setProfile((profRes.data ?? null) as Profile | null);

    const memRes = await supabase.from("club_members").select("club_id").eq("user_id", uid).eq("is_active", true);
    if (memRes.error) {
      setError(memRes.error.message);
      setClubs([]);
      setClubIds([]);
      setLatestItems([]);
      setThumbByItemId({});
      setMonthSessions([]);
      setMonthItems([]);
      setRoundsMonth([]);
      setHolesMonth([]);
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
          const imgRes = await supabase.from("marketplace_images").select("item_id,path,sort_order").in("item_id", ids).eq("sort_order", 0);

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

    // Trainings month (⚠️ tu avais oublié le filtre user_id)
    const { start, end } = monthRangeLocal(new Date());
    const sRes = await supabase
      .from("training_sessions")
      .select("id,start_at,total_minutes,motivation,difficulty,satisfaction")
      .eq("user_id", uid)
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .order("start_at", { ascending: false });

    if (!sRes.error) {
      const sess = (sRes.data ?? []) as TrainingSessionRow[];
      setMonthSessions(sess);

      const sIds = sess.map((s) => s.id);
      if (sIds.length > 0) {
        const iRes = await supabase.from("training_session_items").select("session_id,category,minutes").in("session_id", sIds);
        setMonthItems((iRes.data ?? []) as TrainingItemRow[]);
      } else {
        setMonthItems([]);
      }
    } else {
      setMonthSessions([]);
      setMonthItems([]);
    }

    // Rounds month + holes month + prev month holes (for trends)
    try {
      // current month rounds
      const rRes = await supabase
        .from("golf_rounds")
        .select("id,start_at")
        .eq("user_id", uid)
        .gte("start_at", curStart.toISOString())
        .lt("start_at", curEnd.toISOString())
        .order("start_at", { ascending: false });

      const rList = (rRes.data ?? []) as GolfRoundRow[];
      setRoundsMonth(rList);

      if (rList.length > 0) {
        const roundIds = rList.map((r) => r.id);
        const hRes = await supabase.from("golf_round_holes").select("round_id,hole_no,par,score,putts,fairway_hit").in("round_id", roundIds);
        setHolesMonth((hRes.data ?? []) as GolfHoleRow[]);
      } else {
        setHolesMonth([]);
      }

      // previous month rounds -> holes
      const prRes = await supabase
        .from("golf_rounds")
        .select("id,start_at")
        .eq("user_id", uid)
        .gte("start_at", prevRange.start.toISOString())
        .lt("start_at", prevRange.end.toISOString())
        .order("start_at", { ascending: false });

      const prList = (prRes.data ?? []) as GolfRoundRow[];
      if (prList.length > 0) {
        const prIds = prList.map((r) => r.id);
        const phRes = await supabase.from("golf_round_holes").select("round_id,hole_no,par,score,putts,fairway_hit").in("round_id", prIds);
        setPrevHoles((phRes.data ?? []) as GolfHoleRow[]);
      } else {
        setPrevHoles([]);
      }
    } catch {
      setRoundsMonth([]);
      setHolesMonth([]);
      setPrevHoles([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avatarUrl = useMemo(() => {
    const base = profile?.avatar_url?.trim() || "";
    if (!base) return null;
    return `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }, [profile?.avatar_url]);

  // helpers pour sensations (▲▼ + valeur) — on garde tel quel
  function deltaLabel(d: number | null) {
    if (typeof d !== "number") return "—";
    const abs = Math.abs(d).toFixed(1);
    if (d > 0) return `▲ +${abs}`;
    if (d < 0) return `▼ -${abs}`;
    return `• ${abs}`;
  }
  function deltaClass(d: number | null) {
    if (typeof d !== "number") return "sense-val";
    if (d > 0) return "sense-val up";
    if (d < 0) return "sense-val down";
    return "sense-val";
  }

  const roundsMonthCount = roundsMonth.length;
  const holesMonthCount = holesMonth.length;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        <div className="player-hero">
          <div className="avatar" aria-hidden="true" style={{ overflow: "hidden" }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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

                <div style={{ fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>Objectif : {trainingsSummary.objective} min</div>

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
                    <div className={deltaClass(trainingsSummary.deltaMotivation)}>{deltaLabel(trainingsSummary.deltaMotivation)}</div>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${clamp(((trainingsSummary.motivationAvg ?? 0) / 6) * 100, 0, 100)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="sense-row">
                    <div>Difficulté</div>
                    <div className={deltaClass(trainingsSummary.deltaDifficulty)}>{deltaLabel(trainingsSummary.deltaDifficulty)}</div>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${clamp(((trainingsSummary.difficultyAvg ?? 0) / 6) * 100, 0, 100)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="sense-row">
                    <div>Satisfaction</div>
                    <div className={deltaClass(trainingsSummary.deltaSatisfaction)}>{deltaLabel(trainingsSummary.deltaSatisfaction)}</div>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${clamp(((trainingsSummary.satisfactionAvg ?? 0) / 6) * 100, 0, 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Link href="/player/trainings/new" className="cta-green">
            <PlusCircle size={18} />
            Ajouter un entraînement
          </Link>
        </section>

        {/* ===== ✅ Volume de jeu + Focus en dessous ===== */}
        <section className="glass-section">
          <div className="section-title">Volume de jeu</div>

          {/* ✅ Card Volume (1 ligne) */}
          <div className="glass-card">
            <div className="muted-uc">{thisMonthTitle}</div>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.55)",
                  borderRadius: 14,
                  padding: "12px 12px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.62)" }}>Parcours</div>
                <div style={{ marginTop: 6 }}>
                  <span className="big-number">{roundsMonthCount}</span>
                  <span className="unit">MOIS</span>
                </div>
              </div>

              <div
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.55)",
                  borderRadius: 14,
                  padding: "12px 12px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.62)" }}>Trous</div>
                <div style={{ marginTop: 6 }}>
                  <span className="big-number">{holesMonthCount}</span>
                  <span className="unit">MOIS</span>
                </div>
              </div>
            </div>
          </div>

          {/* ✅ Card Focus (en dessous + plus grande) */}
          <div className="glass-card" style={{ marginTop: 12 }}>
            <div className="card-title">Focus (tendance vs mois précédent)</div>

            <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
              <div className="sense-row">
                <div>Greens en régulation</div>
                <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <div className="sense-val">{focus.girPct == null ? "—" : `${focus.girPct}%`}</div>
                  <ArrowOnly delta={focusDelta.gir} />
                </div>
              </div>

              <div className="sense-row">
                <div>Moyenne de putt</div>
                <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <div className="sense-val">{focus.puttAvg == null ? "—" : `${focus.puttAvg}`}</div>
                  <ArrowOnly delta={focusDelta.putt} />
                </div>
              </div>

              <div className="sense-row">
                <div>Fairways touchés</div>
                <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <div className="sense-val">{focus.fwPct == null ? "—" : `${focus.fwPct}%`}</div>
                  <ArrowOnly delta={focusDelta.fw} />
                </div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.4 }}>
                Les flèches comparent au mois précédent (si suffisamment de données).
                <br />
                GIR n’est pas calculé ici si tu ne le stockes pas par trou. Si tu veux un vrai GIR, on peut le lire depuis <code>golf_rounds.gir</code> (comme sur ton Dashboard).
              </div>
            </div>
          </div>

          <Link href="/player/golf/rounds/new" className="cta-green">
            <PlusCircle size={18} />
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
            <PlusCircle size={18} />
            Publier une annonce
          </Link>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}