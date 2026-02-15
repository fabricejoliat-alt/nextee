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

export default function PlayerHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [latestItems, setLatestItems] = useState<Item[]>([]);
  const [thumbByItemId, setThumbByItemId] = useState<Record<string, string>>({});

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

  const subtitle = useMemo(() => {
    const hc = profile?.handicap;
    if (typeof hc === "number") return `Ton espace joueur`;
    return "Ton espace joueur";
  }, [profile]);

  const handicapText = useMemo(() => {
    const hc = profile?.handicap;
    if (typeof hc !== "number") return null;
    // format simple
    return `HCP ${hc}`;
  }, [profile]);

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
      setLoading(false);
      return;
    }

    // 3) Fetch clubs names (sans FK)
    const clubsRes = await supabase
      .from("clubs")
      .select("id,name")
      .in("id", clubIds);

    if (clubsRes.error) {
      setError(clubsRes.error.message);
      setClubs(clubIds.map((id) => ({ id, name: null })));
    } else {
      setClubs((clubsRes.data ?? []) as Club[]);
    }

    // 4) 3 dernières annonces de TOUS ses clubs actifs
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
      {/* Hero */}
<div className="card" style={{ padding: 18 }}>
  {loading ? (
    <div>Chargement…</div>
  ) : (
    <>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>
          {displayHello(profile)}
        </div>

        <div style={{ color: "var(--muted)", fontWeight: 800 }}>
          Ton espace joueur
          {typeof profile?.handicap === "number" && (
            <> • Handicap {profile.handicap}</>
          )}
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


      {/* Actions */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Raccourcis</div>

        <div className="dash-grid">
          <DashCard title="Mon Golf" desc="Stats & entraînements" href="/player/golf" disabled />
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
