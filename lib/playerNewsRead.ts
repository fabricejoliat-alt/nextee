import { inFlightRead } from "./inFlightRead.ts";

/** The news API resolves and authorizes the Player/Parent itself. Share only
 * concurrent reads for this exact credential and child; never cache permission results. */
export function loadPlayerNews<T>(args: {
  token: string;
  locale: string;
  explicitChildId?: string;
  storedChildId?: string;
  forgetStoredChild?: () => void;
  fetcher?: typeof fetch;
}): Promise<T> {
  if (!args.token) return Promise.reject(new Error("Invalid session"));
  const explicit = args.explicitChildId?.trim() ?? "";
  const stored = args.storedChildId?.trim() ?? "";
  return inFlightRead(JSON.stringify(["player-news", args.token, args.locale, explicit, stored]), async () => {
    async function request(child: string) {
      const params = new URLSearchParams({ include_archived: "1" });
      params.set("locale", args.locale);
      if (child) params.set("child_id", child);
      const query = `?${params}`;
      const response = await (args.fetcher ?? fetch)(`/api/player/news${query}`, {
        headers: { Authorization: `Bearer ${args.token}` }, cache: "no-store",
      });
      const payload = await response.json();
      return { response, payload };
    }
    let result = await request(explicit || stored);
    // A revoked stored parent selection must not lock the user out; an explicit
    // forbidden child stays a visible error and is never silently substituted.
    if (result.response.status === 403 && !explicit && stored) {
      args.forgetStoredChild?.();
      result = await request("");
    }
    if (!result.response.ok) throw new Error(result.payload.error ?? "Unable to load news");
    return result.payload as T;
  });
}
