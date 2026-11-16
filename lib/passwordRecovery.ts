import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { combineChunks, memoryLocalStorageAdapter, parseCookieHeader, stringFromBase64URL } from "@supabase/ssr";

type PreparedPasswordRecovery = { valid: boolean; client: SupabaseClient | null };
let preparation: { link: string; result: Promise<PreparedPasswordRecovery> } | null = null;

export function preparePasswordRecoveryOnce(link: string, prepare: () => Promise<PreparedPasswordRecovery>) {
  const url = new URL(link);
  const hash = new URLSearchParams(url.hash.slice(1));
  const hasCredentials = ["invite_token", "token_hash", "code"].some(key => url.searchParams.has(key))
    || ["access_token", "refresh_token", "token_hash"].some(key => hash.has(key));
  if (!hasCredentials) return prepare();
  // Signing out clears retained pages via SessionPageBoundary and remounts the
  // reset form. Keep both the promise and its private client above that lifetime
  // so a one-time link is consumed once, including in production React builds.
  if (preparation?.link !== link) preparation = { link, result: Promise.resolve().then(prepare) };
  return preparation.result;
}

export function releasePasswordRecoveryPreparation(link: string, currentPath: string) {
  // A session-boundary remount keeps the same route. Only real navigation
  // discards the client; this must not depend on React's effect scheduling.
  if (currentPath !== "/reset-password" && preparation?.link === link) preparation = null;
}

// Read recovery credentials before the shared SSR client can consume the URL.
// In particular, implicit and PKCE redirects must never sign the whole app in.
export function capturePasswordRecoveryUrl(browser: Pick<Window, "location" | "history"> | undefined) {
  if (!browser || browser.location.pathname !== "/reset-password") return null;
  const url = new URL(browser.location.href);
  const original = url.href;
  const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.has("code") || hash.has("access_token") || hash.has("refresh_token")) {
    url.searchParams.delete("code");
    url.hash = "";
    browser.history.replaceState(browser.history.state, "", url.href);
  }
  return original;
}

export async function createPasswordRecoveryClient(url: string, key: string, cookieHeader = "", fetcher?: typeof fetch) {
  const storageKey = `activitee-password-recovery-${crypto.randomUUID()}`;
  const memory: Record<string, string> = {};
  // Preserve compatibility with PKCE links, copying only the verifier, never
  // the application's session. All recovery writes remain in this page's memory.
  const verifierKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token-code-verifier`;
  const cookies = parseCookieHeader(cookieHeader);
  const verifier = await combineChunks(verifierKey, name => cookies.find(cookie => cookie.name === name)?.value);
  if (verifier) memory[`${storageKey}-code-verifier`] = verifier.startsWith("base64-")
    ? stringFromBase64URL(verifier.slice(7)) : verifier;
  return createClient(url, key, {
    global: fetcher ? { fetch: fetcher } : undefined,
    auth: {
      storageKey,
      storage: memoryLocalStorageAdapter(memory),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
}
