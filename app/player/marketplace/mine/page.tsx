"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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

function priceLabel(it: Item, t: (key: string) => string) {
  if (it.is_free) return t("marketplace.free");
  if (it.price == null) return "—";
  return `${it.price} CHF`;
}

export default function MarketplaceMine() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clubId, setClubId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
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

    const { effectiveUserId: uid } = await resolveEffectivePlayerContext();

    const memRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", uid)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memRes.error || !memRes.data?.club_id) {
      setError(memRes.error?.message ?? t("marketplace.noActiveClub"));
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
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (itemsRes.error) {
      setError(itemsRes.error.message);
      setLoading(false);
      return;
    }

    const list = (itemsRes.data ?? []) as Item[];
    setItems(list);

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
      } else {
        setMainImageByItemId({});
      }
    } else {
      setMainImageByItemId({});
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">

        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("player.myListings")}
              </div>
              <div className="marketplace-filter-label" style={{ marginTop: 6, marginBottom: 8 }}>
                {t("marketplace.mineSubtitle")}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/marketplace">
                {t("player.allListings")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/marketplace/new">
                {t("common.add")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* List */}
        <div className="glass-section">
          {loading ? (
            <div className="glass-card">{t("common.loading")}</div>
          ) : items.length === 0 ? (
            <div className="glass-card marketplace-empty">
              {t("marketplace.mineEmpty")}
            </div>
          ) : (
            <div className="marketplace-list">
              {items.map((it) => {
                const img = mainImageByItemId[it.id] || placeholderSvg;
                const meta = compactMeta(it);

                return (
                  <div key={it.id} className="marketplace-item" style={{ opacity: it.is_active ? 1 : 0.75 }}>
                    <div className="marketplace-row">

                      <div className="marketplace-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt={it.title} loading="lazy" />
                      </div>

                      <div className="marketplace-body">

                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div className="marketplace-item-title">{it.title}</div>
                          {!it.is_active && (
                            <div style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 900,
                              background: "rgba(0,0,0,0.06)",
                              border: "1px solid rgba(0,0,0,0.08)"
                            }}>
                              {t("coachGroups.inactive")}
                            </div>
                          )}
                        </div>

                        {meta && <div className="marketplace-meta">{meta}</div>}

                        {it.description && (
                          <div className="marketplace-meta">
                            {truncate(it.description, 120)}
                          </div>
                        )}

                        <div className="marketplace-price-row">
                          <div className="marketplace-price-pill">{priceLabel(it, t)}</div>
                        </div>

                        <div className="hr-soft" style={{ marginTop: 10, marginBottom: 10 }} />

                        {/* Ligne 1 — Toggle seul */}
                        <div style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          marginBottom: 8
                        }}>
                          <label className={`toggle ${it.is_active ? "on" : ""}`}>
                            <input
                              type="checkbox"
                              checked={it.is_active}
                              onChange={() => toggleActive(it)}
                              disabled={busy}
                            />
                            <span className="toggle-track">
                              <span className="toggle-thumb" />
                            </span>
                            <span className="toggle-label">
                              {it.is_active ? t("coachGroups.active") : t("coachGroups.inactive")}
                            </span>
                          </label>
                        </div>

                        {/* Ligne 2 — Boutons compacts */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <Link
                            href={`/player/marketplace/edit/${it.id}`}
                            className="btn"
                            style={{
                              height: 34,
                              padding: "0 12px",
                              fontSize: 13,
                              fontWeight: 800,
                              borderRadius: 10,
                            }}
                          >
                            {t("common.edit")}
                          </Link>

                          <button
                            className="btn btn-danger"
                            onClick={() => remove(it.id)}
                            disabled={busy}
                            type="button"
                            style={{
                              height: 34,
                              padding: "0 12px",
                              fontSize: 13,
                              fontWeight: 800,
                              borderRadius: 10,
                            }}
                          >
                            {t("common.delete")}
                          </button>
                        </div>

                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
