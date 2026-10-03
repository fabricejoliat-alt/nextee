"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Pencil, Plus, RefreshCw, Save, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerSettingsPresentation } from "@/lib/managerSettingsPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useManagerClubChangeGuard } from "@/components/manager/useManagerClubChangeGuard";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import campStyles from "@/app/manager/camps/Camps.module.css";

type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type Club = { id: string; name: string };

export default function ManagerSeasonsPage() {
  const { t, locale } = useI18n();
  const router = useRouter(); const params = useSearchParams();
  const requestedClubId = params.get("club") ?? "";
  const { format, errorText } = managerSettingsPresentation(t, locale);
  const formatDate = (value: string) => new Intl.DateTimeFormat(managerLocaleTag(locale), { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  const [clubs, setClubs] = useState<Club[]>([]); const [clubsLoaded, setClubsLoaded] = useState(false);
  const [clubId, setClubId] = useState(""); const [seasons, setSeasons] = useState<Season[]>([]);
  const desiredClubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
  const pendingScope = clubsLoaded && desiredClubId !== clubId;
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(""); const [editingName, setEditingName] = useState(""); const [updatingId, setUpdatingId] = useState("");
  const [name, setName] = useState(""); const [startsOn, setStartsOn] = useState(""); const [endsOn, setEndsOn] = useState(""); const [isCurrent, setIsCurrent] = useState(true);
  useManagerClubChangeGuard(Boolean(name || startsOn || endsOn || editingId), t("manager.settings.seasons.discardDraft"), saving || Boolean(updatingId));
  async function headers() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }
  async function load(id: string) { const sequence = ++loadSequence.current; setLoading(true); setError(""); setSeasons([]); try { const response = await fetch(`/api/manager/clubs/${id}/seasons`, { headers: await headers() }); const json = await response.json(); if (!response.ok) throw new Error(json.error); if (sequence === loadSequence.current) setSeasons(json.seasons ?? []); } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : t("manager.settings.seasons.loadError")); } finally { if (sequence === loadSequence.current) setLoading(false); } }
  useEffect(() => { void (async () => {
    try {
      const response = await fetch("/api/manager/my-clubs", { headers: await headers() });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.settings.clubLoadError"));
      setClubs(json.clubs ?? []);
      setClubsLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("manager.settings.clubLoadError"));
      setClubsLoaded(true);
      setLoading(false);
    }
  })();
    // Fetch the club list once; language changes must not clear a season draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!clubsLoaded || error && !clubs.length) return;
    const next = desiredClubId;
    if (next === clubId) { if (!next) { setError(requestedClubId ? t("manager.clubUnavailable") : t("manager.settings.noClub")); setLoading(false); } return; }
    ++loadSequence.current;
    setClubId(next); setSeasons([]); setEditingId(""); setEditingName(""); setName(""); setStartsOn(""); setEndsOn(""); setMessage("");
    if (next) void load(next);
    else { setError(requestedClubId ? t("manager.clubUnavailable") : t("manager.settings.noClub")); setLoading(false); }
    // The selected URL club is the scope. Never reuse the previous club's seasons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubsLoaded, desiredClubId, requestedClubId]);
  function selectClub(id: string) {
    if (id === clubId || !clubs.some((club) => club.id === id) || saving || updatingId) return;
    if ((name || startsOn || endsOn || editingId) && !window.confirm(t("manager.settings.seasons.discardDraft"))) return;
    const next = new URLSearchParams(params.toString()); next.set("club", id);
    router.replace(`/manager/user-management/seasons?${next}`, { scroll: false });
  }
  async function create(event: React.FormEvent) { event.preventDefault(); if (!clubId || pendingScope || loading) return; setError(""); setMessage(""); if (!name || !startsOn || !endsOn) return setError(t("manager.settings.seasons.required")); if (endsOn < startsOn) return setError(t("manager.settings.seasons.dateOrder")); setSaving(true); try { const response = await fetch(`/api/manager/clubs/${clubId}/seasons`, { method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ name, starts_on: startsOn, ends_on: endsOn, is_current: isCurrent }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setName(""); setStartsOn(""); setEndsOn(""); setIsCurrent(false); setMessage(t("manager.settings.seasons.created")); await load(clubId); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.settings.seasons.createError")); } finally { setSaving(false); } }
  function startEditing(season: Season) { setError(""); setMessage(""); setEditingId(season.id); setEditingName(season.name); }
  function cancelEditing() { setEditingId(""); setEditingName(""); }
  async function updateName(event: React.FormEvent, season: Season) {
    event.preventDefault(); if (!clubId || pendingScope || loading) return; const nextName = editingName.trim(); setError(""); setMessage("");
    if (!nextName) return setError(t("manager.settings.seasons.nameRequired"));
    if (nextName === season.name) { cancelEditing(); return; }
    setUpdatingId(season.id);
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/seasons`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ season_id: season.id, name: nextName }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      setSeasons((current) => current.map((item) => item.id === season.id ? { ...item, name: json.season.name } : item));
      cancelEditing(); setMessage(t("manager.settings.seasons.updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.settings.seasons.updateError")); }
    finally { setUpdatingId(""); }
  }
  return <div className={styles.page}>
    <nav aria-label={t("manager.settings.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.settings.seasons.breadcrumb")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.settings.seasons.title")}</h1><p className={styles.lead}>{t("manager.settings.seasons.lead")}</p></div><div className={actionStyles.topActions}><label className="groups-season-nav-select"><select aria-label={t("common.club")} value={clubId} onChange={(event) => selectClub(event.target.value)} disabled={!clubsLoaded || Boolean(saving || updatingId)}>{!clubId ? <option value="">{t(clubs.length ? "manager.chooseClub" : "manager.noClub")}</option> : null}{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label></div></div>
    {error ? <div className={styles.errorAlert} role="alert">{errorText(error)}</div> : null}
    {message ? <div className={actionStyles.successAlert} role="status">{errorText(message)}</div> : null}
    <section className={styles.overview}><div className={styles.sectionHeading}><div><h2>{t("manager.settings.seasons.configured")}</h2><p>{t("manager.settings.seasons.currentHelp")}</p></div></div>{loading || pendingScope ? <ListLoadingBlock label={t("manager.settings.seasons.loading")} /> : seasons.length === 0 ? <div className="marketplace-empty">{t("manager.settings.seasons.empty")}</div> : <div className={styles.quickGrid}>{seasons.map((season) => <article key={season.id} className={styles.quickLink}>
      <span><CalendarDays size={18} /></span>
      {editingId === season.id ? <form className={styles.quickLinkEditForm} onSubmit={(event) => void updateName(event, season)}>
        <div className={styles.quickLinkEditContent}><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.settings.seasons.name")}</span><input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} disabled={updatingId === season.id} /></label><small>{formatDate(season.starts_on)} — {formatDate(season.ends_on)}</small></div>
        <aside className={`${styles.quickLinkActions} ${styles.quickLinkEditActions}`}><button type="submit" className={`${campStyles.iconButton} ${styles.seasonIconButton}`} title={t("manager.settings.save")} aria-label={format("seasons.saveName", { name: season.name })} disabled={updatingId === season.id || !editingName.trim()}>{updatingId === season.id ? <RefreshCw size={15} className={styles.spin} /> : <Save size={15} />}</button><button type="button" className={`${campStyles.iconButton} ${styles.seasonIconButton}`} title={t("manager.settings.cancel")} aria-label={t("manager.settings.seasons.cancelEdit")} onClick={cancelEditing} disabled={updatingId === season.id}><X size={15} /></button></aside>
      </form> : <><div><b>{season.name}{season.is_current ? t("manager.settings.seasons.currentSuffix") : ""}</b><small>{formatDate(season.starts_on)} — {formatDate(season.ends_on)}</small></div><aside className={styles.quickLinkActions}><button type="button" className={`${campStyles.iconButton} ${styles.seasonIconButton}`} title={t("manager.settings.seasons.edit")} aria-label={format("seasons.editName", { name: season.name })} onClick={() => startEditing(season)} disabled={Boolean(updatingId)}><Pencil size={15} /></button></aside></>}
    </article>)}</div>}</section>
    {clubId && !pendingScope ? <section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{t("manager.settings.seasons.new")}</h2><p>{t("manager.settings.seasons.singleCurrent")}</p></div></div><form onSubmit={create} style={{ display: "grid", gap: 16 }}><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.settings.name")}</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="2026–2027" /></label><div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.settings.seasons.start")}</span><input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.settings.seasons.end")}</span><input required type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div><label className="pill-soft"><input type="checkbox" checked={isCurrent} onChange={(event) => setIsCurrent(event.target.checked)} /> {t("manager.settings.seasons.setCurrent")}</label><div><button type="submit" className="btn" disabled={saving || loading}>{saving ? <RefreshCw size={14} className={styles.spin} /> : <Plus size={14} />}{saving ? t("manager.settings.seasons.creating") : t("manager.settings.seasons.create")}</button></div></form></section> : null}
  </div>;
}
