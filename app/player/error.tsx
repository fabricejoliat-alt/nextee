"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function PlayerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Player route error", error);
  }, [error]);

  return (
    <div className="player-dashboard-bg">
      <main className="app-shell admin-shell manager-shell player-shell">
        <section className="glass-section" role="alert" style={{ maxWidth: 620, marginInline: "auto" }}>
          <div style={{ display: "grid", justifyItems: "start", gap: 14 }}>
            <span
              aria-hidden="true"
              style={{ width: 44, height: 44, borderRadius: 14, display: "grid", placeItems: "center", background: "#fff0ef", color: "#ad3d35" }}
            >
              <AlertTriangle size={22} />
            </span>
            <div>
              <h1 className="section-title" style={{ marginBottom: 6 }}>Cette page n’a pas pu être chargée</h1>
              <p className="section-subtitle" style={{ margin: 0 }}>
                Vérifiez votre connexion, puis relancez le chargement. Vos données déjà enregistrées ne sont pas supprimées.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={reset} style={{ minHeight: 44 }}>
              <RotateCcw size={16} aria-hidden="true" />
              Réessayer
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
