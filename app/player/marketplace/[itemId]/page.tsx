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
  user_id: string; // ✅ propriétaire
};

type Img = { id: string; item_id: string; path: string; sort_order: number };

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
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [isMine, setIsMine] = useState(false);

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
        .select("id,item_id,path,sort_order")
        .eq("item_id", itemId)
        .order("sort_order", { ascending: true });

      if (!imgRes.error) {
        const urls: string[] = [];
        (imgRes.data ?? []).forEach((r: any) => {
          const { data } = supabase.storage.from(bucket).getPublicUrl(r.path);
          if (data?.publicUrl) urls.push(data.publicUrl);
        });
        setThumbs(urls);
      } else {
        setThumbs([]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Erreur.");
      setItem(null);
      setThumbs([]);
      setIsMine(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (loading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  if (!item) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Marketplace</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? "Impossible d’afficher l’annonce."}
          </div>
        </div>
        <Link className="btn" href="/player/marketplace">
          Retour
        </Link>
      </div>
    );
  }

  const mainImg = thumbs[0] ?? placeholderSvg;
  const meta = compactMeta(item);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18 }} className="truncate">
              {item.title}
            </div>
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }} className="truncate">
              {fmtDate(item.created_at)}
              {meta ? ` • ${meta}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isMine && (
              <Link className="btn" href={`/player/marketplace/edit/${item.id}`}>
                Modifier
              </Link>
            )}
            <Link className="btn" href="/player/marketplace">
              Retour
            </Link>
          </div>
        </div>

        <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #e8e8e8" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mainImg} alt={item.title} style={{ width: "100%", height: 240, objectFit: "cover" }} />
        </div>

        {thumbs.length > 1 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {thumbs.map((u, idx) => (
              <div
                key={u + idx}
                style={{
                  width: 76,
                  height: 56,
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid #e8e8e8",
                  flex: "0 0 auto",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`photo-${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{priceLabel(item)}</div>
          <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
            {item.is_active ? "Disponible" : "Annonce inactive"}
          </div>
        </div>

        {item.description && (
          <div style={{ fontWeight: 700, whiteSpace: "pre-wrap" }}>{item.description}</div>
        )}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 900 }}>Contact</div>
        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
          {item.contact_email ? <>Email : {item.contact_email}</> : <>Email : —</>}
        </div>
        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
          {item.contact_phone ? <>Téléphone : {item.contact_phone}</> : <>Téléphone : —</>}
        </div>
      </div>
    </div>
  );
}
