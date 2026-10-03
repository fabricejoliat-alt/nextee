"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export async function managerHeaders() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

/** A response belongs to its full URL; changing scope immediately hides old data. */
export function useManagerResource<T>(url: string | null, fallback: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string | null; data: T | null; error: string; pending: boolean }>({ key: null, data: null, error: "", pending: false });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setResult((previous) => ({ key: url, data: previous.key === url ? previous.data : null, error: "", pending: true }));
    void (async () => {
      try {
        const response = await fetch(url, { headers: await managerHeaders(), signal: controller.signal, cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? fallback);
        if (!controller.signal.aborted) setResult({ key: url, data: json as T, error: "", pending: false });
      } catch (cause) {
        if (!controller.signal.aborted) setResult((previous) => ({ key: url, data: previous.key === url ? previous.data : null, error: cause instanceof Error ? cause.message : fallback, pending: false }));
      }
    })();
    return () => controller.abort();
  }, [url, revision, fallback]);
  const current = url !== null && result.key === url;
  return { data: current ? result.data : null, error: current ? result.error : "",
    loading: Boolean(url && (!current || result.pending)), reload: () => setRevision((value) => value + 1) };
}
