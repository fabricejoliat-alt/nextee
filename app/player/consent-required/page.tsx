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
    consentStatus: "granted" | "pending" | "adult";
    pending: boolean;
  };
};

export default function PlayerConsentRequiredPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState("");

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
        setBirthDate(payload.player.birthDate ?? "");
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submitAdultDeclaration() {
    if (!birthDate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const res = await fetch("/api/player/consent", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "declare_adult",
          birthDate,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Impossible de mettre à jour le consentement"));
      router.replace("/player");
    } catch (e: any) {
      setError(e?.message ?? "Impossible de mettre à jour le consentement");
    } finally {
      setBusy(false);
    }
  }

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
              Ton accès à ActiviTee est momentanément bloqué tant que ton consentement est en attente. Pour utiliser l'application, l'un
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
            <div style={{ fontSize: 17, fontWeight: 800, color: "#2f4335" }}>Alternative si tu es majeur</div>
            <div style={{ color: "#536356", fontSize: 13, lineHeight: 1.5 }}>
              Si tu es majeur, tu peux confirmer ta date de naissance ci-dessous. Si tu as 18 ans ou plus, ton statut passera à
              <b> Majeur</b> et tu pourras accéder immédiatement à l'application.
            </div>

            <div className="field auth-field">
              <label>Date de naissance</label>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>

            <button className="cta-green auth-submit" type="button" onClick={submitAdultDeclaration} disabled={busy || !birthDate || loading}>
              {busy ? "Validation…" : "Je suis majeur"}
            </button>
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
