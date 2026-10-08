import { createInFlightRead } from "./inFlightRead.ts";

const readOnlyRpcs = new Set(["organization_access_summary_checked", "legal_version_matches_document"]);

/** Coalesce identical concurrent reads, including their complete credential set.
 * No response is cached after headers arrive; writes and cancellable calls stay independent.
 */
export function createReadOnceFetch(transport: typeof fetch): typeof fetch {
  const once = createInFlightRead();
  return async (input, init) => {
    if (init?.signal || input instanceof Request) return transport(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const url = String(input);
    const rpc = new URL(url, "http://read.local").pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    if (method !== "GET" && !(method === "POST" && rpc && readOnlyRpcs.has(rpc) && typeof init?.body === "string")) {
      return transport(input, init);
    }
    const headers = [...new Headers(init?.headers)].sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([method, url, headers, init?.body ?? null, init?.cache, init?.credentials, init?.redirect]);
    const response = await once(key, () => transport(input, init));
    return response.clone();
  };
}

export const readOnceFetch = createReadOnceFetch((input, init) => globalThis.fetch(input, init));
