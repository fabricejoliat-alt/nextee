"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ParentChildConsent = {
  playerId: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  isPrimary: boolean;
  consentStatus: "granted" | "pending" | "adult";
  pending: boolean;
};

type ConsentPayload =
  | {
      viewerRole: "parent";
      children: ParentChildConsent[];
      pendingChildren: string[];
    }
  | {
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

const SELECTED_CHILD_KEY = "parent:selected_child_id";

function fullName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim() || "votre enfant";
}

export default function PlayerConsentGate() {
  const [data, setData] = useState<ConsentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentConsentChecked, setParentConsentChecked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) {
        setData(null);
        return;
      }
      const res = await fetch("/api/player/consent", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Erreur de chargement du consentement"));
      setData(json as ConsentPayload);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement du consentement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const selectedPendingChild = useMemo(() => {
    if (!data || data.viewerRole !== "parent") return null;
    const pendingChildren = data.children.filter((child) => child.pending);
    if (pendingChildren.length === 0) return null;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_CHILD_KEY) : null;
    return (
      pendingChildren.find((child) => child.playerId === stored) ??
      pendingChildren.find((child) => child.isPrimary) ??
      pendingChildren[0]
    );
  }, [data]);

  async function submitParentConsent() {
    if (!selectedPendingChild || !parentConsentChecked || busy) return;
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
          action: "grant",
          playerId: selectedPendingChild.playerId,
          confirmed: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Impossible d'enregistrer le consentement"));
      setParentConsentChecked(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'enregistrer le consentement");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) return null;

  const showParentModal = data.viewerRole === "parent" && Boolean(selectedPendingChild);

  return (
    <>
      {showParentModal && selectedPendingChild ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(17, 24, 39, 0.48)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(760px, 100%)",
              maxHeight: "min(76vh, 720px)",
              overflow: "hidden",
              borderRadius: 24,
              background: "#fffdf7",
              boxShadow: "0 28px 70px rgba(17,24,39,0.28)",
              border: "1px solid rgba(124, 98, 42, 0.18)",
              display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr) auto",
            }}
          >
            <div style={{ display: "grid", gap: 6, padding: 22, borderBottom: "1px solid rgba(124, 98, 42, 0.12)" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#2b2517" }}>Consentement à l'utilisation d'ActiviTee</div>
              <div style={{ color: "#6c6354", fontSize: 14 }}>
                Enfant concerné : <b>{fullName(selectedPendingChild.firstName, selectedPendingChild.lastName)}</b>
              </div>
            </div>

            <div style={{ overflow: "auto", padding: 22, display: "grid", gap: 16 }}>
              <div style={{ color: "#413829", fontSize: 15, lineHeight: 1.7, display: "grid", gap: 12 }}>
                <p style={{ margin: 0 }}>
                  En qualité de représentant légal, j'autorise {fullName(selectedPendingChild.firstName, selectedPendingChild.lastName)} à
                  utiliser l'application ActiviTee dans le cadre de son suivi sportif.
                </p>
                <p style={{ margin: 0 }}>
                  Cette application permet notamment à mon enfant de consulter son planning, suivre ses entraînements et compétitions,
                  enregistrer ses résultats, communiquer avec ses coachs et recevoir les informations utiles à l'organisation de son
                  activité sportive.
                </p>
                <p style={{ margin: 0 }}>
                  Les données utilisées dans l'application peuvent inclure son identité, sa date de naissance, ses informations sportives,
                  ses évaluations, ses messages liés aux événements, ainsi que les documents déposés par l'encadrement sportif lorsqu'ils
                  sont nécessaires à son accompagnement.
                </p>
                <p style={{ margin: 0 }}>
                  En validant ce consentement, je confirme être habilité à autoriser l'utilisation d'ActiviTee pour mon enfant et je
                  comprends que ce consentement pourra être réévalué ou retiré en contactant le club ou l'équipe encadrante.
                </p>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: 14,
                  borderRadius: 14,
                  background: "rgba(53,72,59,0.06)",
                  border: "1px solid rgba(53,72,59,0.12)",
                }}
              >
                <input
                  type="checkbox"
                  checked={parentConsentChecked}
                  onChange={(e) => setParentConsentChecked(e.target.checked)}
                  style={{ marginTop: 4 }}
                />
                <span style={{ fontSize: 14, lineHeight: 1.55, color: "#2b2517" }}>
                  Je consens à ce que mon enfant utilise l'application ActiviTee.
                </span>
              </label>

              {error ? <div style={{ color: "#9d2d00", fontSize: 13 }}>{error}</div> : null}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
                padding: 22,
                borderTop: "1px solid rgba(124, 98, 42, 0.12)",
              }}
            >
              <div style={{ color: "#6c6354", fontSize: 13 }}>
                Cette demande restera affichée tant qu'un enfant lié à votre compte est en attente de consentement.
              </div>
              <button className="btn" type="button" onClick={submitParentConsent} disabled={!parentConsentChecked || busy}>
                {busy ? "Validation…" : "Valider"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
