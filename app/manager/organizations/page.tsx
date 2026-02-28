"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

export default function ManagerOrganizationsPage() {
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const headers = await authHeader();
      const res = await fetch("/api/manager/my-clubs", {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error ?? (locale === "fr" ? "Erreur de chargement" : "Loading error"));
        setRows([]);
        setLoading(false);
        return;
      }

      const mapped = (Array.isArray(json?.clubs) ? json.clubs : [])
        .map((c: any) => ({
          id: String(c?.id ?? ""),
          name: String(c?.name ?? "Club"),
        }))
        .filter((c: { id: string }) => Boolean(c.id))
        .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
      setRows(mapped);
      setLoading(false);
    })();
  }, [locale]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {locale === "fr" ? "Gestion des groupes" : "Groups management"}
            </div>
          </div>
          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div>{locale === "fr" ? "Chargement…" : "Loading…"}</div>
            ) : rows.length === 0 ? (
              <div style={{ opacity: 0.7 }}>
                {locale === "fr" ? "Aucun club manager trouvé." : "No managed club found."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {rows.map((r) => (
                  <div key={r.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>{r.name}</div>
                      <Link className="btn" href={`/manager/organizations/${r.id}/groups`}>
                        {locale === "fr" ? "Ouvrir" : "Open"}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
