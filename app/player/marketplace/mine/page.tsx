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

export default function MarketplaceMine() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
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

    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) {
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
      setError(memRes.error?.message ?? "Pas de club actif.");
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
    if (!confirm("Supprimer cette annonce ?")) return;

    if (busy) return;

    setBusy(true);
    setError(null);

    const { error } = await supabase.from("marketplace_items").delete().eq("id", itId);
    if (error) setError(error.message);

    await load();
    setBusy(false);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 900 }}>Mes annonces</h1>
            <p style={{ color: "var(--muted)", marginTop: 6 }}>
              Active/désactive, modifie ou supprime tes annonces.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/player/marketplace">
              Toutes les annonces
            </Link>
            <Link className="btn" href="/player/marketplace/new">
              Publier
            </Link>
          </div>
        </div>

        {error && <div style={{ marginTop: 12, color: "#a00" }}>{error}</div>}
      </div>

      <div className="card">
        {loading ? (
          <div>Chargement…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Tu n’as pas encore d’annonce.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((it) => {
              const img = mainImageByItemId[it.id] || placeholderSvg;
              const meta = compactMeta(it);

              return (
                <div
                  key={it.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    display: "grid",
                    gap: 10,
                    opacity: it.is_active ? 1 : 0.75,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
                    <div
                      style={{
                        width: 120,
                        height: 90,
                        borderRadius: 12,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        background: "white",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={it.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <div style={{ fontWeight: 900 }}>{it.title}</div>
                        <div style={{ fontWeight: 900 }}>{priceLabel(it)}</div>
                      </div>

                      {meta && (
                        <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
                          {meta}
                        </div>
                      )}

                      {it.delivery && (
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>
                          Remise : {truncate(it.delivery, 70)}
                        </div>
                      )}

                      {it.description && (
                        <div style={{ color: "var(--muted)" }}>{truncate(it.description, 120)}</div>
                      )}

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                        {/* Toggle Actif/Inactif */}
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
                          <span className="toggle-label">{it.is_active ? "Actif" : "Inactif"}</span>
                        </label>

                        <Link className="btn" href={`/player/marketplace/edit/${it.id}`}>
                          Modifier
                        </Link>

                        <button
                          className="btn btn-danger"
                          onClick={() => remove(it.id)}
                          disabled={busy}
                          type="button"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{clubId ? "Club OK" : "—"}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
