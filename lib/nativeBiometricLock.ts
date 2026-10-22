"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { AppLocale } from "@/lib/i18n/messages";

export type BiometricLockStatus = {
  enabled: boolean;
  available: boolean;
  locked: boolean;
  biometryType: "faceID" | "touchID" | "biometric" | "none";
};

interface BiometricLockPlugin {
  getStatus(): Promise<BiometricLockStatus>;
  configure(options: { userID: string; enabled: boolean; locale: AppLocale }): Promise<BiometricLockStatus>;
  syncSession(options: { userID: string | null; locale: AppLocale }): Promise<void>;
}

const plugin = registerPlugin<BiometricLockPlugin>("BiometricLock");
export const BIOMETRIC_LOCK_CHANGE_EVENT = "activitee:biometric-lock-changed";

export function supportsNativeBiometricLock() {
  return Capacitor.isNativePlatform() && ["ios", "android"].includes(Capacitor.getPlatform()) && Capacitor.isPluginAvailable("BiometricLock");
}

export async function getBiometricLockStatus(): Promise<BiometricLockStatus | null> {
  return supportsNativeBiometricLock() ? plugin.getStatus() : null;
}

export async function configureBiometricLock(userID: string, enabled: boolean, locale: AppLocale) {
  if (!supportsNativeBiometricLock()) throw new Error("UNAVAILABLE");
  const status = await plugin.configure({ userID, enabled, locale });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BIOMETRIC_LOCK_CHANGE_EVENT));
  return status;
}

export async function syncBiometricSession(userID: string | null, locale?: AppLocale) {
  if (!supportsNativeBiometricLock()) return;
  let language = locale;
  if (!language) {
    try {
      const saved = window.localStorage.getItem("app_locale");
      if (saved === "fr" || saved === "en" || saved === "de" || saved === "it") language = saved;
    } catch { /* The native default remains French. */ }
  }
  await plugin.syncSession({ userID, locale: language ?? "fr" });
}

export function biometricErrorKey(error: unknown): "cancelled" | "unavailable" | "error" {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "CANCELLED") return "cancelled";
  if (code === "UNAVAILABLE") return "unavailable";
  return "error";
}
