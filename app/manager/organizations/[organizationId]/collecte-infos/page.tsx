"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type IntakeConfig = {
  club_id: string;
  club_name: string;
  public_token: string | null;
  is_enabled: boolean;
  title: string;
  subtitle: string | null;
  intro_text: string;
  recipient_email: string;
  success_message: string;
};

export default function ManagerOrganizationCollecteInfosPage() {
  const params = useParams<{ organizationId: string }>();
  const clubId = String(params?.organizationId ?? "").trim();
  const [config, setConfig] = useState<IntakeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function load() {
    if (!clubId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/parent-intake-config`, { method: "GET", headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Chargement impossible"));
      setConfig((json?.config ?? null) as IntakeConfig | null);
    } catch (e: any) {
      setError(e?.message ?? "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clubId]);

  const publicHref = useMemo(() => {
    if (!config?.public_token) return "";
    const configured =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "";
    const normalizedConfigured = configured.trim().replace(/\/+$/, "");
    const baseUrl =
      normalizedConfigured && !/https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(normalizedConfigured)
        ? normalizedConfigured
        : "https://www.activitee.golf";
    return `${baseUrl}/parents/collecte-infos?token=${encodeURIComponent(config.public_token)}`;
  }, [config?.public_token]);

  async function save() {
    if (!clubId || !config) return;
    setSaving(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/parent-intake-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(config),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Enregistrement impossible"));
      setConfig((json?.config ?? null) as IntakeConfig | null);
    } catch (e: any) {
      setError(e?.message ?? "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, width: "min(980px, 100%)", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Collecte infos parents</h1>
          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
            Configure la page publique et récupère le lien à utiliser dans ton outil de mailing.
          </div>
        </div>
        <Link className="btn" href="/manager/organizations">
          Retour aux organisations
        </Link>
      </div>

      {error ? (
        <div style={{ border: "1px solid #ffcccc", background: "#fff5f5", color: "#a00", borderRadius: 12, padding: 12 }}>{error}</div>
      ) : null}

      <div className="card">
        {loading || !config ? (
          <div style={{ color: "var(--muted)" }}>Chargement...</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>{config.club_name}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={config.is_enabled}
                onChange={(e) => setConfig((prev) => (prev ? { ...prev, is_enabled: e.target.checked } : prev))}
              />
              Page active
            </label>
            <input className="input" value={config.title} onChange={(e) => setConfig((prev) => (prev ? { ...prev, title: e.target.value } : prev))} placeholder="Titre" />
            <input className="input" value={config.subtitle ?? ""} onChange={(e) => setConfig((prev) => (prev ? { ...prev, subtitle: e.target.value } : prev))} placeholder="Sous-titre" />
            <textarea className="input" rows={5} value={config.intro_text} onChange={(e) => setConfig((prev) => (prev ? { ...prev, intro_text: e.target.value } : prev))} placeholder="Texte d’introduction" />
            <input className="input" value={config.recipient_email} onChange={(e) => setConfig((prev) => (prev ? { ...prev, recipient_email: e.target.value } : prev))} placeholder="E-mail destinataire" />
            <input className="input" value={config.success_message} onChange={(e) => setConfig((prev) => (prev ? { ...prev, success_message: e.target.value } : prev))} placeholder="Message de succès" />

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Lien public</div>
              <input className="input" value={publicHref} readOnly />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={() => void save()} disabled={saving}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
              {publicHref ? (
                <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(publicHref)}>
                  Copier le lien
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
