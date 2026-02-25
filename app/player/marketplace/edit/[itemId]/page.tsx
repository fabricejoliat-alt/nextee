"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

const BUCKET = "marketplace";
const MAX_IMAGES = 5;

const CATEGORIES = [
  "Driver",
  "Bois de parcours",
  "Hybride",
  "Fers (set)",
  "Wedge",
  "Putter",
  "Shaft (manche)",
  "Balles",
  "Gants",
  "Sac",
  "Chariot",
  "GPS / montre",
  "Rangefinder",
  "Chaussures",
  "Textile",
  "Accessoires",
  "Divers",
] as const;

const CONDITIONS = ["New", "Like new", "Good condition", "To repair"] as const;

type Item = {
  id: string;
  title: string;
  description: string | null;
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

type DbImage = {
  id: string;
  item_id: string;
  path: string;
  sort_order: number;
};

type SaleMode = "SELL" | "GIVE";

type UIImg =
  | {
      kind: "existing";
      id: string; // marketplace_images.id
      path: string;
      url: string;
    }
  | {
      kind: "new";
      tempId: string;
      file: File;
      url: string; // objectURL
    };

function getParamString(p: any): string | null {
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function getIdFromPathname(pathname: string): string | null {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === "edit") return null;
  return last;
}

function safeExtFromFileName(name: string) {
  const ext = (name.split(".").pop() || "jpg").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "") || "jpg";
}

export default function MarketplaceEditPage() {
  const { t } = useI18n();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  const itemId = useMemo(() => {
    const fromParams = getParamString((params as any)?.itemId);
    return fromParams ?? getIdFromPathname(pathname);
  }, [params, pathname]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyImages, setBusyImages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [item, setItem] = useState<Item | null>(null);

  const [saleMode, setSaleMode] = useState<SaleMode>("SELL");
  const isFree = saleMode === "GIVE";

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    condition: "",
    brand: "",
    model: "",
    price: "" as string,
    contact_email: "",
    contact_phone: "",
    is_active: true,
  });

  // Images UI list (same UX as NEW)
  const [uiImages, setUiImages] = useState<UIImg[]>([]);
  const [deletedExisting, setDeletedExisting] = useState<DbImage[]>([]);

  // drag reorder (same as NEW)
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function setMode(next: SaleMode) {
    setSaleMode(next);
    if (next === "GIVE") set("price", "");
  }

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
      if (!uid) throw new Error("Session invalide.");

      const itRes = await supabase
        .from("marketplace_items")
        .select(
          "id,title,description,is_active,category,condition,brand,model,price,is_free,contact_email,contact_phone,user_id"
        )
        .eq("id", itemId)
        .maybeSingle();

      if (itRes.error) throw new Error(itRes.error.message);
      if (!itRes.data) throw new Error("Annonce introuvable.");

      const it = itRes.data as Item;
      if (it.user_id !== uid) throw new Error("Tu ne peux pas modifier cette annonce.");

      setItem(it);
      setSaleMode(it.is_free ? "GIVE" : "SELL");

      setForm({
        title: it.title ?? "",
        description: it.description ?? "",
        category: it.category ?? "",
        condition: it.condition ?? "",
        brand: it.brand ?? "",
        model: it.model ?? "",
        price: it.price == null ? "" : String(it.price),
        contact_email: it.contact_email ?? "",
        contact_phone: it.contact_phone ?? "",
        is_active: !!it.is_active,
      });

      const imgRes = await supabase
        .from("marketplace_images")
        .select("id,item_id,path,sort_order")
        .eq("item_id", it.id)
        .order("sort_order", { ascending: true });

      if (imgRes.error) throw new Error(imgRes.error.message);

      const list = (imgRes.data ?? []) as DbImage[];

      // Convert to UI images (existing)
      const ui: UIImg[] = list.map((r) => {
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(r.path);
        return {
          kind: "existing",
          id: r.id,
          path: r.path,
          url: data?.publicUrl || "",
        };
      });

      // reset deletion list + set images
      setDeletedExisting([]);
      setUiImages(ui);
    } catch (e: any) {
      setError(e?.message ?? "Erreur.");
      setItem(null);
      setUiImages([]);
      setDeletedExisting([]);
    } finally {
      setLoading(false);
    }
  }

  // revoke objectURLs for new images
  useEffect(() => {
    return () => {
      uiImages.forEach((img) => {
        if (img.kind === "new") URL.revokeObjectURL(img.url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  /* -------------------- IMAGES (same UX as NEW) -------------------- */

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    const imgs = picked.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;

    setUiImages((prev) => {
      const allowed = Math.max(0, MAX_IMAGES - prev.length);
      const toAdd = imgs.slice(0, allowed).map((file) => ({
        kind: "new" as const,
        tempId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
      }));
      return [...prev, ...toAdd];
    });

    e.target.value = "";
  }

  function onDropZoneDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (saving || busyImages) return;
    if (uiImages.length >= MAX_IMAGES) return;

    const dropped = Array.from(e.dataTransfer.files ?? []);
    const imgs = dropped.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;

    setUiImages((prev) => {
      const allowed = Math.max(0, MAX_IMAGES - prev.length);
      const toAdd = imgs.slice(0, allowed).map((file) => ({
        kind: "new" as const,
        tempId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
      }));
      return [...prev, ...toAdd];
    });
  }

  function removeImage(idx: number) {
    setUiImages((prev) => {
      const img = prev[idx];
      // track deletion if existing
      if (img?.kind === "existing") {
        setDeletedExisting((d) => [...d, { id: img.id, item_id: itemId || "", path: img.path, sort_order: 0 }]);
      }
      // cleanup objectURL
      if (img?.kind === "new") URL.revokeObjectURL(img.url);

      return prev.filter((_, i) => i !== idx);
    });
  }

  // Drag reorder (HTML5) – same logic as NEW
  function onThumbDragStart(idx: number, e: React.DragEvent) {
    if (saving || busyImages) return;
    setDragIndex(idx);
    setOverIndex(null);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
    } catch {
      // ignore
    }
  }

  function onThumbDragOver(idx: number, e: React.DragEvent) {
    if (saving || busyImages) return;
    e.preventDefault();
    setOverIndex(idx);
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      // ignore
    }
  }

  function onThumbDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function onThumbDrop(idx: number, e: React.DragEvent) {
    if (saving || busyImages) return;
    e.preventDefault();

    let from: number | null = dragIndex;
    if (from == null) {
      const raw = e.dataTransfer.getData("text/plain");
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) from = parsed;
    }
    if (from == null || from === idx) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }

    setUiImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from!, 1);
      next.splice(idx, 0, moved);
      return next;
    });

    setDragIndex(null);
    setOverIndex(null);
  }

  /* -------------------- SAVE (items + images) -------------------- */

  async function saveAll() {
    if (!item) return;

    const title = form.title.trim();
    if (title.length < 3) {
      setError("Titre requis.");
      return;
    }

    if (!form.contact_email.trim()) {
      setError("Email de contact requis.");
      return;
    }

    if (!isFree) {
      const v = Number(form.price);
      if (form.price.trim() === "" || Number.isNaN(v) || v <= 0) {
        setError("Prix invalide.");
        return;
      }
    }

    setSaving(true);
    setBusyImages(true);
    setError(null);

    try {
      // 1) update item
      const payload: any = {
        title,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        condition: form.condition.trim() || null,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        is_free: isFree,
        price: isFree ? null : Number(form.price),
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        is_active: !!form.is_active,
      };

      const upItem = await supabase.from("marketplace_items").update(payload).eq("id", item.id);
      if (upItem.error) throw new Error(upItem.error.message);

      // 2) delete removed existing images (DB + storage best-effort)
      if (deletedExisting.length > 0) {
        for (const d of deletedExisting) {
          // fetch path from db (in case)
          const rowRes = await supabase.from("marketplace_images").select("path").eq("id", d.id).maybeSingle();
          const path = (rowRes.data as any)?.path ?? d.path;

          if (path) {
            await supabase.storage.from(BUCKET).remove([path]); // best effort
          }
          const delDb = await supabase.from("marketplace_images").delete().eq("id", d.id);
          if (delDb.error) throw new Error(delDb.error.message);
        }
      }

      // 3) rebuild final list and persist sort_order
      // First: get current existing rows that still remain
      const existingInUI = uiImages.filter((x) => x.kind === "existing") as Extract<UIImg, { kind: "existing" }>[];
      const newInUI = uiImages.filter((x) => x.kind === "new") as Extract<UIImg, { kind: "new" }>[];

      // 3a) update sort_order for existing that remain (we update by ID)
      for (let i = 0; i < uiImages.length; i++) {
        const img = uiImages[i];
        if (img.kind === "existing") {
          const up = await supabase.from("marketplace_images").update({ sort_order: i }).eq("id", img.id);
          if (up.error) throw new Error(up.error.message);
        }
      }

      // 3b) upload new images and insert rows at their UI position
      // we need to insert with correct sort_order, then we "normalize" all sort_order to 0..n-1 at end
      for (let i = 0; i < uiImages.length; i++) {
        const img = uiImages[i];
        if (img.kind !== "new") continue;

        const file = img.file;
        const ext = safeExtFromFileName(file.name);
        const filename = `${Date.now()}_${i}.${ext}`;
        const path = `${item.user_id}/${item.id}/${filename}`;

        const up = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (up.error) throw new Error(`Upload image impossible: ${up.error.message}`);

        const ins = await supabase.from("marketplace_images").insert({
          item_id: item.id,
          path,
          sort_order: i,
        });
        if (ins.error) throw new Error(`DB image impossible: ${ins.error.message}`);
      }

      // 3c) Normalize sort_order from DB according to current UI order:
      // reload db image IDs by path for determinism
      const imgRes = await supabase
        .from("marketplace_images")
        .select("id,path,sort_order")
        .eq("item_id", item.id);

      if (imgRes.error) throw new Error(imgRes.error.message);
      const dbNow = (imgRes.data ?? []) as { id: string; path: string; sort_order: number }[];

      // Build mapping from UI to db id
      // existing: by id, new: by path (we don't have id in UI)
      // So we reconstruct UI order as array of db ids:
      const orderedDbIds: string[] = [];
      for (const ui of uiImages) {
        if (ui.kind === "existing") {
          orderedDbIds.push(ui.id);
        } else {
          // find the db row which has sort_order equal to its UI insertion (i)
          // safer: find by path prefix userId/itemId and newest sort_order i
          // We’ll match by sort_order position first, then fallback to "not used yet"
          // (works because we inserted with the correct i above)
          // eslint-disable-next-line no-loop-func
          const match = dbNow.find((r) => r.sort_order === orderedDbIds.length && !orderedDbIds.includes(r.id));
          if (match) orderedDbIds.push(match.id);
          else {
            // fallback: take any remaining not included
            const fallback = dbNow.find((r) => !orderedDbIds.includes(r.id));
            if (fallback) orderedDbIds.push(fallback.id);
          }
        }
      }

      // final normalize
      for (let i = 0; i < orderedDbIds.length; i++) {
        const up = await supabase.from("marketplace_images").update({ sort_order: i }).eq("id", orderedDbIds[i]);
        if (up.error) throw new Error(up.error.message);
      }

      // 4) done
      router.push(`/player/marketplace/${item.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur enregistrement.");
    } finally {
      setSaving(false);
      setBusyImages(false);
    }
  }

  /* -------------------- RENDER -------------------- */

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Modifier une annonce
              </div>
              <div className="marketplace-filter-label" style={{ marginTop: 6, marginBottom: 8 }}>
                {item?.title ?? "—"}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link
                className="cta-green cta-green-inline"
                href={item ? `/player/marketplace/${item.id}` : "/player/marketplace"}
              >
                Voir l’annonce
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/marketplace/mine">
                Mes annonces
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Form */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div>Chargement…</div>
            ) : !item ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontWeight: 900 }}>Impossible de charger l’annonce</div>
                <div style={{ color: "rgba(0,0,0,0.60)", fontWeight: 800, fontSize: 13 }}>
                  {error ?? "Erreur."}
                </div>
                <Link className="btn" href="/player/marketplace/mine">
                  Retour
                </Link>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveAll();
                }}
                style={{ display: "grid", gap: 12 }}
              >
                {/* Titre */}
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Titre</span>
                  <input
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    disabled={saving || busyImages}
                  />
                </label>

                {/* Catégorie / État */}
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.byCategory")}</span>
                    <select
                      value={form.category}
                      onChange={(e) => set("category", e.target.value)}
                      disabled={saving || busyImages}
                    >
                      <option value="">-</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.condition")}</span>
                    <select
                      value={form.condition}
                      onChange={(e) => set("condition", e.target.value)}
                      disabled={saving || busyImages}
                    >
                      <option value="">-</option>
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Marque / Modèle */}
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Marque (optionnel)</span>
                    <input value={form.brand} onChange={(e) => set("brand", e.target.value)} disabled={saving || busyImages} />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.modelOptional")}</span>
                    <input value={form.model} onChange={(e) => set("model", e.target.value)} disabled={saving || busyImages} />
                  </label>
                </div>

                {/* Description */}
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Description</span>
                  <textarea
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    disabled={saving || busyImages}
                    style={{ minHeight: 120 }}
                  />
                </label>

                <div className="hr-soft" />

                {/* Prix */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Prix</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ ...chipRadioStyle, ...(saleMode === "SELL" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        name="saleMode"
                        checked={saleMode === "SELL"}
                        onChange={() => setMode("SELL")}
                        disabled={saving || busyImages}
                      />
                      <span>{t("marketplace.sell")}</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(saleMode === "GIVE" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        name="saleMode"
                        checked={saleMode === "GIVE"}
                        onChange={() => setMode("GIVE")}
                        disabled={saving || busyImages}
                      />
                      <span>{t("marketplace.free")}</span>
                    </label>
                  </div>

                  {saleMode === "SELL" && (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Prix en CHF</span>
                      <input
                        type="number"
                        step="0.5"
                        inputMode="decimal"
                        value={form.price}
                        onChange={(e) => set("price", e.target.value)}
                        disabled={saving || busyImages}
                      />
                    </label>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Contact */}
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Email de contact</span>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => set("contact_email", e.target.value)}
                      disabled={saving || busyImages}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.phone")}</span>
                    <input
                      value={form.contact_phone}
                      onChange={(e) => set("contact_phone", e.target.value)}
                      disabled={saving || busyImages}
                    />
                  </label>
                </div>

                <div className="hr-soft" />

                {/* Images — SAME MODULE AS NEW */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>
                    Images <span style={{ opacity: 0.65 }}>({uiImages.length}/{MAX_IMAGES})</span>
                  </div>

                  <input
                    id="edit-images-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onPickFiles}
                    disabled={saving || busyImages || uiImages.length >= MAX_IMAGES}
                    style={{ display: "none" }}
                  />

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDropZoneDrop}
                    role="button"
                    tabIndex={0}
                    onClick={() => document.getElementById("edit-images-input")?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        document.getElementById("edit-images-input")?.click();
                    }}
                    style={{
                      border: "1px dashed rgba(0,0,0,0.18)",
                      background: "rgba(255,255,255,0.55)",
                      borderRadius: 14,
                      padding: 14,
                      cursor: saving || busyImages || uiImages.length >= MAX_IMAGES ? "not-allowed" : "pointer",
                      opacity: busyImages || saving ? 0.7 : 1,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900, color: "rgba(0,0,0,0.75)" }}>
                        Glisse-dépose tes images ici
                      </div>

                      <button
                        type="button"
                        className="btn"
                        style={compactBtnStyle}
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById("edit-images-input")?.click();
                        }}
                        disabled={saving || busyImages || uiImages.length >= MAX_IMAGES}
                      >
                        Ajouter des images
                      </button>
                    </div>
                  </div>

                  {uiImages.length > 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                      {uiImages.map((img, idx) => {
                        const isOver = overIndex === idx && dragIndex !== null && dragIndex !== idx;

                        return (
                          <div
                            key={img.kind === "existing" ? img.id : img.tempId}
                            draggable={!saving && !busyImages}
                            onDragStart={(e) => onThumbDragStart(idx, e)}
                            onDragOver={(e) => onThumbDragOver(idx, e)}
                            onDrop={(e) => onThumbDrop(idx, e)}
                            onDragEnd={onThumbDragEnd}
                            style={{
                              position: "relative",
                              borderRadius: 12,
                              outline: isOver ? "2px solid rgba(53,72,59,0.55)" : "none",
                              outlineOffset: 2,
                              opacity: dragIndex === idx ? 0.7 : 1,
                              cursor: saving || busyImages ? "not-allowed" : "grab",
                            }}
                            title={t("marketplace.dragToReorder")}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={`img-${idx}`}
                              style={{
                                width: 120,
                                height: 90,
                                objectFit: "cover",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.10)",
                                display: "block",
                              }}
                            />

                            {idx === 0 && (
                              <div
                                style={{
                                  position: "absolute",
                                  left: 6,
                                  top: 6,
                                  padding: "3px 7px",
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 900,
                                  background: "rgba(0,0,0,0.55)",
                                  color: "#fff",
                                }}
                              >
                                Principale
                              </div>
                            )}

                            <button
                              type="button"
                              className="btn"
                              onClick={() => removeImage(idx)}
                              style={{
                                position: "absolute",
                                top: 6,
                                right: 6,
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                cursor: "pointer",
                                padding: 0,
                              }}
                              disabled={saving || busyImages}
                              aria-label="Supprimer l’image"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Active */}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <label className={`toggle ${form.is_active ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => set("is_active", e.target.checked)}
                      disabled={saving || busyImages}
                    />
                    <span className="toggle-track">
                      <span className="toggle-thumb" />
                    </span>
                    <span className="toggle-label">{form.is_active ? "Actif" : "Inactif"}</span>
                  </label>
                </div>

                {/* Enregistrer (compact, à droite) */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button className="btn" type="submit" disabled={saving || busyImages} style={compactBtnStyle}>
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- LOCAL STYLES (no global CSS changes) -------------------- */

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

const chipRadioStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "rgba(255,255,255,0.70)",
  fontWeight: 900,
  fontSize: 13,
  color: "rgba(0,0,0,0.78)",
  cursor: "pointer",
  userSelect: "none",
};

const chipRadioActive: React.CSSProperties = {
  borderColor: "rgba(53,72,59,0.35)",
  background: "rgba(53,72,59,0.10)",
};

const compactBtnStyle: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  fontSize: 13,
  fontWeight: 800,
  borderRadius: 10,
};
