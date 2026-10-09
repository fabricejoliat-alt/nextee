/** Encode Supabase's inline SVG without sending the MFA secret to an image service. */
export function normalizeMfaQrDataUrl(dataUrl: string): string {
  const prefix = dataUrl.match(/^data:image\/svg\+xml(?:;[^,]*)?,/i)?.[0];
  if (!prefix || /;base64,/i.test(prefix)) return dataUrl.trimEnd();

  const svg = dataUrl.slice(prefix.length);
  // Preserve already encoded data URLs; the installed SDK returns literal SVG.
  if (!svg.trimStart().startsWith("<")) return dataUrl.trimEnd();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
