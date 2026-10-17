"use client";

import { supabase } from "@/lib/supabaseClient";
import { supportsNativeBiometricLock, syncBiometricSession } from "@/lib/nativeBiometricLock";
import type { AppLocale } from "@/lib/i18n/messages";

export async function syncBiometricLocale(locale: AppLocale) {
  if (!supportsNativeBiometricLock()) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id) await syncBiometricSession(data.session.user.id, locale);
  } catch { /* Keep the last native language if the bridge is temporarily unavailable. */ }
}
