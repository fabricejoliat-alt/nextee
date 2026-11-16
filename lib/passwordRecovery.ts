import { createClient } from "@supabase/supabase-js";
import { combineChunks, memoryLocalStorageAdapter, parseCookieHeader, stringFromBase64URL } from "@supabase/ssr";

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
