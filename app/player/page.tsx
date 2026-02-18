"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
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

function fmtDateChip(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
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

  const [roundsMonthCount, setRoundsMonthCount] = useState(0);
  const [holesMonthCount, setHolesMonthCount] = useState(0);

  const bucket = "marketplace";
  const placeholderThumb =
    "https://images.unsplash.com/photo-1526404801122-40fc40fca08a?auto=format&fit=crop&w=300&q=60";

  const thisMonthTitle = useMemo(() => monthTitle(new Date()), []);

  const trainingsSummary = useMemo(() => {
    const totalMinutes =
      monthSessions.reduce((sum, s) => sum + (s.total_minutes ?? 0), 0) +
      monthItems.reduce((sum, i) => sum + (i.minutes ?? 0), 0);

    const count = monthSessions.length;

    const motivationAvg = avg(monthSessions.map((s) => s.motivation));
    const satisfactionAvg = avg(monthSessions.map((s) => s.satisfaction));

    const byCat: Record<string, number> = {};
    monthItems.forEach((it) => {
      byCat[it.category] = (byCat[it.category] ?? 0) + (it.minutes ?? 0);
    });

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
      formeApprox: 4.2,
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
      .select("id,first_name,last_name,handicap")
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
        const iRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes")
          .in("session_id", sIds);

        setMonthItems((iRes.data ?? []) as TrainingItemRow[]);
      } else {
        setMonthItems([]);
      }
    } else {
      setMonthSessions([]);
      setMonthItems([]);
    }

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
        const hRes = await supabase
          .from("golf_round_holes")
          .select("round_id,hole_no")
          .in("round_id", roundIds);

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
    return "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=240&q=60";
  }, []);

  const sellerLabel = useMemo(() => initialsName(profile), [profile]);

  const focusGIR = 57;
  const focusFairway = 72;
  const focusPuttingAvg = 43;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        {/* HERO */}
        <div className="player-hero">
          <div className="avatar" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt="" />
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="hero-title">{displayHello(profile)}</div>
            <div className="hero-sub">
              <span className="pill-soft">{(profile?.handicap ?? "—") + " HCP"}</span>
              <span className="pill-soft">{thisMonthTitle}</span>
            </div>
            <div className="hero-club truncate">
              {clubs[0]?.name ?? "Golf Club de Sion"}
            </div>
          </div>
        </div>

        {/* Volume d'entraînement */}
        <section className="glass-section">
          <div className="section-title">Volume d'entraînement</div>

          <div className="glass-card">
            <div className="grid-2" style={{ alignItems: "center" }}>
              <div>
                <div className="muted-uc">{thisMonthTitle}</div>
                <div style={{ marginTop: 10 }}>
                  <span className="big-number">{trainingsSummary.totalMinutes}</span>
                  <span className="unit">MIN</span>
                </div>
                <div style={{ marginTop: 10, opacity: 0.7, fontWeight: 900 }}>
                  Objectif: {trainingsSummary.objective} min
                </div>
              </div>

              <div className="donut-wrap">
                <Donut percent={trainingsSummary.percent} />
              </div>
            </div>

            <div className="hr-soft" />

            <div style={{ display: "grid", gap: 10 }}>
              {trainingsSummary.top.map((t) => (
                <div key={t.cat}>
                  <div className="bar-row">
                    <div>{t.label}</div>
                    <div>{t.minutes} min</div>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${clamp((t.minutes / topMax) * 100, 0, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link href="/player/trainings/new" className="cta-green">
            <span style={{ fontSize: 22, lineHeight: 0 }}>＋</span>
            Ajouter un entraînement
          </Link>
        </section>

        {/* Mes parcours */}
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
            <span style={{ fontSize: 22, lineHeight: 0 }}>＋</span>
            Ajouter un parcours
          </Link>
        </section>

        {/* Marketplace */}
        <section className="glass-section">
          <div className="section-title">Marketplace</div>

          <div style={{ display: "grid", gap: 10 }}>
            {loading ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>Chargement…</div>
            ) : latestItems.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>Aucune annonce pour le moment.</div>
            ) : (
              latestItems.map((it) => {
                const img = thumbByItemId[it.id] || placeholderThumb;
                const meta = [fmtDateChip(it.created_at), it.category ?? "Matériel", it.condition ?? ""]
                  .filter(Boolean)
                  .join(" • ");

                return (
                  <Link key={it.id} href={`/player/marketplace/${it.id}`} className="market-row">
                    <div className="market-thumb" aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt="" />
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div className="market-meta truncate">{meta}</div>
                      <div className="market-title truncate">{it.title}</div>

                      {/* ✅ vendeur à gauche, prix à droite */}
                      <div className="market-bottom">
                        <div className="market-seller truncate">{sellerLabel}</div>
                        <div className="market-price">{priceLabel(it)}</div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          <Link href="/player/marketplace/new" className="cta-green">
            <span style={{ fontSize: 22, lineHeight: 0 }}>＋</span>
            Ajouter un article
          </Link>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}
