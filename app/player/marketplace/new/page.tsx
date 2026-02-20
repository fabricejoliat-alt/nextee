"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
  "Télémètre",
  "Chaussures",
  "Textile",
  "Accessoires",
  "Divers",
] as const;

const CONDITIONS = ["Neuf", "Comme neuf", "Bon état", "À réparer"] as const;

export default function MarketplaceNew() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [clubId, setClubId] = useState("");

  // champs annonce
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(""); // "-" par défaut
  const [condition, setCondition] = useState<string>(""); // "-" par défaut
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");

  // prix
  const [saleMode, setSaleMode] = useState<"SELL" | "GIVE">("SELL"); // À vendre / À donner
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

  // uploader plus sympa
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
        setError("Ton compte n’est pas lié à un club actif.");
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

  // ✅ App-like: réordonner / définir principale
  function setAsMain(idx: number) {
    setFiles((arr) => {
      if (idx <= 0 || idx >= arr.length) return arr;
      const next = [...arr];
      const [picked] = next.splice(idx, 1);
      next.unshift(picked);
      return next;
    });
  }

  function moveLeft(idx: number) {
    setFiles((arr) => {
      if (idx <= 0 || idx >= arr.length) return arr;
      const next = [...arr];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveRight(idx: number) {
    setFiles((arr) => {
      if (idx < 0 || idx >= arr.length - 1) return arr;
      const next = [...arr];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function setMode(next: "SELL" | "GIVE") {
    setSaleMode(next);
    if (next === "GIVE") setPrice("");
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (busy) return;
    if (files.length >= 5) return;

    const dropped = Array.from(e.dataTransfer.files ?? []);
    addPickedFiles(dropped);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!busy && files.length < 5) setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
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

              {/* ✅ plus d'espace au-dessus/dessous */}
              <div className="marketplace-filter-label" style={{ marginTop: 4, marginBottom: 6 }}>
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
                {/* Titre */}
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Titre</span>
                  <input
                    placeholder='Ex: Putter Scotty Cameron 34"'
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                </label>

                {/* Catégorie / État */}
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Catégorie</span>
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
                    <span style={fieldLabelStyle}>État</span>
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

                {/* Marque / Modèle */}
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Marque (optionnel)</span>
                    <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={busy} />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Modèle (optionnel)</span>
                    <input value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} />
                  </label>
                </div>

                {/* Description */}
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Description</span>
                  <textarea
                    placeholder="État, longueur, grip, détails importants..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={busy}
                    style={{ minHeight: 120 }}
                  />
                </label>

                <div className="hr-soft" />

                {/* Prix */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Prix</div>

                  {/* ✅ FIX: pas de spread null -> { } */}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ ...chipRadioStyle, ...(saleMode === "SELL" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        name="saleMode"
                        checked={saleMode === "SELL"}
                        onChange={() => setMode("SELL")}
                        disabled={busy}
                      />
                      <span>À vendre</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(saleMode === "GIVE" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        name="saleMode"
                        checked={saleMode === "GIVE"}
                        onChange={() => setMode("GIVE")}
                        disabled={busy}
                      />
                      <span>À donner</span>
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

                {/* Contact (sans titre) */}
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
                    <span style={fieldLabelStyle}>Téléphone</span>
                    <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={busy} />
                  </label>
                </div>

                <div className="hr-soft" />

                {/* Images — app-like */}
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

                  <div
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
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

                  {files.length > 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                      {previews.map((src, idx) => (
                        <div key={idx} style={{ position: "relative" }}>
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
                            }}
                          />

                          {/* Badge Principale */}
                          {idx === 0 ? (
                            <div
                              style={{
                                position: "absolute",
                                left: 6,
                                top: 6,
                                padding: "4px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 900,
                                background: "rgba(0,0,0,0.55)",
                                color: "#fff",
                              }}
                            >
                              Principale
                            </div>
                          ) : (
                            // ✅ Bouton "Définir principale"
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setAsMain(idx)}
                              disabled={busy}
                              style={{
                                position: "absolute",
                                left: 6,
                                top: 6,
                                height: 30,
                                padding: "0 10px",
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 900,
                                background: "rgba(255,255,255,0.92)",
                                borderColor: "rgba(0,0,0,0.12)",
                              }}
                            >
                              Définir principale
                            </button>
                          )}

                          {/* ✅ Réordre gauche/droite */}
                          <div style={{ position: "absolute", left: 6, bottom: 6, display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => moveLeft(idx)}
                              disabled={busy || idx === 0}
                              style={miniBtnStyle}
                              aria-label="Déplacer à gauche"
                            >
                              ←
                            </button>

                            <button
                              type="button"
                              className="btn"
                              onClick={() => moveRight(idx)}
                              disabled={busy || idx === files.length - 1}
                              style={miniBtnStyle}
                              aria-label="Déplacer à droite"
                            >
                              →
                            </button>
                          </div>

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
                            }}
                            disabled={busy}
                            aria-label="Supprimer"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Checkbox obligatoire */}
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

                {/* Publier en vert foncé */}
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

const miniBtnStyle: React.CSSProperties = {
  width: 34,
  height: 30,
  padding: 0,
  borderRadius: 10,
  fontWeight: 900,
};