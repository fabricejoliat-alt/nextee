"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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

type Item = {
  id: string;
  user_id: string;

  title: string;
  description: string | null;

  category: string | null;
  condition: string | null;
  brand: string | null;
  model: string | null;

  is_free: boolean | null;
  price: number | null;

  contact_email: string | null;
  contact_phone: string | null;
};

type Img = {
  id: string;
  item_id: string;
  path: string;
  sort_order: number;
};

export default function MarketplaceEdit() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  // form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [condition, setCondition] = useState<string>(CONDITIONS[1]);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");

  const [isFree, setIsFree] = useState(false);
  const [price, setPrice] = useState<string>("");

  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // images
  const [existingImgs, setExistingImgs] = useState<Img[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const previews = useMemo(() => newFiles.map((f) => URL.createObjectURL(f)), [newFiles]);

  const bucket = "marketplace";

  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (title.trim().length < 3) return false;
    if (!category || !condition) return false;
    if (!contactEmail.trim()) return false;

    if (!isFree) {
      const v = Number(price);
      if (price.trim() === "" || Number.isNaN(v) || v <= 0) return false;
    }
    return true;
  }, [busy, title, category, condition, isFree, price, contactEmail]);

  async function refreshImages(itemId: string) {
    const imgRes = await supabase
      .from("marketplace_images")
      .select("id,item_id,path,sort_order")
      .eq("item_id", itemId)
      .order("sort_order", { ascending: true });

    if (!imgRes.error) setExistingImgs((imgRes.data ?? []) as Img[]);
  }

  async function load() {
    if (!id) return;

    setLoading(true);
    setError(null);

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id ?? "";
    setMeId(uid);

    const itemRes = await supabase
      .from("marketplace_items")
      .select("id,user_id,title,description,category,condition,brand,model,is_free,price,contact_email,contact_phone")
      .eq("id", id)
      .maybeSingle();

    if (itemRes.error) {
      setError(itemRes.error.message);
      setLoading(false);
      return;
    }
    if (!itemRes.data) {
      setError("Annonce introuvable (ou accès refusé).");
      setLoading(false);
      return;
    }

    const it = itemRes.data as Item;

    // sécurité supplémentaire
    if (uid && it.user_id !== uid) {
      setError("Tu ne peux modifier que tes propres annonces.");
      setLoading(false);
      return;
    }

    setTitle(it.title ?? "");
    setCategory((it.category ?? CATEGORIES[0]) as string);
    setCondition((it.condition ?? CONDITIONS[1]) as string);
    setBrand(it.brand ?? "");
    setModel(it.model ?? "");
    setDescription(it.description ?? "");

    const free = !!it.is_free;
    setIsFree(free);
    setPrice(free ? "" : it.price == null ? "" : String(it.price));

    setContactEmail(it.contact_email ?? userRes?.user?.email ?? "");
    setContactPhone(it.contact_phone ?? "");

    await refreshImages(it.id);

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  function onToggleFree(v: boolean) {
    setIsFree(v);
    if (v) setPrice("");
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";

    const currentCount = existingImgs.length + newFiles.length;
    const remaining = Math.max(0, 5 - currentCount);

    setNewFiles((prev) => [...prev, ...picked].slice(0, prev.length + remaining));
  }

  function removeNewFile(idx: number) {
    setNewFiles((arr) => arr.filter((_, i) => i !== idx));
  }

  async function setAsMainPhoto(img: Img) {
    if (busy) return;
    if (img.sort_order === 0) return;

    setBusy(true);
    setError(null);

    // on swap sort_order avec la photo actuelle 0
    const currentMain = existingImgs.find((x) => x.sort_order === 0);

    // 1) mettre la photo cliquée à 0
    const a = await supabase.from("marketplace_images").update({ sort_order: 0 }).eq("id", img.id);
    if (a.error) {
      setError(a.error.message);
      setBusy(false);
      return;
    }

    // 2) mettre l'ancienne main (si existe) à l'ancien index de la photo cliquée
    if (currentMain) {
      const b = await supabase
        .from("marketplace_images")
        .update({ sort_order: img.sort_order })
        .eq("id", currentMain.id);

      if (b.error) {
        setError(b.error.message);
        setBusy(false);
        return;
      }
    }

    await refreshImages(img.item_id);
    setBusy(false);
  }

  async function deleteExistingImage(img: Img) {
    if (!confirm("Supprimer cette photo ?")) return;

    setBusy(true);
    setError(null);

    // delete storage
    const storageDel = await supabase.storage.from(bucket).remove([img.path]);
    if (storageDel.error) {
      setError(storageDel.error.message);
      setBusy(false);
      return;
    }

    // delete row
    const rowDel = await supabase.from("marketplace_images").delete().eq("id", img.id);
    if (rowDel.error) {
      setError(rowDel.error.message);
      setBusy(false);
      return;
    }

    await refreshImages(img.item_id);

    // si on a supprimé la photo principale, on force une nouvelle principale (= premier restant)
    const after = await supabase
      .from("marketplace_images")
      .select("id,sort_order")
      .eq("item_id", img.item_id)
      .order("sort_order", { ascending: true });

    if (!after.error) {
      const rows = (after.data ?? []) as { id: string; sort_order: number }[];
      if (rows.length > 0) {
        const hasMain = rows.some((r) => r.sort_order === 0);
        if (!hasMain) {
          await supabase.from("marketplace_images").update({ sort_order: 0 }).eq("id", rows[0].id);
        }
      }
    }

    await refreshImages(img.item_id);
    setBusy(false);
  }

  async function uploadNewImages(itemId: string) {
    if (newFiles.length === 0) return;

    // on ajoute à la suite (et on renumérote après)
    const startIndex = existingImgs.length;

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
      const filename = `${Date.now()}_${i}.${safeExt}`;

      const path = `${meId}/${itemId}/${filename}`;

      const up = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (up.error) throw new Error(`Upload image impossible: ${up.error.message}`);

      const ins = await supabase.from("marketplace_images").insert({
        item_id: itemId,
        path,
        sort_order: startIndex + i,
      });
      if (ins.error) throw new Error(`DB image impossible: ${ins.error.message}`);
    }

    setNewFiles([]);
    await refreshImages(itemId);
  }

  async function save() {
    if (!id) return;

    setBusy(true);
    setError(null);

    const finalPrice = isFree ? null : Number(price);
    if (!isFree && (price.trim() === "" || Number.isNaN(finalPrice) || finalPrice <= 0)) {
      setError("Prix invalide.");
      setBusy(false);
      return;
    }

    // IMPORTANT: on a retiré Remise/Livraison → on ne touche plus à la colonne delivery ici
    const upRes = await supabase
      .from("marketplace_items")
      .update({
        title: title.trim(),
        category,
        condition,
        brand: brand.trim() || null,
        model: model.trim() || null,
        description: description.trim() || null,
        is_free: isFree,
        price: finalPrice,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      })
      .eq("id", id);

    if (upRes.error) {
      setError(upRes.error.message);
      setBusy(false);
      return;
    }

    try {
      await uploadNewImages(id);
    } catch (e: any) {
      setError(e?.message ?? "Erreur upload images");
      setBusy(false);
      return;
    }

    router.push("/player/marketplace/mine");
  }

  const existingUrls = useMemo(() => {
    return existingImgs.map((img) => {
      const { data } = supabase.storage.from(bucket).getPublicUrl(img.path);
      return { ...img, url: data?.publicUrl ?? "" };
    });
  }, [existingImgs]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 900 }}>Modifier l’annonce</h1>
            <p style={{ color: "var(--muted)", marginTop: 6 }}>Clique sur une photo pour la définir comme principale.</p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Link className="btn btn-secondary" href="/player/marketplace/mine">Retour</Link>
            <button className="btn" onClick={save} disabled={!canSave}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
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
          <div style={{ display: "grid", gap: 12, maxWidth: 820 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} disabled={busy} />

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

            <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 120 }} disabled={busy} />

            {/* Prix */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900 }}>Prix</div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={pillStyle}>
                  <input type="radio" name="priceMode" checked={isFree} onChange={() => onToggleFree(true)} disabled={busy} />
                  <span>À donner</span>
                </label>

                <label style={pillStyle}>
                  <input type="radio" name="priceMode" checked={!isFree} onChange={() => onToggleFree(false)} disabled={busy} />
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
                  <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={inputStyle} disabled={busy} />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>Téléphone</span>
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={inputStyle} disabled={busy} />
                </label>
              </div>
            </div>

            {/* Photos */}
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>Photos (max 5)</div>

              {existingUrls.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>Aucune photo.</div>
              ) : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {existingUrls.map((img) => (
                    <div key={img.id} style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setAsMainPhoto(img)}
                        disabled={busy}
                        title={img.sort_order === 0 ? "Photo principale" : "Définir comme photo principale"}
                        style={{
                          border: img.sort_order === 0 ? "2px solid black" : "1px solid var(--border)",
                          borderRadius: 12,
                          padding: 0,
                          background: "white",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                        aria-label="Définir comme photo principale"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt="photo"
                          style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 10, display: "block" }}
                        />
                      </button>

                      {img.sort_order === 0 && (
                        <div
                          style={{
                            position: "absolute",
                            left: 8,
                            bottom: 8,
                            background: "rgba(0,0,0,0.75)",
                            color: "white",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 900,
                          }}
                        >
                          Principale
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => deleteExistingImage(img)}
                        disabled={busy}
                        style={{ position: "absolute", top: 6, right: 6, width: 34, height: 34, borderRadius: 10, padding: 0 }}
                        aria-label="Supprimer photo"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onPickFiles}
                disabled={busy || existingImgs.length + newFiles.length >= 5}
              />

              {newFiles.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Nouvelles photos</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {previews.map((src, idx) => (
                      <div key={idx} style={{ position: "relative" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`new-${idx}`}
                          style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }}
                        />
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => removeNewFile(idx)}
                          disabled={busy}
                          style={{ position: "absolute", top: 6, right: 6, width: 34, height: 34, borderRadius: 10, padding: 0 }}
                          aria-label="Retirer"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                La photo principale est celle avec <b>sort_order = 0</b>.
              </div>
            </div>

            <button className="btn" onClick={save} disabled={!canSave}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
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
