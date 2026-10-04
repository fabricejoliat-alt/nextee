"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Allowed = "admin" | "player" | "coach" | "manager" | "parent";
type GuardStatus = "checking" | "allowed" | "redirecting" | "error";
type GuardApiPayload = {
  code?: unknown;
  error?: unknown;
  isSuperAdmin?: unknown;
  membership?: { role?: unknown } | null;
  parentHasChildren?: unknown;
  viewerRole?: unknown;
  player?: { pending?: unknown } | null;
};

async function readJsonResponse(response: Response) {
  const body = await response.text();
  if (!body) throw new Error("Réponse vide du serveur.");
  try {
    return JSON.parse(body) as GuardApiPayload;
  } catch {
    throw new Error("Réponse invalide du serveur.");
  }
}

export default function RoleGuard({
  allow,
  children,
  inline = false,
  quiet = false,
}: {
  allow: Allowed | Allowed[];
  children: React.ReactNode;
  inline?: boolean;
  quiet?: boolean;
}) {
  const router = useRouter();
  const allowedKey = useMemo(
    () => (Array.isArray(allow) ? [...allow].sort().join(",") : allow),
    [allow],
  );
  const [status, setStatus] = useState<GuardStatus>("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const statusRef = useRef<GuardStatus>("checking");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const allowed = allowedKey.split(",") as Allowed[];

    const redirect = (path: string) => {
      if (cancelled) return;
      setStatus("redirecting");
      router.replace(path);
    };

    const goLogin = () => {
      if (cancelled) return;
      setStatus("redirecting");
      window.location.assign("/");
    };

    async function checkAccess() {
      setStatus("checking");
      setErrorMessage("");

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        let token = data.session?.access_token;

        // Avoid false logout on short-lived transient states.
        if (!token) {
          const refreshed = await supabase.auth.refreshSession();
          if (refreshed.error) throw refreshed.error;
          token = refreshed.data.session?.access_token ?? null;
        }

        if (!token) {
          goLogin();
          return;
        }

        const response = await fetch("/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await readJsonResponse(response);

        if (response.status === 401) {
          goLogin();
          return;
        }
        if (!response.ok) {
          throw new Error(String(json.error ?? `Vérification indisponible (${response.status}).`));
        }

        if (json.isSuperAdmin) {
          if (allowed.includes("admin")) {
            if (!cancelled) setStatus("allowed");
            return;
          }
          redirect("/admin");
          return;
        }

        const membership = json.membership;
        if (!membership) {
          redirect("/no-access");
          return;
        }

        const role = membership.role as "player" | "coach" | "manager" | "parent";
        const currentPath = window.location.pathname;
        const consentPage = "/player/consent-required";

        if (role === "parent" && json.parentHasChildren === false) {
          redirect("/no-access");
          return;
        }

        if (role === "player" || role === "parent") {
          const consentResponse = await fetch("/api/player/consent", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const consentJson = await readJsonResponse(consentResponse);

          if (consentResponse.status === 401) {
            goLogin();
            return;
          }
          if (!consentResponse.ok) {
            if (consentResponse.status === 403 && consentJson.code === "PLAYER_CONSENT_REQUIRED") {
              redirect(consentPage);
              return;
            }
            throw new Error(String(consentJson.error ?? `Consentement indisponible (${consentResponse.status}).`));
          }

          const consentPending =
            role === "player" && consentJson.viewerRole === "player" && Boolean(consentJson.player?.pending);

          if (consentPending && currentPath !== consentPage) {
            redirect(consentPage);
            return;
          }

          if (!consentPending && currentPath === consentPage) {
            redirect("/player");
            return;
          }
        }

        if (allowed.includes(role)) {
          if (!cancelled) setStatus("allowed");
          return;
        }

        if (role === "manager") redirect("/manager");
        else if (role === "parent") redirect("/player");
        else if (role === "coach") redirect("/coach");
        else redirect("/player");
      } catch (error) {
        if (cancelled) return;
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setErrorMessage(
          offline
            ? "Vous êtes hors ligne. Reconnectez-vous puis réessayez."
            : error instanceof Error
              ? error.message
              : "Impossible de vérifier votre accès pour le moment.",
        );
        setStatus("error");
      }
    }

    void checkAccess();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") goLogin();

      // Token refreshes can briefly emit intermediate states.
      // Do not hard-redirect on null session unless it's an explicit sign-out.
      if (!session && event !== "INITIAL_SESSION") return;
    });

    const retryWhenOnline = () => {
      if (statusRef.current === "error") setRetryNonce((value) => value + 1);
    };
    window.addEventListener("online", retryWhenOnline);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener("online", retryWhenOnline);
    };
  }, [allowedKey, retryNonce, router]);

  if (status === "error") {
    return (
      <main className={inline ? "role-guard-error role-guard-error--inline" : "role-guard-error"} role="alert">
        <div className="card role-guard-error-card">
          <div className="role-guard-error-title">Accès temporairement indisponible</div>
          <p>{errorMessage || "Impossible de vérifier votre accès pour le moment."}</p>
          <button type="button" className="btn btn-primary" onClick={() => setRetryNonce((value) => value + 1)}>
            Réessayer
          </button>
        </div>
      </main>
    );
  }

  if (status !== "allowed") {
    if (quiet) {
      return (
        <main className="role-guard-startup" aria-busy="true" aria-label="Chargement d’ActiviTee">
          <span className="role-guard-startup-brand" aria-hidden="true"><span>Activi</span><strong>Tee</strong></span>
        </main>
      );
    }
    if (status === "redirecting") return null;
    if (inline) {
      return <div className="role-guard-inline" aria-busy="true" aria-label="Chargement"><span /><span /><span /></div>;
    }
    return (
      <main className="role-guard-page-loading" style={{ padding: 24 }} aria-busy="true" aria-live="polite">
        <div className="card" style={{ maxWidth: 520, margin: "40px auto", display: "grid", gap: 12 }}>
          <div className="role-guard-loading-line role-guard-loading-line--short" />
          <div className="role-guard-loading-line" />
          <div className="role-guard-loading-line role-guard-loading-line--medium" />
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
