"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DevImpersonateCompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const doneRef = useRef(false);
  const [message, setMessage] = useState("Connexion au compte cible...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const complete = async (accessToken?: string | null) => {
      if (doneRef.current) return;
      if (!accessToken) return;
      doneRef.current = true;
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Could not resolve redirect."));
        router.replace(String(json?.redirectTo ?? "/player"));
      } catch (e: any) {
        setError(e?.message ?? "Connexion impossible.");
      }
    };

    const verifyFromQuery = async () => {
      const tokenHash = String(searchParams.get("token_hash") ?? "").trim();
      const type = String(searchParams.get("type") ?? "").trim();
      if (!tokenHash || !type) return false;

      setMessage("Ouverture de la session locale...");
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as any,
      });
      if (verifyError) {
        throw verifyError;
      }
      await complete(data.session?.access_token ?? null);
      return true;
    };

    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      void complete(session?.access_token ?? null);
    });

    void (async () => {
      try {
        const verified = await verifyFromQuery();
        if (verified || doneRef.current) return;

        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          await complete(data.session.access_token);
          return;
        }

        setMessage("Finalisation de la session...");
        window.setTimeout(async () => {
          const retry = await supabase.auth.getSession();
          await complete(retry.data.session?.access_token ?? null);
          if (!doneRef.current) {
            setError("Aucune session n'a été créée. Reviens à l'écran d'impersonation et réessaie.");
          }
        }, 1200);
      } catch (e: any) {
        setError(e?.message ?? "Connexion impossible.");
      }
    })();

    return () => {
      sub.data.subscription.unsubscribe();
    };
  }, [router, searchParams]);

  return (
    <div className="auth-bg">
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand-wrapper">
            <div className="auth-brand auth-brand--dark">
              <span className="auth-brand-nex">Activi</span>
              <span className="auth-brand-tee">Tee</span>
            </div>
            <div className="auth-tagline">Impersonation locale</div>
          </div>

          <div className="auth-form">
            {error ? <div className="auth-error">{error}</div> : <div className="auth-footnote">{message}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
