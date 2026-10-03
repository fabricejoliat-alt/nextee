"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, Pencil, RefreshCw, Search, Send, UsersRound, X } from "lucide-react";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import ManagerClubSelect from "@/components/manager/ManagerClubSelect";
import { useManagerClubSelection } from "@/components/manager/useManagerClubSelection";
import { managerHeaders } from "@/components/manager/useManagerResource";
import { managerCount, managerFormat } from "@/lib/managerLocale";
import { managerJuniorDate } from "@/lib/managerJuniorPresentation";
import { familyAccessPreview, familySendSummary, juniorAccessTarget, parentAccessTarget, type FamilyAccessData, type FamilyAccessTarget, type FamilySendSummary } from "@/lib/managerFamilyAccess";
import type { AccessStatus } from "@/lib/familyAccess";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import campStyles from "../camps/Camps.module.css";
import familyStyles from "./AccessFamilies.module.css";

function stateClass(status: AccessStatus) {
  if (status === "error" || status === "not_ready") return familyStyles.statusDanger;
  if (status === "activated") return campStyles.badgeDone;
  if (status === "sent") return campStyles.badgeProgress;
  if (status === "expired") return campStyles.badgeArchived;
  return "";
}

export default function ManagerAccessPage() {
  const { t, locale } = useI18n();
  const { clubs, clubId, setClubId, loading: clubsLoading, error: clubsError } = useManagerClubSelection();
  const [dataset, setDataset] = useState<FamilyAccessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"parents" | "juniors">("parents");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | AccessStatus>("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [recipientByJunior, setRecipientByJunior] = useState<Record<string, string>>({});
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ result: FamilySendSummary; failedNames: string[] } | null>(null);
  const mutation = useRef(false);
  const attemptedRef = useRef(new Set<string>());
  const version = useRef(0);
  const scope = useRef(clubId); scope.current = clubId;
  const data = dataset?.club.id === clubId ? dataset : null;
  const format = (key: string, values: Record<string, string | number>) => managerFormat(t, `manager.access.${key}`, values);
  const juniorFormat = (key: string, name: string) => managerFormat(t, `manager.junior.edit.${key}`, { name });
  const statusLabel = (value: AccessStatus) => t(`manager.junior.edit.status.${value}`);
  const date = (value: string | null) => managerJuniorDate(t, locale, value);

  useEffect(() => {
    setDataset(null); setSelected({}); setRecipientByJunior({}); setPreviewKey(null); setSummary(null); setError("");
    setQuery(""); setStatus("all");
  }, [clubId]);

  useEffect(() => {
    const current = ++version.current;
    if (!clubId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/manager/clubs/${encodeURIComponent(clubId)}/access-invitations`, { headers: await managerHeaders(), cache: "no-store", signal: controller.signal });
        const json = await response.json();
        if (!response.ok || json.club?.id !== clubId || !Array.isArray(json.parents) || !Array.isArray(json.juniors) || !json.mail_config) throw new Error("invalid_response");
        if (controller.signal.aborted || current !== version.current) return;
        setDataset(json); setSelected({}); setPreviewKey(null);
        setRecipientByJunior(Object.fromEntries((json as FamilyAccessData).juniors.filter(row => row.recipient_user_id).map(row => [row.junior_user_id, row.recipient_user_id!])));
        attemptedRef.current.clear(); setAttempted([]);
      } catch {
        if (!controller.signal.aborted && current === version.current) { setDataset(null); setError("manager.access.loadError"); }
      } finally { if (!controller.signal.aborted && current === version.current) setLoading(false); }
    })();
    return () => { controller.abort(); version.current += 1; };
  }, [clubId, revision]);

  const targets = useMemo(() => new Map<string, FamilyAccessTarget>([
    ...(data?.parents ?? []).map(row => parentAccessTarget(row)),
    ...(data?.juniors ?? []).map(row => juniorAccessTarget(row, recipientByJunior[row.junior_user_id])),
  ].map(target => [target.selection.key, target])), [data, recipientByJunior]);
  const filtered = (value: string, state: AccessStatus) => (!query.trim() || value.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))) && (status === "all" || state === status);
  const parents = (data?.parents ?? []).filter(row => filtered(`${row.parent_name} ${row.parent_email ?? ""} ${row.parent_username ?? ""} ${row.linked_juniors.map(j => j.junior_name).join(" ")}`, row.parent_status));
  const juniors = (data?.juniors ?? []).filter(row => filtered(`${row.junior_name} ${row.junior_email ?? ""} ${row.junior_username ?? ""} ${row.parents.map(p => p.parent_name).join(" ")}`, targets.get(`junior:${row.junior_user_id}`)!.status));
  const states = [...targets.values()].map(row => row.status);
  const counts = { ready: states.filter(value => value === "ready").length, missing: states.filter(value => value === "not_ready").length, sent: states.filter(value => value === "sent" || value === "expired").length, activated: states.filter(value => value === "activated").length };
  const blocked = (key: string) => busy || loading || attempted.includes(key);
  const readySelected = [...targets.values()].filter(target => selected[target.selection.key] && target.canSend && target.status === "ready" && !attempted.includes(target.selection.key));
  const previewTarget = data && previewKey ? targets.get(previewKey) : undefined;
  const preview = data && previewTarget ? familyAccessPreview(data, previewTarget) : null;

  function toggle(target: FamilyAccessTarget, checked: boolean) {
    if (blocked(target.selection.key) || !target.canSend || target.status !== "ready") return;
    if (checked && Object.values(selected).filter(Boolean).length >= 100) { setError("manager.access.limit"); return; }
    setSelected(current => ({ ...current, [target.selection.key]: checked }));
  }

  async function send(keys: string[], bulk = false) {
    if (mutation.current || loading || !data || !clubId || scope.current !== clubId || !keys.length) return;
    const unique = [...new Set(keys)];
    const items = unique.map(key => targets.get(key));
    if (items.length > 100) { setError("manager.access.limit"); return; }
    if (items.some(target => !target?.canSend || (bulk && target.status !== "ready") || attemptedRef.current.has(`${clubId}|${target.selection.key}`))) { setError("manager.access.selectionInvalid"); return; }
    if (items.length > 1 && !window.confirm(format("confirmBulk", { count: items.length }))) return;
    mutation.current = true;
    const current = version.current;
    const checked = items as FamilyAccessTarget[];
    checked.forEach(target => attemptedRef.current.add(`${clubId}|${target.selection.key}`));
    setAttempted(previous => [...new Set([...previous, ...unique])]);
    setBusy(true); setError(""); setSummary(null);
    try {
      const payloads = checked.map(target => target.selection);
      const response = await fetch(`/api/manager/clubs/${encodeURIComponent(clubId)}/access-invitations`, {
        method: "POST", headers: { "Content-Type": "application/json", ...await managerHeaders() },
        body: JSON.stringify(payloads.length === 1 ? payloads[0] : { items: payloads }),
      });
      const json = await response.json();
      const result = familySendSummary(json.summary, checked.length);
      if ((!response.ok && response.status !== 207) || !result) throw new Error("unconfirmed_delivery");
      if (current !== version.current || scope.current !== clubId) return;
      setSummary({ result, failedNames: result.errors.map(row => checked[row.index].name) });
      setSelected({}); setPreviewKey(null); setRevision(value => value + 1);
    } catch { if (current === version.current && scope.current === clubId) setError("manager.access.sendError"); }
    finally { mutation.current = false; setBusy(false); }
  }

  function selectionCell(target: FamilyAccessTarget) {
    return <td data-label={t("manager.access.selection")}><input type="checkbox" aria-label={format("selectName", { name: target.name })} checked={Boolean(selected[target.selection.key])} disabled={blocked(target.selection.key) || !target.canSend || target.status !== "ready"} onChange={event => toggle(target, event.target.checked)} /></td>;
  }
  function badge(value: AccessStatus) { return <span className={`${campStyles.badge} ${stateClass(value)}`}>{statusLabel(value)}</span>; }
  function actions(target: FamilyAccessTarget) {
    const parent = target.selection.kind === "parent_access";
    return <td data-label={t("manager.content.actions")}><div className={campStyles.actions}>
      <button type="button" className={campStyles.iconButton} title={t("manager.administration.criteria.previewName")} aria-label={juniorFormat(parent ? "previewParent" : "previewJunior", target.name)} disabled={busy} onClick={() => setPreviewKey(target.selection.key)}><Eye size={15} /></button>
      {!parent && target.status === "not_ready" ? <Link className={campStyles.iconButton} title={t("manager.access.complete")} aria-label={format("completeName", { name: target.name })} href={`/manager/user-management/players/${target.selection.junior_user_id}?club=${encodeURIComponent(clubId)}`}><Pencil size={15} /></Link> :
        <button type="button" className={campStyles.iconButton} title={t(target.sendCount ? "manager.junior.edit.resend" : "manager.junior.edit.send")} aria-label={juniorFormat(`${target.sendCount ? "resend" : "send"}${parent ? "Parent" : "Junior"}`, target.name)} disabled={blocked(target.selection.key) || !target.canSend} onClick={() => void send([target.selection.key])}>{target.sendCount ? <RefreshCw size={15} /> : <Send size={15} />}</button>}
    </div></td>;
  }

  return <main className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.access.breadcrumb")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.access.title")}</h1><p className={styles.lead}>{t("manager.access.lead")}</p></div></div>
    <div className={familyStyles.scope}><ManagerClubSelect clubs={clubs} clubId={clubId} onChange={setClubId} disabled={busy || clubsLoading} /><button type="button" className={campStyles.secondary} disabled={!clubId || busy || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />{t("manager.access.refresh")}</button></div>
    {clubsError || error ? <div className={styles.errorAlert} role="alert">{clubsError ? t("manager.access.loadError") : t(error)}</div> : null}
    {summary ? <div className={summary.result.errors.length || summary.result.skipped ? styles.errorAlert : actionStyles.successAlert} role="status">{format("result", { sent: summary.result.sent, skipped: summary.result.skipped, errors: summary.result.errors.length })}{summary.failedNames.length ? <ul>{summary.failedNames.map((name, index) => <li key={index}>{format("failedName", { name })}</li>)}</ul> : null}</div> : null}
    {clubsLoading || loading ? <section className={styles.overview}><ListLoadingBlock label={t("manager.access.loading")} /></section> : !data ? <div className={campStyles.empty}>{t(clubId ? "common.noData" : "manager.noClub")}</div> : <>
      <section className={styles.overview}><div className={`${styles.statsGrid} ${familyStyles.stats}`}>{(["ready", "missing", "sent", "activated"] as const).map(key => <article className={styles.statCard} key={key}><span>{t(`manager.access.${key}`)}</span><b>{counts[key]}</b><small>{t(`manager.access.${key}Help`)}</small></article>)}</div></section>
      <section className={campStyles.panel}>
        <div className={campStyles.panelHeader}><div><h2>{t("manager.access.deliveries")}</h2><p>{t("manager.access.previewHelp")}</p></div><button className={campStyles.primary} type="button" disabled={!readySelected.length || busy} onClick={() => void send(readySelected.map(target => target.selection.key), true)}>{busy ? <RefreshCw size={15} className={styles.spin} /> : <Send size={15} />}{format("sendSelected", { count: readySelected.length })}</button></div>
        <div className={campStyles.toolbar}>
          <label className={campStyles.field}><span>{t("manager.access.search")}</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "#7a857b" }} /><input value={query} onChange={event => setQuery(event.target.value)} style={{ paddingLeft: 34 }} placeholder={t("manager.access.searchPlaceholder")} /></span></label>
          <label className={campStyles.field}><span>{t("manager.access.status")}</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">{t("manager.access.allStatuses")}</option>{(["not_ready", "ready", "sent", "expired", "activated", "error"] as const).map(value => <option value={value} key={value}>{statusLabel(value)}</option>)}</select></label>
        </div>
        <div className="user-mgmt-chip-list" role="group" aria-label={t("manager.access.accountType")}>
          <button type="button" className={`btn ${tab === "parents" ? "active" : ""}`} aria-pressed={tab === "parents"} onClick={() => setTab("parents")}><UsersRound size={15} />{t("manager.access.parents")} ({data.parents.length})</button>
          <button type="button" className={`btn ${tab === "juniors" ? "active" : ""}`} aria-pressed={tab === "juniors"} onClick={() => setTab("juniors")}>{t("manager.access.juniors")} ({data.juniors.length})</button>
        </div>
        <div className={campStyles.tableWrap}>
          {tab === "parents" ? <table className={`${campStyles.table} ${familyStyles.table}`}><thead><tr><th aria-label={t("manager.access.selection")} /><th>{t("manager.access.parent")}</th><th>{t("manager.access.linkedJuniors")}</th><th>{t("manager.content.state")}</th><th>{t("manager.junior.edit.lastSent")}</th><th>{t("manager.access.lastActivity")}</th><th>{t("manager.content.actions")}</th></tr></thead><tbody>
            {parents.length ? parents.map(parent => { const target = targets.get(`parent:${parent.parent_user_id}`)!; return <tr key={parent.parent_user_id}>
              {selectionCell(target)}
              <td data-label={t("manager.access.parent")}><div className={campStyles.titleCell}><b>{parent.parent_name}</b><span className={campStyles.muted}>{parent.parent_email ?? t("manager.access.emailMissing")} · {parent.parent_username ?? t("manager.access.usernameMissing")}</span></div></td>
              <td data-label={t("manager.access.linkedJuniors")}>{parent.linked_juniors.map(junior => junior.junior_name).join(", ") || "—"}</td>
              <td data-label={t("manager.content.state")}>{badge(target.status)}</td>
              <td data-label={t("manager.junior.edit.lastSent")}>{date(parent.parent_last_sent_at)}<span className={campStyles.muted} style={{ display: "block" }}>{managerCount(t, locale, "manager.junior.edit.sentCount", parent.parent_send_count)}</span></td>
              <td data-label={t("manager.access.lastActivity")}>{date(parent.parent_last_activity_at)}</td>{actions(target)}
            </tr>; }) : <tr><td colSpan={7}><div className={campStyles.empty}>{t("manager.access.noParents")}</div></td></tr>}
          </tbody></table> : <table className={`${campStyles.table} ${familyStyles.table}`}><thead><tr><th aria-label={t("manager.access.selection")} /><th>{t("manager.access.junior")}</th><th>{t("manager.access.parents")}</th><th>{t("manager.junior.edit.recipient")}</th><th>{t("manager.content.state")}</th><th>{t("manager.junior.edit.lastSent")}</th><th>{t("manager.content.actions")}</th></tr></thead><tbody>
            {juniors.length ? juniors.map(junior => { const target = targets.get(`junior:${junior.junior_user_id}`)!; const usableParents = junior.parents.filter(parent => parent.parent_email); return <tr key={junior.junior_user_id}>
              {selectionCell(target)}
              <td data-label={t("manager.access.junior")}><div className={campStyles.titleCell}><b>{junior.junior_name}</b><span className={campStyles.muted}>{junior.junior_username ?? t("manager.access.usernameMissing")}{junior.junior_email ? ` · ${junior.junior_email}` : ""}</span></div></td>
              <td data-label={t("manager.access.parents")}>{junior.parents.map(parent => parent.is_primary ? format("primary", { name: parent.parent_name }) : parent.parent_name).join(", ") || t("manager.access.noParent")}</td>
              <td data-label={t("manager.junior.edit.recipient")}>{junior.recipient_kind === "selection_required" ? <label className={`${campStyles.field} ${familyStyles.recipientField}`}><span>{t("manager.access.chooseParent")}</span><select aria-label={format("chooseParentFor", { name: junior.junior_name })} disabled={busy} value={recipientByJunior[junior.junior_user_id] ?? ""} onChange={event => {
                setRecipientByJunior(current => ({ ...current, [junior.junior_user_id]: event.target.value }));
                setSelected(current => ({ ...current, [`junior:${junior.junior_user_id}`]: false }));
              }}><option value="">{t("manager.access.choose")}</option>{usableParents.map(parent => <option key={parent.parent_user_id} value={parent.parent_user_id}>{parent.parent_name} · {parent.parent_email}</option>)}</select></label> : <span>{target.recipient ?? t("manager.access.emailMissing")}<span className={campStyles.muted} style={{ display: "block" }}>{junior.junior_email ? t("manager.access.direct") : target.recipientName ? format("viaParent", { name: target.recipientName }) : t("manager.access.recipientMissing")}</span></span>}</td>
              <td data-label={t("manager.content.state")}>{badge(target.status)}</td>
              <td data-label={t("manager.junior.edit.lastSent")}>{date(junior.junior_last_sent_at)}<span className={campStyles.muted} style={{ display: "block" }}>{managerCount(t, locale, "manager.junior.edit.sentCount", junior.junior_send_count)}</span></td>{actions(target)}
            </tr>; }) : <tr><td colSpan={7}><div className={campStyles.empty}>{t("manager.access.noJuniors")}</div></td></tr>}
          </tbody></table>}
        </div>
      </section>
    </>}
    {preview && previewTarget && !loading ? <AccessibleDialog className={familyStyles.modal} labelledBy="family-preview-title" onClose={() => { if (!busy) setPreviewKey(null); }}>
      <div className={familyStyles.modalHead}><div><h2 id="family-preview-title">{juniorFormat(previewTarget.selection.kind === "parent_access" ? "parentInvitation" : "juniorInvitation", previewTarget.name)}</h2><p>{t("manager.junior.edit.toPrefix")} {previewTarget.recipient || t("manager.access.recipientMissing")}</p></div><button type="button" className="btn" disabled={busy} aria-label={t("manager.access.closePreview")} onClick={() => setPreviewKey(null)}><X size={16} /></button></div>
      <div className={familyStyles.modalBody}><p className={familyStyles.previewHelp}>{t("manager.access.previewLinks")}</p><div className={familyStyles.previewSubject}>{preview.subject}</div><div className={familyStyles.previewBody}>{preview.body}</div>{error ? <p role="alert">{t(error)}</p> : null}</div>
      <div className={familyStyles.modalActions}><button type="button" className="btn" disabled={busy} onClick={() => setPreviewKey(null)}>{t("common.close")}</button><button type="button" className={`${actionStyles.primaryButton} ${familyStyles.modalPrimaryButton}`} disabled={!previewTarget.canSend || blocked(previewTarget.selection.key)} onClick={() => void send([previewTarget.selection.key])}><CheckCircle2 size={15} />{t("manager.junior.edit.confirmSend")}</button></div>
    </AccessibleDialog> : null}
  </main>;
}
