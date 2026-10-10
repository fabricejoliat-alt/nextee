"use client";

import { useRef, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import passwordStyles from "./CoachPasswordDialog.module.css";

type Role = "player" | "manager";

export default function MemberPasswordAction({ clubId, memberId, role, identifier, onSuccess }: {
  clubId: string; memberId: string; role: Role; identifier: string; onSuccess: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const label = t(`manager.administration.accountPassword.${role}.title`);
  const dismiss = () => {
    if (busyRef.current) return;
    setOpen(false); setPassword(""); setConfirmation(""); setError("");
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    if (password.length < 12 || password.length > 128) { setError("length"); return; }
    if (password !== confirmation) { setError("mismatch"); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/manager/clubs/${clubId}/accounts/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
        body: JSON.stringify({ member_id: memberId, role, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error === "invalid_password" ? "length" : result.error === "weak_password" ? "weak" : result.error === "same_password" ? "same" : response.status === 403 ? "protected" : "failed");
        return;
      }
      setOpen(false); setPassword(""); setConfirmation(""); onSuccess();
    } catch {
      setError("failed");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  return <>
    <div className={passwordStyles.accessAction}><button type="button" className={actionStyles.secondaryButton} onClick={() => { setError(""); setOpen(true); }}><KeyRound size={16} />{label}</button></div>
    {open ? <AccessibleDialog onClose={dismiss} className={passwordStyles.dialog} label={label}>
      <form className={passwordStyles.form} onSubmit={submit}>
        <h2>{label}</h2>
        <p>{t(`manager.administration.accountPassword.${role}.help`)}</p>
        <label className={actionStyles.field}><span>{t("manager.administration.coaches.loginIdentifier")}</span><input autoComplete="username" readOnly value={identifier || "—"} /></label>
        <label className={actionStyles.field}><span>{t("manager.administration.coaches.newPassword")}</span><input type="password" name="new-password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className={actionStyles.field}><span>{t("manager.administration.coaches.confirmPassword")}</span><input type="password" name="confirm-password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {error ? <p role="alert" className={actionStyles.errorAlert}>{t(`manager.administration.accountPassword.${error}`)}</p> : null}
        <div className={passwordStyles.actions}><button type="button" className={actionStyles.secondaryButton} disabled={busy} onClick={dismiss}>{t("common.cancel")}</button><button type="submit" className={actionStyles.primaryButton} disabled={busy}>{busy ? t("manager.saving") : t("manager.administration.coaches.changePassword")}</button></div>
      </form>
    </AccessibleDialog> : null}
  </>;
}
