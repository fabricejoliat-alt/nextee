/** Bounded, read-only requests. Retry only transport failures and server failures. */
export async function trainingDetailRead<T>(url: string, token: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    // Use a controller rather than AbortSignal.any for older iOS web apps.
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 20000);
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        signal: controller.signal });
      if (response.status >= 500 && attempt === 0) continue;
      if (!response.ok) throw Object.assign(new Error("Unable to load training"), { status: response.status });
      return await response.json() as T;
    } catch (error) {
      if (signal.aborted) throw error;
      if (attempt === 0 && !(error as { status?: number }).status) continue;
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    }
  }
  throw new Error("Unable to load training");
}
