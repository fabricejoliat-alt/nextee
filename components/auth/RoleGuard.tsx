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

function needsLegalCheck(path: string) {
  return (path === "/player" || path.startsWith("/player/") || path === "/coach" || path.startsWith("/coach/")
    || path === "/manager" || path.startsWith("/manager/"))
    && path !== "/player/consent-required" && path !== "/player/help";
}

async function readLegalStatus(token: string) {
  const response = await fetch("/api/legal/status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error("Vérification des documents indisponible. Réessayez en ligne.");
  const result = await response.json();
  if (typeof result?.enforcement_enabled !== "boolean" || !Array.isArray(result.missing))
    throw new Error("Réponse de validation invalide.");
  return result as { enforcement_enabled: boolean; missing: unknown[] };
}

export default function RoleGuard({
  allow,
  children,
  inline = false,
}: {
  allow: Allowed | Allowed[];
  children: React.ReactNode;
  inline?: boolean;
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
    const recheckLegalStatus = async () => {
      if (statusRef.current !== "allowed" || document.visibilityState !== "visible"
        || !needsLegalCheck(window.location.pathname)) return;
      statusRef.current = "checking"; setStatus("checking");
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("Session indisponible. Réessayez en ligne.");
        const result = await readLegalStatus(token);
        if (cancelled) return;
        if (result.enforcement_enabled && result.missing.length) {
          statusRef.current = "redirecting"; setStatus("redirecting"); router.replace("/legal/my");
        } else { statusRef.current = "allowed"; setStatus("allowed"); }
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Vérification indisponible.");
        statusRef.current = "error"; setStatus("error");
      }
    };
    window.addEventListener("focus", recheckLegalStatus);
    document.addEventListener("visibilitychange", recheckLegalStatus);
    return () => { cancelled = true; window.removeEventListener("focus", recheckLegalStatus);
      document.removeEventListener("visibilitychange", recheckLegalStatus); };
  }, [router]);

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
            if (needsLegalCheck(window.location.pathname)) {
              const legal = await readLegalStatus(token);
              if (legal.enforcement_enabled && legal.missing.length) { redirect("/legal/my"); return; }
            }
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
          if (needsLegalCheck(currentPath)) {
            const legal = await readLegalStatus(token);
            if (legal.enforcement_enabled && legal.missing.length) { redirect("/legal/my"); return; }
          }
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
    return (
      <div className="role-guard-photo-loading" role="status" aria-busy="true" aria-label="Chargement" />
    );
  }

  return <>{children}</>;
}
