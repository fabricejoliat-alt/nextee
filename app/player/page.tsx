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

type ClubMember = {
  club_id: string;
};

type Club = {
  id: string;
  name: string | null;
};

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
  total_minutes: number;
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
  warmup_mobility: "Échauffement / mobilité",
  long_game: "Long jeu",
  putting: "Putting",
  wedging: "Wedging",
  pitching: "Pitching",
  chipping: "Chipping",
  bunker: "Bunker",
  course: "Parcours",
  mental: "Préparation mentale",
  fitness: "Fitness / musculation",
  other: "Autre activité",
};

function displayHello(p?: Profile | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  if (!f && !l) return "Bienvenue";
  if (f) return `Salut ${f}`;
  return `Salut`;
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

function fmtMonthTitle(d = new Date()) {
  return new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" }).format(d);
}

export default function PlayerHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [latestItems, setLatestItems] = useState<Item[]>([]);
  const [thumbByItemId, setThumbByItemId] = useState<Record<string, string>>({});

  // Trainings (month summary)
  const [monthSessions, setMonthSessions] = useState<TrainingSessionRow[]>([]);
  const [monthItems, setMonthItems] = useState<TrainingItemRow[]>([]);

  const bucket = "marketplace";

  const placeholderSvg = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="180">
        <rect width="100%" height="100%" fill="#f3f4f6"/>
        <path d="M70 118l28-28 26 26 18-18 28 28" fill="none" stroke="#9ca3af" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="92" cy="78" r="10" fill="#9ca3af"/>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const monthTitle = useMemo(() => fmtMonthTitle(new Date()), []);

  const trainingsSummary = useMemo(() => {
    const totalMinutes = monthSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    const count = monthSessions.length;

    const motivationAvg = avg(monthSessions.map((s) => s.motivation));
    const difficultyAvg = avg(monthSessions.map((s) => s.difficulty));
    const satisfactionAvg = avg(monthSessions.map((s) => s.satisfaction));

    const byCat: Record<string, number> = {};
    for (const it of monthItems) {
      byCat[it.category] = (byCat[it.category] ?? 0) + (it.minutes || 0);
    }

    const topCats = Object.entries(byCat)
      .map(([cat, minutes]) => ({
        cat: cat as TrainingItemRow["category"],
        label: TRAINING_CAT_LABEL[cat as TrainingItemRow["category"]] ?? cat,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 4);

    return {
      totalMinutes,
      count,
      motivationAvg,
      difficultyAvg,
      satisfactionAvg,
      topCats,
    };
  }, [monthSessions, monthItems]);

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

    // 1) Profile
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

    // 2) Club memberships (sans FK)
    const memRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", uid)
      .eq("is_active", true);

    if (memRes.error) {
      setError(memRes.error.message);
      setClubs([]);
      setLatestItems([]);
      setThumbByItemId({});
      setMonthSessions([]);
      setMonthItems([]);
      setLoading(false);
      return;
    }

    const clubIds = ((memRes.data ?? []) as ClubMember[])
      .map((m) => m.club_id)
      .filter(Boolean);

    if (clubIds.length === 0) {
      setClubs([]);
      setLatestItems([]);
      setThumbByItemId({});
      setMonthSessions([]);
      setMonthItems([]);
      setLoading(false);
      return;
    }

    // 3) Fetch clubs names (sans FK)
    const clubsRes = await supabase.from("clubs").select("id,name").in("id", clubIds);

    if (clubsRes.error) {
      setError(clubsRes.error.message);
      setClubs(clubIds.map((id) => ({ id, name: null })));
    } else {
      setClubs((clubsRes.data ?? []) as Club[]);
    }

    // 4) 3 dernières annonces (tous ses clubs actifs)
    const itemsRes = await supabase
      .from("marketplace_items")
      .select("id,title,created_at,price,is_free,category,condition,brand,model,club_id")
      .in("club_id", clubIds)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(3);

    if (itemsRes.error) {
      setError(itemsRes.error.message);
      setLatestItems([]);
      setThumbByItemId({});
      setLoading(false);
      return;
    }

    const list = (itemsRes.data ?? []) as Item[];
    setLatestItems(list);

    // 5) thumbnails (sort_order 0)
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

    // 6) Trainings month summary
    const { start, end } = monthRangeLocal(new Date());

    const sRes = await supabase
      .from("training_sessions")
      .select("id,start_at,total_minutes,motivation,difficulty,satisfaction")
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .order("start_at", { ascending: false });

    if (sRes.error) {
      // On n’empêche pas le reste de fonctionner
      setMonthSessions([]);
      setMonthItems([]);
    } else {
      const sess = (sRes.data ?? []) as TrainingSessionRow[];
      setMonthSessions(sess);

      const sIds = sess.map((s) => s.id);
      if (sIds.length > 0) {
        const iRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes")
          .in("session_id", sIds);

        if (!iRes.error) {
          setMonthItems((iRes.data ?? []) as TrainingItemRow[]);
        } else {
          setMonthItems([]);
        }
      } else {
        setMonthItems([]);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function clubNameById(id: string) {
    const c = clubs.find((x) => x.id === id);
    return c?.name ?? "Club";
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Hero */}
      <div className="card" style={{ padding: 18 }}>
        {loading ? (
          <div>Chargement…</div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{displayHello(profile)}</div>

              <div style={{ color: "var(--muted)", fontWeight: 800 }}>
                Ton espace joueur
                {typeof profile?.handicap === "number" && <> • Handicap {profile.handicap}</>}
              </div>

              {clubs.length > 0 && (
                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
                  {clubs.map((c) => c.name ?? "Club").join(" • ")}
                </div>
              )}
            </div>

            {error && <div style={{ marginTop: 12, color: "#a00" }}>{error}</div>}
          </>
        )}
      </div>

      {/* Résumé du mois + cartouche "Mes entraînements" */}
      <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900 }}>Résumé — {monthTitle}</div>
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
              Volume : {trainingsSummary.totalMinutes} min • Séances : {trainingsSummary.count}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/player/golf/rounds">Mes parcours</Link>
            <Link className="btn" href="/player/trainings/new">
              Ajouter un entraînement
            </Link>
            <Link className="btn" href="/player/trainings">
              Mes entraînements
            </Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 14, padding: 12 }}>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12 }}>Sensations</div>
            <div style={{ marginTop: 8, display: "grid", gap: 6, color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
              <div>Motivation : {trainingsSummary.motivationAvg ?? "—"} / 6</div>
              <div>Difficulté : {trainingsSummary.difficultyAvg ?? "—"} / 6</div>
              <div>Satisfaction : {trainingsSummary.satisfactionAvg ?? "—"} / 6</div>
            </div>
          </div>

          <div style={{ border: "1px solid #e8e8e8", borderRadius: 14, padding: 12 }}>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12 }}>Top catégories</div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {trainingsSummary.topCats.length === 0 ? (
                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
                  Ajoute des postes pour voir la répartition.
                </div>
              ) : (
                trainingsSummary.topCats.map((c) => (
                  <div key={c.cat} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{c.label}</div>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{c.minutes} min</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions (tes raccourcis) */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Raccourcis</div>

        <div className="dash-grid">
          <DashCard title="Mon Golf" desc="Résumé & entraînements" href="/player/golf" />
          <DashCard title="Calendrier" desc="Tournois & entraînements" href="/player/calendar" disabled />
          <DashCard title="Marketplace" desc="Annonces de tes clubs" href="/player/marketplace" />
          <DashCard title="Mon profil" desc="Mettre à jour tes infos" href="/player/profile" />
        </div>
      </div>

      {/* Dernières annonces */}
      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 900 }}>Dernières annonces</div>
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
              Les 3 plus récentes (tous tes clubs)
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/player/marketplace/mine">
              Mes annonces
            </Link>
            <Link className="btn" href="/player/marketplace/new">
              Publier
            </Link>
            <Link className="btn" href="/player/marketplace">
              Tout voir
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {loading ? (
            <div style={{ color: "var(--muted)" }}>Chargement…</div>
          ) : latestItems.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>Aucune annonce pour le moment.</div>
          ) : (
            latestItems.map((it) => {
              const img = thumbByItemId[it.id] || placeholderSvg;
              const meta = compactMeta(it);

              return (
                <Link key={it.id} href={`/player/marketplace/${it.id}`} className="latest-item">
                  <div className="latest-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt={it.title} />
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900, minWidth: 0 }} className="truncate">
                        {it.title}
                      </div>
                      <div style={{ fontWeight: 900 }}>{priceLabel(it)}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="pill">{clubNameById(it.club_id)}</span>
                      {meta && (
                        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }} className="truncate">
                          {meta}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function DashCard({
  title,
  desc,
  href,
  disabled,
}: {
  title: string;
  desc: string;
  href: string;
  disabled?: boolean;
}) {
  const inner = (
    <div className={`dash-card ${disabled ? "disabled" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>{title}</div>
        {disabled && <span className="dash-badge soon">Bientôt</span>}
      </div>
      <div style={{ color: "var(--muted)", fontWeight: 700, marginTop: 6, fontSize: 13 }}>{desc}</div>
    </div>
  );

  if (disabled) return <div>{inner}</div>;

  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Link>
  );
}
