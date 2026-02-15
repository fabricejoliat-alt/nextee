"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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

  contact_email: string | null;
  contact_phone: string | null;
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

function nameBadge(p?: Profile | null) {
  const first = (p?.first_name ?? "").trim();
  const last = (p?.last_name ?? "").trim();

  if (!first && !last) return "Sans nom";
  if (first && !last) return first;
  if (!first && last) return `${last.charAt(0).toUpperCase()}.`;

  return `${first} ${last.charAt(0).toUpperCase()}.`;
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
  if (it.price === null || it.price === undefined) return "—";
  return `${it.price} CHF`;
}

export default function MarketplaceItemDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState<string>("");

  const [item, setItem] = useState<Item | null>(null);
  const [authorProfile, setAuthorProfile] = useState<Profile | null>(null);

  const [images, setImages] = useState<string[]>([]);
  const [activeImg, setActiveImg] = useState<string | null>(null);

  const bucket = "marketplace";

  const placeholderSvg = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <rect width="100%" height="100%" fill="#f3f4f6"/>
        <path d="M220 380l120-120 110 110 70-70 120 120" fill="none" stroke="#9ca3af" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="300" cy="230" r="34" fill="#9ca3af"/>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  async function load() {
    if (!id) return;

    setLoading(true);
    setError(null);

    const { data: userRes } = await supabase.auth.getUser();
    setMeId(userRes?.user?.id ?? "");

    // 1) item
    const itemRes = await supabase
      .from("marketplace_items")
      .select(
        "id,created_at,club_id,user_id,title,description,price,is_free,is_active,category,condition,brand,model,delivery,contact_email,contact_phone"
      )
      .eq("id", id)
      .maybeSingle();

    if (itemRes.error) {
      setError(itemRes.error.message);
      setLoading(false);
      return;
    }

    if (!itemRes.data) {
      setError("Annonce introuvable (ou non autorisée).");
      setLoading(false);
      return;
    }

    const it = itemRes.data as Item;
    setItem(it);

    // 2) author profile
    const profRes = await supabase
      .from("profiles")
      .select("id,first_name,last_name")
      .eq("id", it.user_id)
      .maybeSingle();

    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      return;
    }
    setAuthorProfile((profRes.data ?? null) as Profile | null);

    // 3) images
    const imgRes = await supabase
      .from("marketplace_images")
      .select("id,item_id,path,sort_order")
      .eq("item_id", it.id)
      .order("sort_order", { ascending: true });

    if (imgRes.error) {
      setError(imgRes.error.message);
      setLoading(false);
      return;
    }

    const rows = (imgRes.data ?? []) as ImageRow[];
    const urls: string[] = rows
      .map((r) => supabase.storage.from(bucket).getPublicUrl(r.path).data?.publicUrl)
      .filter(Boolean) as string[];

    setImages(urls);
    setActiveImg(urls[0] ?? null);

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  const badge = useMemo(() => {
    if (!item) return "";
    if (item.user_id && item.user_id === meId) return "Moi";
    return nameBadge(authorProfile);
  }, [item, meId, authorProfile]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 900 }}>Détail de l’annonce</h1>
            <p style={{ color: "var(--muted)", marginTop: 6 }}>Marketplace du club</p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Link className="btn" href="/player/marketplace">
              Retour
            </Link>
            <Link className="btn" href="/player/marketplace/mine">
              Mes annonces
            </Link>
          </div>
        </div>

        {error && (
          <div
            style={{
              border: "1px solid #ffcccc",
              background: "#fff5f5",
              padding: 12,
              borderRadius: 12,
              color: "#a00",
              marginTop: 12,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div>Chargement…</div>
        ) : !item ? (
          <div style={{ color: "var(--muted)" }}>Aucune donnée.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Galerie */}
            <div style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  width: "100%",
                  maxWidth: 820,
                  borderRadius: 16,
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                  background: "white",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeImg ?? placeholderSvg}
                  alt={item.title}
                  style={{ width: "100%", height: 420, objectFit: "cover", display: "block" }}
                />
              </div>

              {images.length > 1 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {images.map((src, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveImg(src)}
                      style={{
                        border: activeImg === src ? "2px solid black" : "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 0,
                        background: "white",
                        cursor: "pointer",
                      }}
                      aria-label={`Photo ${idx + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`thumb-${idx}`} style={{ width: 110, height: 80, objectFit: "cover", borderRadius: 10 }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{item.title}</div>
                <span style={badgeStyle}>{badge}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{priceLabel(item)}</div>
            </div>

            {/* Meta */}
            {compactMeta(item) && (
              <div style={{ color: "var(--muted)", fontWeight: 800 }}>{compactMeta(item)}</div>
            )}

            {/* Description */}
            {item.description && (
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.description}</div>
            )}

            {/* Livraison */}
            {item.delivery && (
              <div style={{ color: "var(--muted)" }}>
                <span style={{ fontWeight: 900 }}>Remise/Livraison : </span>
                {item.delivery}
              </div>
            )}

            <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />

            {/* Contact */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Contact</div>

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div style={contactBoxStyle}>
                  <div style={contactLabelStyle}>Email</div>
                  <div style={{ fontWeight: 900 }}>{item.contact_email ?? "—"}</div>
                </div>

                <div style={contactBoxStyle}>
                  <div style={contactLabelStyle}>Téléphone</div>
                  <div style={{ fontWeight: 900 }}>{item.contact_phone ?? "—"}</div>
                </div>
              </div>

              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                Informations fournies par le vendeur pour cette annonce.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  fontSize: 12,
  fontWeight: 900,
  background: "rgba(0,0,0,0.03)",
};

const contactBoxStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 12,
  background: "white",
};

const contactLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  fontWeight: 900,
  marginBottom: 6,
};
