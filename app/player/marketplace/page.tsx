"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

/* eslint-disable @next/next/no-img-element -- Marketplace images are dynamic user uploads. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { List, Plus, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { loadPlayerMarketplace } from "@/lib/playerMarketplaceRead";
import styles from "./Marketplace.module.css";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceConditionLabel } from "@/lib/marketplaceLabels";
import type { AppLocale } from "@/lib/i18n/messages";

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

function compactMeta(it: Item, locale: AppLocale) {
  const parts: string[] = [];
  if (it.category) parts.push(it.category);
  const conditionLabel = marketplaceConditionLabel(locale, it.condition);
  if (conditionLabel) parts.push(conditionLabel);

  const bm = `${it.brand ?? ""} ${it.model ?? ""}`.trim();
  if (bm) parts.push(bm);

  return parts.join(" • ");
}

function priceLabel(it: Item, t: (key: string) => string) {
  if (it.is_free) return t("marketplace.free");
  if (it.price == null) return "—";
  return `${it.price} CHF`;
}

function MarketplaceCardsSkeleton() {
  return <div className="marketplace-list marketplace-loading-list" aria-hidden="true">
    {Array.from({ length: 4 }, (_, index) => <div className="marketplace-item marketplace-loading-card" key={index}>
      <div className="marketplace-row">
        <span className="marketplace-loading-thumb" />
        <span className="marketplace-loading-body">
          <i /><i /><i />
        </span>
      </div>
    </div>)}
  </div>;
}

export default function PlayerMarketplaceHome() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [mainImageByItemId, setMainImageByItemId] = useState<Record<string, string>>({});

  // ✅ Ancre au-dessus de la liste (plus fiable que window.scrollTo(0) avec header fixed)
  const listTopRef = useRef<HTMLDivElement | null>(null);

  // Filtre catégorie
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  // Pagination
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const explicitChildId = new URL(window.location.href).searchParams.get("child_id") ?? "";
      const json = await loadPlayerMarketplace<{ viewerUserId:string; effectiveUserId:string; items:Item[]; mainImageByItemId:Record<string,string> }>({
        token, explicitChildId,
        storedChildId:window.localStorage.getItem("parent:selected_child_id") ?? "",
        forgetStoredChild:()=>window.localStorage.removeItem("parent:selected_child_id"),
        fetcher:fetch,
      });
      if(json.viewerUserId!==json.effectiveUserId)window.localStorage.setItem("parent:selected_child_id",json.effectiveUserId);
      else if(!explicitChildId)window.localStorage.removeItem("parent:selected_child_id");

      setItems((json?.items ?? []) as Item[]);
      setMainImageByItemId((json?.mainImageByItemId ?? {}) as Record<string, string>);
    } catch (loadError: unknown) {
      setItems([]);
      setMainImageByItemId({});
      setError(loadError instanceof Error ? loadError.message : t("marketplace.noActiveClub"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  // ✅ Scroll stable iOS/PWA: double RAF (corrige le cas "Suivant" => images/layout shift)
  function scrollToListTopStable() {
    const el = listTopRef.current;
    if (!el) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const doScroll = () => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    doScroll();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        doScroll();
      });
    });
  }

  function goPrev() {
    setPage((p) => Math.max(1, p - 1));
    scrollToListTopStable(); // ✅ OK aussi
  }

  function goNext() {
    setPage((p) => Math.min(totalPages, p + 1));
    scrollToListTopStable(); // ✅ corrige surtout le cas "Suivant"
  }

  return (
    <div className="player-dashboard-bg player-marketplace-page">
      <div className={`app-shell marketplace-page ${styles.page}`}>
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("nav.marketplace") }]} />
        {/* Header */}
        <div className="glass-section">
          <div className={`marketplace-header ${styles.header}`}>
            <h1 className={`section-title ${styles.title}`}>{t("nav.marketplace")}</h1>

            <div className={`marketplace-actions marketplace-header-actions ${styles.actions}`}>
              <Link className="btn" href="/player/marketplace/mine">
                <List size={15} aria-hidden="true" />
                {t("player.myListings")}
              </Link>

              <Link className="btn btn-primary" href="/player/marketplace/new">
                <Plus size={15} aria-hidden="true" />
                {t("player.newListing")}
              </Link>
            </div>
          </div>

        </div>

        <div className={`glass-section ${styles.filterSection}`}>
          {/* Filtre catégorie */}
          <div className={styles.filterRow}>
            <label className={styles.filterTitle} htmlFor="cat">
              <span><SlidersHorizontal size={16} aria-hidden="true" /></span>
              {t("marketplace.byCategory")}
            </label>

            <select
              id="cat"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="marketplace-filter-select"
            >
              <option value="">{t("marketplace.all")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {selectedCategory && (
              <button className="btn marketplace-filter-clear" onClick={() => setSelectedCategory("")}>
                {t("marketplace.reset")}
              </button>
            )}
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Liste */}
        <div ref={listTopRef} className={`glass-section ${styles.listSection}`}>
          {loading ? (
            <MarketplaceCardsSkeleton />
          ) : pagedItems.length === 0 ? (
            <div className="glass-card marketplace-empty">
              {selectedCategory ? t("marketplace.noneInCategory") : t("marketplace.none")}
            </div>
          ) : (
            <>
              <div className="marketplace-list">
                {pagedItems.map((it) => {
                  const img = mainImageByItemId[it.id] || placeholderSvg;
                  const meta = compactMeta(it, locale);

                  return (
                    <Link key={it.id} href={`/player/marketplace/${it.id}`} className="marketplace-link">
                      <div className="marketplace-item">
                        <div className="marketplace-row">
                          <div className="marketplace-thumb">
                            <img src={img} alt={it.title} loading="lazy" decoding="async" width={240} height={180} />
                          </div>

                          <div className="marketplace-body">
                            {/* Ligne 1 — Titre */}
                            <div className="marketplace-item-title">{it.title}</div>

                            {/* Ligne 2 — Variables */}
                            {meta && <div className="marketplace-meta">{meta}</div>}

                            {/* Ligne 3 — Prix à droite dans mini card */}
                            <div className="marketplace-price-row">
                              <div className="marketplace-price-pill">{priceLabel(it, t)}</div>
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
                    {t("common.prev")}
                  </button>

                  <div className="marketplace-page-indicator">
                    {t("common.page")} <strong>{page}</strong> / {totalPages}
                  </div>

                  <button className="btn" onClick={goNext} disabled={page === totalPages}>
                    {t("common.next")}
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
