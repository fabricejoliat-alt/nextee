"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ConsentPayload = {
  viewerRole: "player";
  player: {
    playerId: string;
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    consentStatus: "granted" | "pending" | "refused" | "adult";
    pending: boolean;
  };
};

export default function PlayerConsentRequiredPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) {
          router.replace("/");
          return;
        }
        const res = await fetch("/api/player/consent", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Erreur de chargement"));
        if (cancelled) return;
        const payload = json as ConsentPayload;
        if (payload.viewerRole !== "player" || !payload.player.pending) {
          router.replace("/player");
          return;
        }
      } catch (cause: unknown) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Erreur de chargement");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="auth-bg">
      <div className="auth-shell">
        <div className="auth-card consent-card" style={{ maxWidth: 640, display: "grid", gap: 16 }}>
          <div className="auth-brand-wrapper">
            <div className="auth-brand auth-brand--dark">
              <span className="auth-brand-nex">Activi</span>
              <span className="auth-brand-tee">Tee</span>
            </div>
            <div className="auth-tagline">Consentement requis</div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#2b2517" }}>Accès momentanément bloqué</div>
            <div style={{ color: "#5f5647", fontSize: 14, lineHeight: 1.5 }}>
              Ton accès à ActiviTee est momentanément bloqué tant que le consentement requis n’a pas été accordé. Pour utiliser l’application, l’un
              de tes parents doit se connecter avec son propre compte et valider le consentement.
            </div>
            <div style={{ color: "#5f5647", fontSize: 14, lineHeight: 1.5 }}>
              Dès que ce consentement est accordé, ton accès sera rétabli automatiquement.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
              padding: 14,
              borderRadius: 16,
              border: "1px solid rgba(53,72,59,0.10)",
              background: "rgba(53,72,59,0.05)",
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 800, color: "#2f4335" }}>Si tu es majeur</div>
            <div style={{ color: "#536356", fontSize: 13, lineHeight: 1.5 }}>
              Demande à ton club de vérifier ta date de naissance et de définir ton statut sur <b>Majeur</b>. Pour des raisons de
              sécurité, cette validation ne peut pas être faite depuis un compte joueur.
            </div>
          </div>

          {error ? <div className="auth-error">{error}</div> : null}
        </div>
      </div>
      <style>{`
        .consent-card {
          padding: 20px;
        }
        @media (max-width: 640px) {
          .consent-card {
            padding: 16px;
            gap: 14px !important;
            border-radius: 20px;
          }
        }
      `}</style>
    </div>
  );
}
