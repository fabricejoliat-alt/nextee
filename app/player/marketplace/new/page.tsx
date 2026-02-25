"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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

export default function MarketplaceNew() {
  const { t } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [clubId, setClubId] = useState("");

  // champs annonce
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("");
  const [condition, setCondition] = useState<string>("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");

  // prix
  const [saleMode, setSaleMode] = useState<"SELL" | "GIVE">("SELL");
  const isFree = saleMode === "GIVE";
  const [price, setPrice] = useState<string>("");

  // contact
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // confirmation obligatoire
  const [confirmOk, setConfirmOk] = useState(false);

  // images
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  // uploader
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // ✅ DnD reorder thumbnails
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const canPublish = useMemo(() => {
    if (busy) return false;
    if (title.trim().length < 3) return false;
    if (!category) return false;
    if (!condition) return false;
    if (!contactEmail.trim()) return false;
    if (!confirmOk) return false;

    if (!isFree) {
      const v = Number(price);
      if (price.trim() === "" || Number.isNaN(v) || v <= 0) return false;
    }
    return true;
  }, [title, category, condition, isFree, price, contactEmail, busy, confirmOk]);

  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        setError("Session invalide. Reconnecte-toi.");
        setLoading(false);
        return;
      }

      const uid = userRes.user.id;
      const email = userRes.user.email ?? "";
      setUserId(uid);
      setContactEmail(email);

      const memRes = await supabase
        .from("club_members")
        .select("club_id")
        .eq("user_id", uid)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (memRes.error) {
        setError(memRes.error.message);
        setLoading(false);
        return;
      }

      if (!memRes.data?.club_id) {
        setError(t("marketplace.noActiveClub"));
        setLoading(false);
        return;
      }

      setClubId(memRes.data.club_id as string);

      const profRes = await supabase.from("profiles").select("phone").eq("id", uid).maybeSingle();
      if (!profRes.error) setContactPhone((profRes.data?.phone ?? "").toString());

      setLoading(false);
    })();
  }, []);

  function addPickedFiles(picked: File[]) {
    const images = picked.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setFiles((prev) => [...prev, ...images].slice(0, 5));
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    addPickedFiles(picked);
    e.target.value = "";
  }

  function removeFile(idx: number) {
    setFiles((arr) => arr.filter((_, i) => i !== idx));
  }

  function setMode(next: "SELL" | "GIVE") {
    setSaleMode(next);
    if (next === "GIVE") setPrice("");
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  // Dropzone add-images DnD
  function onDropZoneDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (busy) return;
    if (files.length >= 5) return;

    addPickedFiles(Array.from(e.dataTransfer.files ?? []));
  }

  function onDropZoneDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!busy && files.length < 5) setDragOver(true);
  }

  function onDropZoneDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  // ✅ Thumbnails reorder DnD
  function onThumbDragStart(idx: number, e: React.DragEvent) {
    if (busy) return;
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
    if (busy) return;
    e.preventDefault(); // required to allow drop
    setOverIndex(idx);
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      // ignore
    }
  }

  function onThumbDrop(idx: number, e: React.DragEvent) {
    if (busy) return;
    e.preventDefault();

    let from: number | null = dragIndex;

    // fallback: read from dataTransfer
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

    setFiles((arr) => {
      if (from! < 0 || from! >= arr.length) return arr;
      if (idx < 0 || idx >= arr.length) return arr;

      const next = [...arr];
      const [moved] = next.splice(from!, 1);
      next.splice(idx, 0, moved);
      return next;
    });

    setDragIndex(null);
    setOverIndex(null);
  }

  function onThumbDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!clubId || !userId) return;

    setBusy(true);
    setError(null);

    const finalPrice = isFree ? null : Number(price);
    if (!isFree && (price.trim() === "" || Number.isNaN(finalPrice) || finalPrice <= 0)) {
      setError("Prix invalide.");
      setBusy(false);
      return;
    }

    const insertRes = await supabase
      .from("marketplace_items")
      .insert({
        club_id: clubId,
        user_id: userId,

        title: title.trim(),
        description: description.trim() || null,

        category,
        condition,
        brand: brand.trim() || null,
        model: model.trim() || null,

        is_free: isFree,
        price: finalPrice,

        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim() || null,

        is_active: true,
        attributes: {},
      })
      .select("id")
      .single();

    if (insertRes.error) {
      setError(insertRes.error.message);
      setBusy(false);
      return;
    }

    const itemId = insertRes.data.id as string;

    // upload images in current order: index 0 = principale
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
      const filename = `${Date.now()}_${i}.${safeExt}`;
      const path = `${userId}/${itemId}/${filename}`;

      const up = await supabase.storage.from("marketplace").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (up.error) {
        setError(`Upload image impossible: ${up.error.message}`);
        setBusy(false);
        return;
      }

      const imgRow = await supabase.from("marketplace_images").insert({
        item_id: itemId,
        path,
        sort_order: i,
      });

      if (imgRow.error) {
        setError(`DB image impossible: ${imgRow.error.message}`);
        setBusy(false);
        return;
      }
    }

    router.push("/player/marketplace");
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Publier une annonce
              </div>

              <div className="marketplace-filter-label" style={{ marginTop: 6, marginBottom: 8 }}>
                Les annonces ne sont visibles que par les juniors de ton club
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/marketplace">
                Retour
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
            ) : (
              <form onSubmit={publish} style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Titre</span>
                  <input
                    placeholder='Ex: Putter Scotty Cameron 34"'
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.byCategory")}</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
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
                    <select value={condition} onChange={(e) => setCondition(e.target.value)} disabled={busy}>
                      <option value="">-</option>
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Marque (optionnel)</span>
                    <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={busy} />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.modelOptional")}</span>
                    <input value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} />
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Description</span>
                  <textarea
                    placeholder={t("marketplace.descriptionPlaceholder")}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={busy}
                    style={{ minHeight: 120 }}
                  />
                </label>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Prix</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ ...chipRadioStyle, ...(saleMode === "SELL" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        name="saleMode"
                        checked={saleMode === "SELL"}
                        onChange={() => setMode("SELL")}
                        disabled={busy}
                      />
                      <span>{t("marketplace.sell")}</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(saleMode === "GIVE" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        name="saleMode"
                        checked={saleMode === "GIVE"}
                        onChange={() => setMode("GIVE")}
                        disabled={busy}
                      />
                      <span>{t("marketplace.free")}</span>
                    </label>
                  </div>

                  {!isFree && (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Prix en CHF</span>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="Ex: 120"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                </div>

                <div className="hr-soft" />

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Email de contact</span>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      disabled={busy}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("marketplace.phone")}</span>
                    <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={busy} />
                  </label>
                </div>

                <div className="hr-soft" />

                {/* Images */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>
                    Images <span style={{ opacity: 0.65 }}>({files.length}/5)</span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onPickFiles}
                    disabled={busy || files.length >= 5}
                    style={{ display: "none" }}
                  />

                  {/* Dropzone pour AJOUTER */}
                  <div
                    onDrop={onDropZoneDrop}
                    onDragOver={onDropZoneDragOver}
                    onDragLeave={onDropZoneDragLeave}
                    role="button"
                    tabIndex={0}
                    onClick={openFilePicker}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openFilePicker();
                    }}
                    style={{
                      border: `1px dashed ${dragOver ? "rgba(53,72,59,0.55)" : "rgba(0,0,0,0.18)"}`,
                      background: dragOver ? "rgba(53,72,59,0.08)" : "rgba(255,255,255,0.55)",
                      borderRadius: 14,
                      padding: 14,
                      cursor: busy || files.length >= 5 ? "not-allowed" : "pointer",
                      opacity: busy ? 0.7 : 1,
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
                        onClick={(e) => {
                          e.stopPropagation();
                          openFilePicker();
                        }}
                        disabled={busy || files.length >= 5}
                      >
                        Ajouter des images
                      </button>
                    </div>
                  </div>

                  {/* Thumbnails (réordonner) */}
                  {files.length > 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                      {previews.map((src, idx) => {
                        const isOver = overIndex === idx && dragIndex !== null && dragIndex !== idx;

                        return (
                          <div
                            key={idx}
                            draggable={!busy}
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
                              cursor: busy ? "not-allowed" : "grab",
                            }}
                            title={t("marketplace.dragToReorder")}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={`preview-${idx}`}
                              style={{
                                width: 120,
                                height: 90,
                                objectFit: "cover",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.10)",
                                display: "block",
                              }}
                            />

                            {/* Principale sur la première */}
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

                            {/* Supprimer */}
                            <button
                              type="button"
                              className="btn"
                              onClick={() => removeFile(idx)}
                              style={{
                                position: "absolute",
                                top: 6,
                                right: 6,
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                cursor: "pointer",
                              }}
                              disabled={busy}
                              aria-label="Supprimer"
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

                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={confirmOk}
                    onChange={(e) => setConfirmOk(e.target.checked)}
                    disabled={busy}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.70)", lineHeight: 1.25 }}>
                    Je confirme que l’article est conforme et que mes informations de contact sont correctes.
                  </span>
                </label>

                <button
                  className="btn"
                  type="submit"
                  disabled={!canPublish || busy}
                  style={{
                    width: "100%",
                    background: "var(--green-dark)",
                    borderColor: "var(--green-dark)",
                    color: "#fff",
                  }}
                >
                  {busy ? "Publication…" : "Publier"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
