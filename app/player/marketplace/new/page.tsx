"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [condition, setCondition] = useState<string>(CONDITIONS[1]);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");

  // prix
  const [isFree, setIsFree] = useState(false);
  const [price, setPrice] = useState<string>("");

  // contact
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // images
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  const canPublish = useMemo(() => {
    if (busy) return false;
    if (title.trim().length < 3) return false;
    if (!category) return false;
    if (!condition) return false;

    // contact email minimal
    if (!contactEmail.trim()) return false;

    // prix: si pas "à donner", alors prix doit être un nombre > 0
    if (!isFree) {
      const v = Number(price);
      if (price.trim() === "" || Number.isNaN(v) || v <= 0) return false;
    }

    return true;
  }, [title, category, condition, isFree, price, contactEmail, busy]);

  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      // user
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

      // club
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

      // phone depuis profiles
      const profRes = await supabase.from("profiles").select("phone").eq("id", uid).maybeSingle();
      if (!profRes.error) {
        setContactPhone((profRes.data?.phone ?? "").toString());
      }

      setLoading(false);
    })();
  }, []);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    const images = picked.filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...images].slice(0, 5));
    e.target.value = "";
  }

  function removeFile(idx: number) {
    setFiles((arr) => arr.filter((_, i) => i !== idx));
  }

  function onToggleFree(v: boolean) {
    setIsFree(v);
    if (v) setPrice(""); // si à donner -> pas de prix
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

    // 1) créer annonce
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

    // 2) upload images
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
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 900 }}>Publier une annonce</h1>
            <p style={{ color: "var(--muted)", marginTop: 6 }}>Visible uniquement aux membres de ton club.</p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Link className="btn" href="/player/marketplace">Retour</Link>
            <Link className="btn" href="/player/marketplace/mine">Mes annonces</Link>
          </div>
        </div>

        {error && (
          <div style={{ border: "1px solid #ffcccc", background: "#fff5f5", padding: 12, borderRadius: 12, color: "#a00", marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div>Chargement…</div>
        ) : (
          <form onSubmit={publish} style={{ display: "grid", gap: 10, maxWidth: 720 }}>
            <input placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} disabled={busy} />

            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={labelStyle}>Catégorie</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} disabled={busy}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={labelStyle}>État</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value)} style={inputStyle} disabled={busy}>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <input placeholder="Marque (optionnel)" value={brand} onChange={(e) => setBrand(e.target.value)} style={inputStyle} disabled={busy} />
              <input placeholder="Modèle (optionnel)" value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle} disabled={busy} />
            </div>

            <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 110 }} disabled={busy} />

            {/* Prix */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900 }}>Prix</div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={pillStyle}>
                  <input
                    type="radio"
                    name="priceMode"
                    checked={isFree}
                    onChange={() => onToggleFree(true)}
                    disabled={busy}
                  />
                  <span>À donner</span>
                </label>

                <label style={pillStyle}>
                  <input
                    type="radio"
                    name="priceMode"
                    checked={!isFree}
                    onChange={() => onToggleFree(false)}
                    disabled={busy}
                  />
                  <span>Prix</span>
                </label>
              </div>

              {!isFree && (
                <input
                  type="number"
                  step="0.5"
                  placeholder="Prix en CHF"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={inputStyle}
                  disabled={busy}
                />
              )}
            </div>

            {/* Contact */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900 }}>Contact</div>

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>Email</span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    style={inputStyle}
                    disabled={busy}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>Téléphone</span>
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    style={inputStyle}
                    disabled={busy}
                  />
                </label>
              </div>

              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                L’email du compte est proposé par défaut, mais tu peux le modifier pour cette annonce.
              </div>
            </div>

            {/* Images */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900 }}>Photos (max 5)</div>
              <input type="file" accept="image/*" multiple onChange={onPickFiles} disabled={busy || files.length >= 5} />

              {files.length > 0 && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {previews.map((src, idx) => (
                      <div key={idx} style={{ position: "relative" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`preview-${idx}`} style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} />
                        <button type="button" className="btn" onClick={() => removeFile(idx)} style={{ position: "absolute", top: 6, right: 6, width: 34, height: 34, borderRadius: 10 }} disabled={busy}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    La première photo sera utilisée comme image principale.
                  </div>
                </div>
              )}
            </div>

            <button className="btn" type="submit" disabled={!canPublish || busy}>
              {busy ? "Publication…" : "Publier"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "var(--muted)",
};

const pillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "white",
  fontWeight: 800,
};
