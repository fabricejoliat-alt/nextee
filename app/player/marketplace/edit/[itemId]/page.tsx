"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
  user_id: string; // ✅ propriétaire
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

export default function MarketplaceEditPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  const itemId = useMemo(() => {
    const fromParams = getParamString((params as any)?.itemId);
    return fromParams ?? getIdFromPathname(pathname);
  }, [params, pathname]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [item, setItem] = useState<Item | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    condition: "",
    brand: "",
    model: "",
    is_free: false,
    price: "" as string,
    contact_email: "",
    contact_phone: "",
    is_active: true,
  });

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
        .select("id,title,description,is_active,category,condition,brand,model,price,is_free,contact_email,contact_phone,user_id")
        .eq("id", itemId)
        .maybeSingle();

      if (itRes.error) throw new Error(itRes.error.message);
      if (!itRes.data) throw new Error("Annonce introuvable.");

      const it = itRes.data as Item;
      if (it.user_id !== uid) throw new Error("Tu ne peux pas modifier cette annonce.");

      setItem(it);
      setForm({
        title: it.title ?? "",
        description: it.description ?? "",
        category: it.category ?? "",
        condition: it.condition ?? "",
        brand: it.brand ?? "",
        model: it.model ?? "",
        is_free: !!it.is_free,
        price: it.price == null ? "" : String(it.price),
        contact_email: it.contact_email ?? "",
        contact_phone: it.contact_phone ?? "",
        is_active: !!it.is_active,
      });
    } catch (e: any) {
      setError(e?.message ?? "Erreur.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    if (!item) return;

    const title = form.title.trim();
    if (!title) {
      setError("Titre requis.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: any = {
        title,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        condition: form.condition.trim() || null,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        is_free: !!form.is_free,
        price: form.is_free ? null : form.price === "" ? null : Number(form.price),
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        is_active: !!form.is_active,
      };

      if (!form.is_free && form.price !== "" && Number.isNaN(payload.price)) {
        throw new Error("Prix invalide.");
      }

      const res = await supabase.from("marketplace_items").update(payload).eq("id", item.id);
      if (res.error) throw new Error(res.error.message);

      router.push(`/player/marketplace/${item.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    if (!confirm("Supprimer cette annonce ?")) return;

    setDeleting(true);
    setError(null);

    try {
      const r = await supabase.from("marketplace_items").delete().eq("id", item.id);
      if (r.error) throw new Error(r.error.message);

      router.push("/player/marketplace/mine");
    } catch (e: any) {
      setError(e?.message ?? "Erreur suppression.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  if (!item) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Modifier une annonce</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? "Erreur."}
          </div>
        </div>
        <Link className="btn" href="/player/marketplace">
          Retour
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Modifier l’annonce</div>
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>{item.title}</div>
          </div>

          <Link className="btn" href={`/player/marketplace/${item.id}`}>
            Retour
          </Link>
        </div>

        {error && <div style={{ color: "#a00" }}>{error}</div>}

        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Titre</div>
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Description</div>
            <textarea className="input" rows={5} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Catégorie</div>
              <input className="input" value={form.category} onChange={(e) => set("category", e.target.value)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>État</div>
              <input className="input" value={form.condition} onChange={(e) => set("condition", e.target.value)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Marque</div>
              <input className="input" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Modèle</div>
              <input className="input" value={form.model} onChange={(e) => set("model", e.target.value)} />
            </label>
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={form.is_free} onChange={(e) => set("is_free", e.target.checked)} />
              <span style={{ fontWeight: 800 }}>À donner</span>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Prix (CHF)</div>
              <input
                className="input"
                inputMode="decimal"
                disabled={form.is_free}
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Email de contact</div>
              <input className="input" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Téléphone de contact</div>
              <input className="input" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
            </label>
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            <span style={{ fontWeight: 800 }}>Annonce active</span>
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <button className="btn" type="button" onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>

            <button className="btn btn-danger" type="button" onClick={remove} disabled={deleting}>
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
