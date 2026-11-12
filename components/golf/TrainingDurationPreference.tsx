"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { formatTrainingDuration, TRAINING_DURATION_METADATA_KEY, trainingDurationUnit, type TrainingDurationUnit } from "@/lib/trainingDurationDisplay";

const Context = createContext<{
  unit: TrainingDurationUnit; ready: boolean; saving: boolean;
  setUnit: (unit: TrainingDurationUnit) => Promise<void>;
} | null>(null);

export function TrainingDurationPreferenceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const owner = useRef<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const accept = (next: User | null) => {
      owner.current = next?.id ?? null;
      setUser(next);
      setReady(true);
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION") revision += 1;
      if (active) accept(session?.user ?? null);
    });
    const initialRevision = revision;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (active && revision === initialRevision) {
        if (!error) accept(data.user);
        else setReady(false);
      }
    }).catch(() => { /* Keep the preference disabled until an authenticated session is available. */ });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const setUnit = useCallback(async (unit: TrainingDurationUnit) => {
    if (!user || pending.current) return;
    const id = user.id;
    pending.current = true;
    setSaving(true);
    try {
      const current = await supabase.auth.getUser();
      if (current.error || current.data.user?.id !== id || owner.current !== id) throw new Error("Session changed");
      const result = await supabase.auth.updateUser({ data: { [TRAINING_DURATION_METADATA_KEY]: unit } });
      if (result.error || !result.data.user) throw result.error ?? new Error("Preference not saved");
      if (owner.current === id) setUser(result.data.user);
    } finally { pending.current = false; setSaving(false); }
  }, [user]);

  return <Context.Provider value={{ unit: trainingDurationUnit(user?.user_metadata), ready: ready && Boolean(user), saving, setUnit }}>{children}</Context.Provider>;
}

export function useTrainingDurationDisplay() {
  const preference = useContext(Context);
  if (!preference) throw new Error("TrainingDurationPreferenceProvider required");
  const formatDuration = useCallback((minutes: number | null | undefined, minutesLabel = "min") => formatTrainingDuration(minutes, preference.unit, minutesLabel), [preference.unit]);
  return { ...preference, formatDuration };
}
