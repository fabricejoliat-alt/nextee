/** Coach context narrows reads; Player always combines all authorized organizations. */
export function currentOrganizationFilter() {
  if (typeof window === "undefined" || !/^\/coach(\/|$)/.test(window.location.pathname)) return null;
  const value = new URLSearchParams(window.location.search).get("organization_id");
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
export const organizationFetch: typeof fetch = async (input, init) => {
  const selected = currentOrganizationFilter();
  if (!selected) return globalThis.fetch(input, init);
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (url.pathname.startsWith("/rest/v1/")) headers.set("x-activitee-organization", selected);
  else if (url.origin === window.location.origin && /^\/api\/(player|coach|parent|news|messages|profile)(\/|$)/.test(url.pathname)) {
    if (!url.searchParams.has("organization_id")) url.searchParams.set("organization_id", selected);
  } else return globalThis.fetch(input, init);
  return globalThis.fetch(input instanceof Request ? new Request(url,input) : url, {...init,headers});
};
