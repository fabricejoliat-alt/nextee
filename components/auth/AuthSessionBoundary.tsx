"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { invalidateClientPageCacheByPrefix } from "@/lib/clientPageCache";

const LAST_USER_KEY = "app:last_user_id";
const PLAYER_DRAWER_CACHE_KEY = "player:drawer:footer:v1";
const PARENT_SELECTED_CHILD_KEY = "parent:selected_child_id";

function safeGet(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function clearPerUserCaches() {
  safeRemove(PLAYER_DRAWER_CACHE_KEY);
  safeRemove(PARENT_SELECTED_CHILD_KEY);
  invalidateClientPageCacheByPrefix("page-cache:");
}

export default function AuthSessionBoundary() {
  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const currentUserId = data.user?.id ?? "";
      const lastUserId = safeGet(LAST_USER_KEY) ?? "";

      if (currentUserId && lastUserId && currentUserId !== lastUserId) {
        clearPerUserCaches();
      }

      if (currentUserId) safeSet(LAST_USER_KEY, currentUserId);
      else safeRemove(LAST_USER_KEY);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUserId = session?.user?.id ?? "";
      const lastUserId = safeGet(LAST_USER_KEY) ?? "";

      if (event === "SIGNED_OUT") {
        clearPerUserCaches();
        safeRemove(LAST_USER_KEY);
        return;
      }

      if (currentUserId && lastUserId && currentUserId !== lastUserId) {
        clearPerUserCaches();
      }

      if (currentUserId) safeSet(LAST_USER_KEY, currentUserId);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}

