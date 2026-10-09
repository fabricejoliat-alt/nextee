/** Ask for a fresh MFA code without automatically replaying a mutation. */
export const adminFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, cache: "no-store" });
  if (response.status === 403 && typeof window !== "undefined") {
    const body = await response.clone().json().catch(() => null);
    if (["ADMIN_MFA_REQUIRED", "ADMIN_REAUTH_REQUIRED"].includes(body?.code)) {
      window.dispatchEvent(new CustomEvent("admin:reauth-required", { detail: { code: body.code } }));
    }
  }
  return response;
};
