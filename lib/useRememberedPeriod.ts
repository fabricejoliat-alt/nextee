"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SavedPeriod<T extends string> = { period: T; from: string; to: string };
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Remembers each signed-in user's choice in this browser, separately for each view. */
export function useRememberedPeriod<T extends string>(scope: string, initial: T, allowed: readonly T[], explicit?: T) {
  const [period, setPeriod] = useState<T>(initial);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const allowedKey = allowed.join("|");

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const userId = data.session?.user.id ?? null;
      setOwner(userId);
      setPeriod(initial);
      setFrom("");
      setTo("");
      if (userId) {
        try {
          const saved = JSON.parse(localStorage.getItem(`activitee:period:v1:${userId}:${scope}`) ?? "null") as SavedPeriod<T> | null;
          if (saved && allowedKey.split("|").includes(saved.period)) {
            if (!explicit) setPeriod(saved.period);
            if (validDate(saved.from)) setFrom(saved.from);
            if (validDate(saved.to)) setTo(saved.to);
          }
        } catch { /* Ignore damaged browser storage. */ }
      }
      if (explicit) setPeriod(explicit);
      setLoadedScope(scope);
    });
    return () => { active = false; };
  }, [scope, initial, explicit, allowedKey]);

  useEffect(() => {
    if (loadedScope !== scope || !owner) return;
    try { localStorage.setItem(`activitee:period:v1:${owner}:${scope}`, JSON.stringify({ period, from, to })); }
    catch { /* The page remains usable when browser storage is unavailable. */ }
  }, [loadedScope, owner, scope, period, from, to]);

  return { period, setPeriod, from, setFrom, to, setTo };
}
