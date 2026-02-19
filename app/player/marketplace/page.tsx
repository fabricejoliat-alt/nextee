"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [items, setItems] = useState<Item[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [mainImageByItemId, setMainImageByItemId] = useState<Record<string, string>>({});

  // Filtre catégorie
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  // Pagination
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

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

    // Profils (laissé tel quel si tu en as besoin ailleurs)
    const authorIds = Array.from(new Set(list.map((x) => x.user_id)));
    if (authorIds.length > 0) {
      const profRes = await supabase.from("profiles").select("id,first_name,last_name").in("id", authorIds);
      if (!profRes.error) {
        const map: Record<string, Profile> = {};
        (profRes.data ?? []).forEach((p: any) => (map[p.id] = p));
        setProfilesById(map);
      }
    }

    // Images principales (sort_order = 0)
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

  // Reset page quand on change de catégorie
  useEffect(() => {
    setPage(1);
  }, [selectedCategory]);

  // Liste des catégories (depuis les items chargés)
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const c = (it.category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [items]);

  // Items filtrés (catégorie)
  const filteredItems = useMemo(() => {
    const c = selectedCategory.trim();
    if (!c) return items;
    return items.filter((it) => (it.category ?? "").trim() === c);
  }, [items, selectedCategory]);

  // Pagination (sur la liste filtrée)
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  }, [filteredItems]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  // Sécurité si la page dépasse après filtre/suppression
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goPrev() {
    setPage((p) => {
      const next = Math.max(1, p - 1);
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" }); // ✅ bonus
  }

  function goNext() {
    setPage((p) => {
      const next = Math.min(totalPages, p + 1);
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" }); // ✅ bonus
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title">Marketplace</div>

            <div className="marketplace-actions">
              <Link className="cta-green cta-green-inline" href="/player/marketplace/mine">
                Mes annonces
              </Link>

              <Link className="cta-green cta-green-inline" href="/player/marketplace/new">
                Publier une annonce
              </Link>
            </div>
          </div>

          {/* Filtre catégorie */}
          <div className="marketplace-filter-row">
            <label className="marketplace-filter-label" htmlFor="cat">
              Par catégorie
            </label>

            <select
              id="cat"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="marketplace-filter-select"
            >
              <option value="">Toutes</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {selectedCategory && (
              <button className="btn marketplace-filter-clear" onClick={() => setSelectedCategory("")}>
                Réinitialiser
              </button>
            )}
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Liste */}
        <div className="glass-section">
          {loading ? (
            <div className="glass-card">Chargement…</div>
          ) : pagedItems.length === 0 ? (
            <div className="glass-card marketplace-empty">
              {selectedCategory ? "Aucune annonce dans cette catégorie." : "Aucune annonce pour le moment."}
            </div>
          ) : (
            <>
              <div className="marketplace-list">
                {pagedItems.map((it) => {
                  const img = mainImageByItemId[it.id] || placeholderSvg;
                  const meta = compactMeta(it);

                  return (
                    <Link key={it.id} href={`/player/marketplace/${it.id}`} className="marketplace-link">
                      <div className="marketplace-item">
                        <div className="marketplace-row">
                          <div className="marketplace-thumb">
                            <img src={img} alt={it.title} />
                          </div>

                          <div className="marketplace-body">
                            {/* Ligne 1 — Titre */}
                            <div className="marketplace-item-title">{it.title}</div>

                            {/* Ligne 2 — Variables */}
                            {meta && <div className="marketplace-meta">{meta}</div>}

                            {/* Ligne 3 — Prix à droite dans mini card */}
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

              {/* ✅ Pagination uniquement en bas */}
              {filteredItems.length > PAGE_SIZE && (
                <div className="marketplace-pagination">
                  <button className="btn" onClick={goPrev} disabled={page === 1}>
                    Précédent
                  </button>

                  <div className="marketplace-page-indicator">
                    Page <strong>{page}</strong> / {totalPages}
                  </div>

                  <button className="btn" onClick={goNext} disabled={page === totalPages}>
                    Suivant
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
