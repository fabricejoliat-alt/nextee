import type { BiometricLockStatus } from "./nativeBiometricLock";

const offeredAccounts = new Set<string>();
const keyFor = (userID: string) => `activitee:biometric-invitation:v1:${userID}`;

/** Remember the invitation per signed-in account on this device, not per child. */
export function claimBiometricInvitation(userID: string, status: BiometricLockStatus | null, storage: Pick<Storage, "getItem" | "setItem">) {
  if (!userID || !status || status.locked || !status.available || status.biometryType === "none") return false;
  if (offeredAccounts.has(userID)) return false;
  try { if (storage.getItem(keyFor(userID))) return false; } catch { /* Use the in-memory fallback. */ }
  offeredAccounts.add(userID);
  try { storage.setItem(keyFor(userID), "offered"); } catch { /* Do not block app access when storage is unavailable. */ }
  return !status.enabled;
}
