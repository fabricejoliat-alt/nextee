"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { List, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import styles from "../Marketplace.module.css";
import playerUi from "@/components/player/PlayerUI.module.css";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import MarketplaceReviewStatus from "@/components/player/MarketplaceReviewStatus";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { marketplaceConditionLabel } from "@/lib/marketplaceLabels";
import type { AppLocale } from "@/lib/i18n/messages";

type Item = {
  moderation_status: string;
  moderation_note: string | null;
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

export default function MarketplaceMine() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [mainImageByItemId, setMainImageByItemId] = useState<Record<string, string>>({});

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

    const ctx = await resolveEffectivePlayerContext();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    if (!token) {
      setError("Session invalide.");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (ctx.role === "parent") params.set("child_id", ctx.effectiveUserId);
    const res = await fetch(`/api/player/marketplace/mine?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(json?.error ?? t("marketplace.noActiveClub")));
      setLoading(false);
      return;
    }

    const list = (json?.items ?? []) as Item[];
    setItems(list);
    setMainImageByItemId((json?.mainImageByItemId ?? {}) as Record<string, string>);

    setLoading(false);
  }, [t]);

  useEffect(() => {
    // Remote data loading is the synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggleActive(it: Item) {
    if (busy) return;

    setBusy(true);
    setError(null);

    const { error } = await supabase
      .from("marketplace_items")
      .update({ is_active: !it.is_active })
      .eq("id", it.id);

    if (error) setError(error.message);

    await load();
    setBusy(false);
  }

  async function remove(itId: string) {
    if (!confirm(t("marketplace.confirmDelete"))) return;
    if (busy) return;

    setBusy(true);
    setError(null);

    const { error } = await supabase.from("marketplace_items").delete().eq("id", itId);
    if (error) setError(error.message);

    await load();
    setBusy(false);
  }

  return (
    <div className="player-dashboard-bg player-marketplace-page">
      <div className={`app-shell marketplace-page ${styles.page}`}>
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("nav.marketplace"), href: "/player/marketplace" }, { label: t("player.myListings") }]} />
        <div className="glass-section">
          <div className={`marketplace-header ${styles.mineHeader}`}>
            <div>
              <h1 className="section-title">{t("player.myListings")}</h1>
              <p className="section-subtitle">{t("marketplace.mineSubtitle")}</p>
            </div>
            <div className={styles.mineHeaderActions}>
              <Link className="btn" href="/player/marketplace"><List size={15} aria-hidden="true" />{t("player.allListings")}</Link>
              <Link className="btn btn-primary" href="/player/marketplace/new"><Plus size={15} aria-hidden="true" />{t("common.add")}</Link>
            </div>
          </div>
          {error && <div className="marketplace-error" role="alert">{error}</div>}
        </div>
        <div className={`glass-section ${styles.listSection}`}>
          {loading ? <div className={styles.detailLoading} role="status" aria-label={t("common.loading")}><div className={styles.loadingImage} /><div className={styles.loadingLine} /></div> : items.length === 0 ? (
            <div className="glass-card marketplace-empty">{t("marketplace.mineEmpty")}</div>
          ) : <div className="marketplace-list">
            {items.map(it => {
              const img = mainImageByItemId[it.id] || placeholderSvg;
              const meta = compactMeta(it, locale);
              return <div key={it.id} className="marketplace-item" style={{ opacity: it.is_active ? 1 : 0.75 }}>
                <Link href={`/player/marketplace/${it.id}`} className="marketplace-link">
                  <div className="marketplace-row">
                    <div className="marketplace-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={it.title} loading="lazy" decoding="async" width={240} height={180} />
                    </div>
                    <div className="marketplace-body">
                      <div className="marketplace-item-title">{it.title}</div>
                      {meta && <div className="marketplace-meta">{meta}</div>}
                      <div className="marketplace-price-row"><div className="marketplace-price-pill">{priceLabel(it, t)}</div></div>
                    </div>
                  </div>
                </Link>
                <MarketplaceReviewStatus className={styles.mineReviewStatus} status={it.moderation_status} note={it.moderation_note} />
                <div className={styles.mineFooter}>
                  <label className={`toggle ${it.is_active ? "on" : ""}`}>
                    <input type="checkbox" checked={it.is_active} onChange={() => void toggleActive(it)} disabled={busy} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span className="toggle-label">{it.is_active ? t("coachGroups.active") : t("coachGroups.inactive")}</span>
                  </label>
                  <div className={styles.mineItemActions}>
                    <a href={`/player/marketplace/edit/${it.id}`} className={playerUi.iconButton} aria-label={`${t("common.edit")} ${it.title}`} title={t("common.edit")}><Pencil size={17} aria-hidden="true" /></a>
                    <button className={`${playerUi.iconButton} ${playerUi.dangerIcon}`} type="button" onClick={() => void remove(it.id)} disabled={busy} aria-label={`${t("common.delete")} ${it.title}`} title={t("common.delete")}><Trash2 size={17} aria-hidden="true" /></button>
                  </div>
                </div>
              </div>;
            })}
          </div>}
        </div>
      </div>
    </div>
  );
}
