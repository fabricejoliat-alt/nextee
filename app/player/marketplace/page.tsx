"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Item = {
  id: string;
  created_at: string;
  club_id: string;
  user_id: string;

  title: string;
  description: string | null;
  price: number | null;
  is_free: boolean | null;
  is_active: boolean;

  category: string | null;
  condition: string | null;
  brand: string | null;
  model: string | null;
  delivery: string | null;
};

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type ImageRow = {
  id: string;
  item_id: string;
  path: string;
  sort_order: number;
};

function authorLabel(p?: Profile | null) {
  const first = (p?.first_name ?? "").trim();
  const last = (p?.last_name ?? "").trim();

  if (!first && !last) return "Sans nom";
  if (first && !last) return first;
  if (!first && last) return `${last.charAt(0).toUpperCase()}.`;

  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

function truncate(s: string, max: number) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function compactMeta(it: Item) {
  const parts: string[] = [];
  if (it.category) parts.push(it.category);
  if (it.condition) parts.push(it.condition);

  const bm = `${it.brand ?? ""} ${it.model ?? ""}`.trim();
  if (bm) parts.push(bm);

  return parts.join(" • ");
}

function priceLabel(it: Item) {
  if (it.is_free) return "À donner";
  if (it.price == null) return "—";
  return `${it.price} CHF`;
}

export default function PlayerMarketplaceHome() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [clubId, setClubId] = useState("");

  const [items, setItems] = useState<Item[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [mainImageByItemId, setMainImageByItemId] = useState<Record<string, string>>({});

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
    setUserId(uid);

    const memRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", uid)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memRes.error || !memRes.data?.club_id) {
      setError("Pas de club actif.");
      setLoading(false);
      return;
    }

    const cid = memRes.data.club_id as string;
    setClubId(cid);

    const itemsRes = await supabase
      .from("marketplace_items")
      .select(
        "id,created_at,club_id,user_id,title,description,price,is_free,is_active,category,condition,brand,model,delivery"
      )
      .eq("club_id", cid)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (itemsRes.error) {
      setError(itemsRes.error.message);
      setLoading(false);
      return;
    }

    const list = (itemsRes.data ?? []) as Item[];
    setItems(list);

    // Profils
    const authorIds = Array.from(new Set(list.map((x) => x.user_id)));

    if (authorIds.length > 0) {
      const profRes = await supabase
        .from("profiles")
        .select("id,first_name,last_name")
        .in("id", authorIds);

      if (!profRes.error) {
        const map: Record<string, Profile> = {};
        (profRes.data ?? []).forEach((p: any) => {
          map[p.id] = p;
        });
        setProfilesById(map);
      }
    }

    // Images principales
    const itemIds = list.map((x) => x.id);

    if (itemIds.length > 0) {
      const imgRes = await supabase
        .from("marketplace_images")
        .select("item_id,path,sort_order")
        .in("item_id", itemIds)
        .eq("sort_order", 0);

      if (!imgRes.error) {
        const map: Record<string, string> = {};
        (imgRes.data ?? []).forEach((r: any) => {
          const { data } = supabase.storage.from(bucket).getPublicUrl(r.path);
          if (data?.publicUrl) map[r.item_id] = data.publicUrl;
        });
        setMainImageByItemId(map);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 900 }}>Marketplace</h1>
            <p style={{ color: "var(--muted)", marginTop: 6 }}>
              Toutes les annonces du club
            </p>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Link className="btn" href="/player/marketplace/mine">
              Mes annonces
            </Link>
            <Link className="btn" href="/player/marketplace/new">
              Publier
            </Link>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: "red" }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div>Chargement…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>
            Aucune annonce pour le moment.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((it) => {
              const mine = it.user_id === userId;
              const badge = mine ? "Moi" : authorLabel(profilesById[it.user_id]);
              const img = mainImageByItemId[it.id] || placeholderSvg;
              const meta = compactMeta(it);

              return (
                <Link
                  key={it.id}
                  href={`/player/marketplace/${it.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: 12,
                      display: "grid",
                      gap: 10,
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 120,
                          height: 90,
                          borderRadius: 12,
                          overflow: "hidden",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <img
                          src={img}
                          alt={it.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>
                            {it.title} <span style={badgeStyle}>{badge}</span>
                          </div>
                          <div style={{ fontWeight: 900 }}>
                            {priceLabel(it)}
                          </div>
                        </div>

                        {meta && (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            {meta}
                          </div>
                        )}

                        {it.delivery && (
                          <div style={{ fontSize: 13, color: "var(--muted)" }}>
                            Remise : {truncate(it.delivery, 60)}
                          </div>
                        )}

                        {it.description && (
                          <div style={{ color: "var(--muted)" }}>
                            {truncate(it.description, 120)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(0,0,0,0.05)",
};
