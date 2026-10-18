import type { SupabaseClient } from "@supabase/supabase-js";

export const MARKETPLACE_BUCKET = "marketplace";
export const MARKETPLACE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MARKETPLACE_SIGNED_URL_TTL_SECONDS = 15 * 60;

export function isMarketplaceImagePath(path: string, ownerId: string, itemId: string) {
  const prefix = `${ownerId}/${itemId}/`;
  const leaf = path.slice(prefix.length);
  return Boolean(ownerId && itemId && path.startsWith(prefix) && leaf && !leaf.includes("/") && leaf !== "." && leaf !== "..");
}

/** Sign only objects belonging to listings the caller has already been allowed to read. */
export async function signMarketplaceImagePaths(
  db: SupabaseClient,
  rows: ReadonlyArray<{ item_id: string | null; path: string | null }>,
  owners: Map<string, string>,
) {
  const paths = [...new Set(rows.flatMap(row => {
    const itemId = String(row.item_id ?? "");
    const path = String(row.path ?? "");
    return isMarketplaceImagePath(path, owners.get(itemId) ?? "", itemId) ? [path] : [];
  }))];
  const urls = new Map<string, string>();
  if (!paths.length) return urls;
  const result = await db.storage.from(MARKETPLACE_BUCKET).createSignedUrls(paths, MARKETPLACE_SIGNED_URL_TTL_SECONDS);
  if (result.error) throw new Error(result.error.message);
  for (const row of result.data ?? []) if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
  return urls;
}
