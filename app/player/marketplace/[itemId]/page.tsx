"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Item = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  club_id: string;
  is_active: boolean;
  category: string | null;
  condition: string | null;
  brand: string | null;
  model: string | null;
  price: number | null;
  is_free: boolean | null;
  contact_email: string | null;
  contact_phone: string | null;
  user_id: string;
};

function getParamString(p: any): string | null {
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function getIdFromPathname(pathname: string): string | null {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === "marketplace" || last === "edit" || last === "mine" || last === "new") return null;
  return last;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(d);
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

export default function MarketplaceDetailPage() {
  const params = useParams();
  const pathname = usePathname();

  const itemId = useMemo(() => {
    const fromParams = getParamString((params as any)?.itemId);
    return fromParams ?? getIdFromPathname(pathname);
  }, [params, pathname]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [item, setItem] = useState<Item | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [isMine, setIsMine] = useState(false);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

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
    if (!itemId) {
      setLoading(false);
      setError("Identifiant d’annonce introuvable.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw new Error(userErr.message);
      const uid = userRes.user?.id ?? null;

      const itRes = await supabase
        .from("marketplace_items")
        .select(
          "id,title,description,created_at,club_id,is_active,category,condition,brand,model,price,is_free,contact_email,contact_phone,user_id"
        )
        .eq("id", itemId)
        .maybeSingle();

      if (itRes.error) throw new Error(itRes.error.message);
      if (!itRes.data) throw new Error("Annonce introuvable.");

      const it = itRes.data as Item;
      setItem(it);
      setIsMine(!!uid && it.user_id === uid);

      const imgRes = await supabase
        .from("marketplace_images")
        .select("path,sort_order")
        .eq("item_id", itemId)
        .order("sort_order", { ascending: true });

      if (imgRes.error) {
        setImages([]);
      } else {
        const urls: string[] = [];
        (imgRes.data ?? []).forEach((r: any) => {
          const { data } = supabase.storage.from(bucket).getPublicUrl(r.path);
          if (data?.publicUrl) urls.push(data.publicUrl);
        });
        setImages(urls);
      }
    } catch (e: any) {
      setError(e?.message ?? "Erreur.");
      setItem(null);
      setImages([]);
      setIsMine(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  useEffect(() => {
    if (!lightboxOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen, activeIndex, images.length]);

  function openAt(idx: number) {
    setActiveIndex(idx);
    setLightboxOpen(true);
  }

  function goPrev() {
    setActiveIndex((i) => (images.length ? (i - 1 + images.length) % images.length : 0));
  }

  function goNext() {
    setActiveIndex((i) => (images.length ? (i + 1) % images.length : 0));
  }

  if (loading) {
    return (
      <div className="player-dashboard-bg">
        <div className="app-shell marketplace-page">
          <div className="glass-section">
            <div className="glass-card">Chargement…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="player-dashboard-bg">
        <div className="app-shell marketplace-page">
          <div className="glass-section">
            <div className="glass-card" style={{ display: "grid", gap: 10 }}>
              <div className="card-title">Marketplace</div>
              <div style={{ color: "rgba(0,0,0,0.65)", fontWeight: 800, fontSize: 13 }}>
                {error ?? "Impossible d’afficher l’annonce."}
              </div>
              <Link className="btn" href="/player/marketplace">
                Retour
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const meta = compactMeta(item);
  const mainImg = images[0] ?? placeholderSvg;

  // ✅ Header title: Marketplace - Catégorie
  const headerTitle = `Marketplace${item.category ? ` - ${item.category}` : ""}`;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {headerTitle}
              </div>
              <div className="marketplace-filter-label" style={{ marginTop: 0 }}>
                {fmtDate(item.created_at)}
              </div>
            </div>

            <div className="marketplace-actions">
              {isMine && (
                <Link className="cta-green cta-green-inline" href={`/player/marketplace/edit/${item.id}`}>
                  Modifier
                </Link>
              )}
              <Link className="cta-green cta-green-inline" href="/player/marketplace">
                Retour
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            {/* Main image (click to zoom) */}
            <button
              type="button"
              onClick={() => openAt(0)}
              disabled={images.length === 0}
              style={{
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 16,
                overflow: "hidden",
                padding: 0,
                background: "transparent",
                cursor: images.length === 0 ? "default" : "zoom-in",
              }}
              aria-label="Agrandir l’image"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mainImg}
                alt={item.title}
                style={{ width: "100%", height: 260, objectFit: "cover", display: "block" }}
              />
            </button>

            {/* Thumbs: horizontal scroll + click to open */}
            {images.length > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  overflowX: "auto",
                  paddingBottom: 4,
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {images.map((u, idx) => (
                  <button
                    key={u + idx}
                    type="button"
                    onClick={() => openAt(idx)}
                    style={{
                      width: 92,
                      height: 68,
                      borderRadius: 14,
                      overflow: "hidden",
                      border: "1px solid rgba(0,0,0,0.10)",
                      padding: 0,
                      background: "transparent",
                      flex: "0 0 auto",
                      cursor: "zoom-in",
                    }}
                    aria-label={`Voir l’image ${idx + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt={`photo-${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </button>
                ))}
              </div>
            )}

            {/* ✅ Sous les photos: même style que cards marketplace */}
            <div style={{ display: "grid", gap: 6 }}>
              {/* Ligne 1: titre */}
              <div className="marketplace-item-title">{item.title}</div>

              {/* Ligne 2: meta */}
              {meta && <div className="marketplace-meta">{meta}</div>}

              {/* Ligne 3: prix à droite + disponibilité */}
              <div className="marketplace-price-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 900, fontSize: 12 }}>
                  {item.is_active ? "Disponible" : "Annonce inactive"}
                </div>
                <div className="marketplace-price-pill">{priceLabel(item)}</div>
              </div>
            </div>

            {/* Description */}
            {item.description && (
              <div style={{ fontWeight: 800, fontSize: 13, color: "rgba(0,0,0,0.70)", whiteSpace: "pre-wrap" }}>
                {item.description}
              </div>
            )}

            <div className="hr-soft" />

            {/* ✅ Contact: titre + 2 colonnes */}
            <div style={{ display: "grid", gap: 10 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Contact
              </div>

              <div className="grid-2">
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>Email</div>
                  <div style={fieldValueStyle}>{item.contact_email ?? "—"}</div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>Téléphone</div>
                  <div style={fieldValueStyle}>{item.contact_phone ?? "—"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Lightbox modal */}
        {lightboxOpen && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setLightboxOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2000,
              background: "rgba(0,0,0,0.82)",
              display: "grid",
              placeItems: "center",
              padding: 14,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(980px, 96vw)",
                height: "min(720px, 82vh)",
                borderRadius: 18,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.15)",
                position: "relative",
                background: "rgba(0,0,0,0.25)",
              }}
            >
              {/* Close */}
              <button
                type="button"
                className="btn"
                onClick={() => setLightboxOpen(false)}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  zIndex: 2,
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.92) !important",
                }}
              >
                Fermer
              </button>

              {/* Prev/Next */}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={goPrev}
                    style={{
                      position: "absolute",
                      left: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      zIndex: 2,
                      height: 36,
                      padding: "0 12px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.92) !important",
                    }}
                  >
                    ◀
                  </button>

                  <button
                    type="button"
                    className="btn"
                    onClick={goNext}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      zIndex: 2,
                      height: 36,
                      padding: "0 12px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.92) !important",
                    }}
                  >
                    ▶
                  </button>
                </>
              )}

              {/* Image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images[activeIndex] ?? mainImg}
                alt={`image-${activeIndex + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                  background: "rgba(0,0,0,0.25)",
                }}
              />

              {/* Counter */}
              {images.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    bottom: 12,
                    zIndex: 2,
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#fff",
                    background: "rgba(0,0,0,0.45)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  {activeIndex + 1} / {images.length}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.60)",
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  color: "rgba(0,0,0,0.78)",
};