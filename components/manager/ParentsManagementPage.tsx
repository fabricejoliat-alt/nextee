"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useManagerClubSelection } from "./useManagerClubSelection";
import { managerHeaders, useManagerResource } from "./useManagerResource";
import { managerParentName, type ManagerParent } from "@/lib/managerParents";
import { managerFormat, managerLocaleTag } from "@/lib/managerLocale";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actions from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import directoryStyles from "./UserDirectory.module.css";
import page from "./ParentsManagementPage.module.css";

type Dialog = { clubId: string; mode: "create" | "edit" | "remove"; parent?: ManagerParent };
const emptyForm = { first_name: "", last_name: "", email: "", phone: "" };

export default function ParentsManagementPage() {
  const { t, locale } = useI18n();
  const scope = useManagerClubSelection(), { clubId } = scope;
  const resource = useManagerResource<{ parents: ManagerParent[] }>(clubId ? `/api/manager/clubs/${clubId}/parents` : null, "parents_load_failed");
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState<Dialog | null>(null), [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false), [dialogError, setDialogError] = useState("");
  const [flash, setFlash] = useState<{ clubId: string; key: string } | null>(null);
  const busyRef = useRef(false), currentClub = useRef(clubId); currentClub.current = clubId;
  const loading = scope.loading || resource.loading;
  const ready = Boolean(clubId && !loading && !scope.error && !resource.error && resource.data);
  const parents = useMemo(() => ready ? resource.data?.parents ?? [] : [], [ready, resource.data]);
  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(locale);
    return parents.filter(parent => (filter === "all" || (filter === "active" ? parent.is_active : filter === "inactive" ? !parent.is_active : parent.juniors.length === 0))
      && `${managerParentName(parent)} ${parent.email ?? ""} ${parent.juniors.map(junior => junior.name).join(" ")}`.toLocaleLowerCase(locale).includes(search))
      .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, managerLocaleTag(locale)));
  }, [parents, query, filter, locale]);
  const activeDialog = dialog?.clubId === clubId ? dialog : null;
  const name = (parent: ManagerParent) => managerParentName(parent) || t("manager.content.parent");
  const local = (key: string) => t(`manager.administration.parents.${key}`);
  function open(mode: Dialog["mode"], parent?: ManagerParent) {
    setDialog({ clubId, mode, parent }); setDialogError(""); setFlash(null);
    setForm(parent ? { first_name: parent.first_name, last_name: parent.last_name, email: parent.email ?? "", phone: parent.phone } : emptyForm);
  }
  function close() { if (!busyRef.current) { setDialog(null); setDialogError(""); } }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!activeDialog || busyRef.current || activeDialog.clubId !== currentClub.current) return;
    const selected = activeDialog, parent = selected.parent;
    if (selected.mode !== "remove") {
      if (!form.first_name.trim()) { setDialogError("manager.administration.firstNameRequired"); return; }
      if (!form.last_name.trim()) { setDialogError("manager.administration.lastNameRequired"); return; }
      if (selected.mode === "create" && !/^\S+@\S+\.\S+$/.test(form.email.trim())) { setDialogError("manager.administration.validEmail"); return; }
    }
    busyRef.current = true; setBusy(true); setDialogError("");
    try {
      const prefix = `/api/manager/clubs/${selected.clubId}`;
      const removing = selected.mode === "remove";
      const url = removing ? `${prefix}/parents` : selected.mode === "edit" ? `${prefix}/members` : `/api/admin/clubs/${selected.clubId}/create-member`;
      const body = removing ? { member_id: parent!.id, expected_player_ids: parent!.juniors.map(j => j.player_id), expected_shared_player_ids: parent!.juniors.filter(j => j.shared).map(j => j.player_id) }
        : { first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim(), role: "parent",
          ...(selected.mode === "edit" ? { memberId: parent!.id } : { email: form.email.trim().toLowerCase() }) };
      const response = await fetch(url, { method: removing ? "DELETE" : selected.mode === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...(await managerHeaders()) }, body: JSON.stringify(body) });
      const json = await response.json();
      if (currentClub.current !== selected.clubId) return;
      if (!response.ok) {
        const key = json.error === "parent_links_changed" ? "changed" : json.error === "parent_removal_migration_required" ? "migration"
          : response.status === 403 ? "protected" : removing ? "removeError" : "saveError";
        setDialogError(`manager.administration.parents.${key}`); return;
      }
      setDialog(null); setFlash({ clubId: selected.clubId, key: removing ? "removed" : selected.mode === "edit" ? "saved" : "created" });
      resource.reload();
    } catch {
      if (currentClub.current === selected.clubId) setDialogError(`manager.administration.parents.${selected.mode === "remove" ? "removeError" : "saveError"}`);
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <div className={`${styles.page} ${page.page}`}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.nav.users")} / {local("title")}</nav>
    <div className={styles.topline}><div><h1>{local("title")}</h1><p className={styles.lead}>{local("lead")}</p></div>
      <div className="user-mgmt-actions"><label className="groups-season-nav-select"><select aria-label={t("common.club")} value={clubId} disabled={scope.loading || busy || !scope.clubs.length} onChange={event => scope.setClubId(event.target.value)}>
        {!clubId ? <option value="">{t(scope.clubs.length ? "manager.chooseClub" : "manager.noClub")}</option> : null}
        {scope.clubs.map(club => <option key={club.id} value={club.id}>{club.name || t("common.club")}</option>)}
      </select></label><button className="btn" disabled={!ready || busy} onClick={() => open("create")}><Plus size={14}/>{local("add")}</button></div></div>
    {scope.error || resource.error ? <div className={actions.errorAlert} role="alert">{scope.error || local("loadError")}<button type="button" className={actions.secondaryButton} onClick={resource.reload}>{t("manager.refresh")}</button></div> : null}
    {flash?.clubId === clubId ? <div role="status" className={actions.successAlert}>{local(flash.key)}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label={t("manager.administration.loading")} /></section>
      : !clubId && !scope.error ? <section className={styles.overview}>{t("manager.noClub")}</section> : ready ? <>
      <section className={styles.overview}><div className={styles.statsGrid}>
        <article className={styles.statCard}><span>{local("all")}</span><b>{parents.length}</b><small>{t("manager.administration.inClub")}</small></article>
        <article className={styles.statCard}><span>{t("manager.administration.active")}</span><b>{parents.filter(p => p.is_active).length}</b><small>{t("manager.administration.inClub")}</small></article>
        <article className={styles.statCard}><span>{local("withoutChildren")}</span><b>{parents.filter(p => !p.juniors.length).length}</b><small>{t("manager.administration.inClub")}</small></article>
      </div></section>
      <section className={`${styles.quickPanel} ${directoryStyles.panel}`}><div className={`${styles.sectionHeading} ${directoryStyles.heading} ${page.sectionHeading}`}><h2>{local("title")}</h2><button type="button" className={styles.refreshButton} disabled={busy} onClick={resource.reload}><RefreshCw size={14}/>{t("manager.refresh")}</button></div>
        <div className="user-mgmt-toolbar"><label className="user-mgmt-field" style={{ minWidth: 220 }}><span className="user-mgmt-field-label">{t("manager.settings.search")}</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "#778178" }}/><input value={query} onChange={e => setQuery(e.target.value)} style={{ paddingLeft: 33 }} placeholder={local("search")} /></span></label>
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.performance.status")}</span><select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">{local("all")}</option><option value="active">{t("manager.administration.active")}</option><option value="inactive">{t("manager.administration.inactive")}</option><option value="unlinked">{local("withoutChildren")}</option>
          </select></label></div>
        <div className="user-mgmt-table-wrap"><table className={`${directoryStyles.table} ${page.table} user-mgmt-table user-mgmt-table--compact user-mgmt-table--players`}><thead><tr><th aria-label={t("manager.performance.avatar")}/><th>{t("manager.administration.fullName")}</th><th>{t("manager.administration.email")}</th><th>{t("manager.profile.phone")}</th><th>{local("children")}</th><th>{t("manager.performance.status")}</th><th aria-label={t("manager.content.actions")}/></tr></thead>
          <tbody>{rows.length ? rows.map(parent => <tr key={parent.id}>
            <td><span className="user-mgmt-member-avatar" aria-hidden="true">{[parent.first_name, parent.last_name].map(value => value.trim().charAt(0).toUpperCase()).join("") || "—"}</span></td>
            <td><div className={page.details}><b>{[parent.last_name, parent.first_name].filter(Boolean).join(" ") || t("manager.content.parent")}</b>{parent.other_roles.length ? <span className={page.muted}>{local("otherRoles")} : {parent.other_roles.map(role => t(`manager.content.${role === "player" ? "junior" : role}`)).join(", ")}</span> : null}{!parent.can_manage ? <span className={page.muted}>{local("protected")}</span> : null}</div></td>
            <td data-label={t("manager.administration.email")}>{parent.email || "—"}</td>
            <td data-label={t("manager.profile.phone")}>{parent.phone || "—"}</td>
            <td data-label={local("children")}><div className={page.links}>{parent.juniors.length ? parent.juniors.map(junior => <Link key={junior.player_id} href={`/manager/user-management/players/${junior.member_id}?club=${clubId}&tab=parent-access`}>{junior.name || t("manager.content.junior")}</Link>) : <span className={page.muted}>{local("none")}</span>}</div></td>
            <td data-label={t("manager.performance.status")}><span className="pill-soft">{t(parent.is_active ? "manager.administration.active" : "manager.administration.inactive")}</span></td>
            <td><button type="button" className="btn" disabled={!parent.can_manage || busy} aria-label={managerFormat(t,"manager.administration.editNamed",{name:name(parent)})} title={local("edit")} onClick={() => open("edit",parent)}><Pencil size={15}/></button>
              <button type="button" className="btn-danger soft" disabled={!parent.can_manage || busy} aria-label={managerFormat(t,"manager.administration.parents.removeNamed",{name:name(parent)})} title={local("remove")} onClick={() => open("remove",parent)}><Trash2 size={15}/></button></td>
          </tr>) : <tr><td colSpan={7}><div className="marketplace-empty">{local("empty")}</div></td></tr>}</tbody></table></div>
      </section></> : null}
    {activeDialog ? <AccessibleDialog onClose={close} className={page.dialog} label={local(activeDialog.mode === "remove" ? "confirm" : activeDialog.mode === "edit" ? "edit" : "add")}>
      <form onSubmit={submit} className={page.form}><h2>{local(activeDialog.mode === "remove" ? "confirm" : activeDialog.mode === "edit" ? "edit" : "add")}</h2>
        {activeDialog.mode === "remove" ? <div>
          <p>{managerFormat(t,"manager.administration.parents.confirmBody",{name:name(activeDialog.parent!),club:scope.clubs.find(c=>c.id===clubId)?.name ?? t("common.club")})}</p>
          <p>{managerFormat(t,"manager.administration.parents.linksRemoved",{count:activeDialog.parent!.juniors.filter(j=>!j.shared).length})}</p>
          {activeDialog.parent!.juniors.some(j=>j.shared) ? <p>{managerFormat(t,"manager.administration.parents.sharedKept",{count:activeDialog.parent!.juniors.filter(j=>j.shared).length})}</p> : null}
          <p>{local("accountKept")}</p>
        </div> : <><p>{local(activeDialog.mode === "create" ? "createHelp" : "emailLocked")}</p>
          {(["first_name","last_name","email","phone"] as const).map(key => <label key={key} className={actions.field}>
            <span>{t(key === "first_name" ? "manager.profile.firstName" : key === "last_name" ? "manager.content.name" : key === "email" ? "manager.administration.email" : "manager.profile.phone")}</span>
            <input type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} value={form[key]} required={key !== "phone" && !(key === "email" && activeDialog.mode === "edit")} readOnly={key === "email" && activeDialog.mode === "edit"} disabled={busy} onChange={event => setForm(previous => ({...previous,[key]:event.target.value}))}/>
          </label>)}</>}
        {dialogError ? <div className={actions.errorAlert} role="alert">{t(dialogError)}</div> : null}
        <div className={page.dialogActions}><button type="button" className={actions.secondaryButton} disabled={busy} onClick={close}>{t("common.cancel")}</button>
          <button type="submit" className={activeDialog.mode === "remove" ? actions.dangerButton : actions.primaryButton} disabled={busy}>{busy ? t("manager.administration.loading") : activeDialog.mode === "remove" ? local("remove") : t("common.save")}</button></div>
      </form></AccessibleDialog> : null}
  </div>;
}
