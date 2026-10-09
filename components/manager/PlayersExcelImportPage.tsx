"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Download, RefreshCw, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerCount, managerLocaleTag } from "@/lib/managerLocale";
import { managerJuniorFeedback, managerJuniorFormat } from "@/lib/managerJuniorPresentation";
import { createJuniorImportProgress, newJuniorImportConflicts, parseJuniorImportRows, runJuniorImport, type ExistingJuniorImportMember, type JuniorImportRow, type JuniorImportSummary } from "@/lib/managerJuniorImport";
import { readJuniorImportWorkbook, juniorImportFieldSignature } from "@/lib/managerJuniorImportWorkbook";
import { juniorImportFields, type JuniorImportField } from "@/lib/managerImportFields";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import importStyles from "./PlayersExcelImportPage.module.css";

type Club = { id: string; name: string };
async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export default function PlayersExcelImportPage() {
  const { t, locale } = useI18n();
  const requestedClubId = useSearchParams().get("club") ?? "";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [existing, setExisting] = useState<ExistingJuniorImportMember[]>([]);
  const [fields, setFields] = useState<JuniorImportField[]>([]);
  const [rows, setRows] = useState<JuniorImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<JuniorImportSummary | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const progress = useRef(createJuniorImportProgress());
  const working = useRef(false);
  const requestVersion = useRef(0);
  const [membersReady, setMembersReady] = useState(false);
  const number = (value: number) => value.toLocaleString(managerLocaleTag(locale));
  const j = (key: string) => t(`manager.junior.import.${key}`);

  async function loadMembers(id: string) {
    const version = ++requestVersion.current;
    setMembersReady(false);
    setExisting([]);
    setFields([]);
    if (!id) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/manager/clubs/${id}/members`, { headers: await authHeaders(), cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Chargement impossible.");
      if (version !== requestVersion.current) return;
      setExisting(json.members ?? []);
      setFields(json.playerFields ?? []);
      setMembersReady(true);
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally { if (version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders() });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Impossible de charger les clubs.");
        const next = json.clubs ?? [];
        setClubs(next);
        const first = next.find((club: Club) => club.id === requestedClubId)?.id ?? next[0]?.id ?? "";
        setClubId(first);
        await loadMembers(first);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); setLoading(false); }
    })();
  // Initialize once so language changes and local club selection preserve the import preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const backUrl = `/manager/user-management/players${clubId ? `?club=${clubId}` : ""}`;

  async function readFile(file: File) {
    if (working.current || !membersReady) return;
    working.current = true;
    setReading(true); setError(""); setSummary(null); setFileName(file.name); setRows([]);
    progress.current = createJuniorImportProgress();
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("manager.junior.import.fileLimit");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, raw: true, sheetRows: 2002 });
      const raw = readJuniorImportWorkbook(workbook, clubId, fields);
      setRows(parseJuniorImportRows(raw, existing, fields));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "manager.junior.import.readError"); }
    finally { working.current = false; setReading(false); }
  }

  async function downloadTemplate() {
    if (working.current || !membersReady) return;
    working.current = true; setPreparing(true); setError("");
    try {
      const { downloadJuniorImportExcel } = await import("@/lib/managerJuniorImportExcel");
      const name = (clubs.find(club => club.id === clubId)?.name ?? "organisation").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
      await downloadJuniorImportExcel(clubId, fields, t, `activitee-juniors-${name}.xlsx`);
    } catch { setError("manager.junior.import.templateError"); }
    finally { working.current = false; setPreparing(false); }
  }

  const stats = useMemo(() => ({ valid: rows.filter(row => !row.errors.length).length, errors: rows.filter(row => row.errors.length).length, duplicates: rows.filter(row => row.possible_duplicate).length, existingParents: new Set(rows.flatMap(row => row.parents.filter(parent => parent.exists).map(parent => parent.email))).size, withoutParents: rows.filter(row => !row.parents.length).length, links: rows.filter(row => !row.errors.length).reduce((sum, row) => sum + row.parents.length, 0) }), [rows]);
  const remaining = rows.filter(row => !row.errors.length && !progress.current.completed.has(row.row)).length;

  async function importRows() {
    if (working.current || !clubId || !membersReady || !remaining) return;
    if (!window.confirm(managerCount(t, locale, "manager.junior.import.confirm", remaining))) return;
    working.current = true;
    setBusy(true); setError("");
    try {
      const check = await fetch(`/api/manager/clubs/${clubId}/members`, { headers: await authHeaders(), cache: "no-store" });
      const latest = await check.json();
      if (!check.ok) throw new Error(latest.error ?? "Chargement impossible.");
      if (juniorImportFieldSignature(latest.playerFields ?? []) !== juniorImportFieldSignature(fields)) throw new Error("manager.junior.import.templateStale");
      const conflicts = newJuniorImportConflicts(rows, latest.members ?? [], progress.current);
      if (conflicts.size) {
        setRows(rows.map(row => conflicts.has(row.row) ? { ...row, errors: [...row.errors, "manager.junior.import.duplicateJunior"], possible_duplicate: true } : row));
        throw new Error("manager.junior.import.duplicateJunior");
      }
      const result = await runJuniorImport(rows, clubId, progress.current, async (path, body, fallback) => {
        const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body) });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? fallback);
        return json;
      });
      setSummary(result);
      await loadMembers(clubId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "manager.junior.import.error"); }
    finally { working.current = false; setBusy(false); }
  }

  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href={backUrl}>{t("manager.fields.player")}</Link> / {t("manager.administration.players.import")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.administration.players.import")}</h1><p className={styles.lead}>{j("lead")}</p></div><div className={actionStyles.topActions}>
      <label className="groups-season-nav-select"><select aria-label={t("manager.settings.club")} value={clubId} disabled={busy || preparing || reading || loading} onChange={event => { const id = event.target.value; setClubId(id); setRows([]); setSummary(null); setFileName(""); setError(""); progress.current = createJuniorImportProgress(); void loadMembers(id); }}>{clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
      <Link className={actionStyles.backButton} href={backUrl}><ArrowLeft size={16} />{j("back")}</Link>
    </div></div>
    {error ? <div className={styles.errorAlert} role="alert">{managerJuniorFeedback(t, error)}{clubId && !membersReady && !loading ? <button type="button" className={actionStyles.secondaryButton} onClick={() => { setError(""); void loadMembers(clubId); }}>{t("manager.refresh")}</button> : null}</div> : null}
    <section className={styles.overview}><div className={styles.sectionHeading}><div><h2>{j("source")}</h2><p>{j("formats")}</p></div></div>
      <p className={importStyles.help}>{j("templateHelp")}</p>
      <p className={importStyles.help}>{j("templateScope")}</p>
      <div className={importStyles.actions}>
        <button type="button" className={actionStyles.secondaryButton} disabled={busy || preparing || reading || loading || !membersReady} onClick={() => void downloadTemplate()}><Download size={16} />{j(preparing ? "preparing" : "template")}</button>
        <button type="button" className={actionStyles.primaryButton} disabled={busy || preparing || reading || loading || !membersReady} onClick={() => fileInput.current?.click()}><FileSpreadsheet size={16} /><span className={importStyles.fileName}>{reading ? j("reading") : fileName || j("choose")}</span></button>
        <input ref={fileInput} key={clubId} hidden type="file" accept=".xlsx,.xls,.csv" disabled={busy || preparing || reading || loading || !membersReady} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readFile(file); }} />
      </div>
      {membersReady ? <p className={importStyles.help}>{managerJuniorFormat(t, "import.fieldCounts", { juniors: juniorImportFields(fields, "player").length, parents: juniorImportFields(fields, "parent").length })}</p> : null}
    </section>
    {rows.length ? <>
      <section className={styles.overview}><div className={styles.statsGrid}>{(["valid", "errors", "duplicates", "existingParents", "withoutParents", "links"] as const).map(key => <article key={key} className={styles.statCard}><span>{j(key === "valid" ? "validRows" : key)}</span><b>{number(stats[key])}</b></article>)}</div></section>
      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{j("validation")}</h2><p>{j("ignored")}</p></div><button type="button" className={actionStyles.primaryButton} disabled={busy || preparing || loading || !membersReady || !remaining} onClick={() => void importRows()}>{busy ? <RefreshCw size={16} className={styles.spin} /> : <Upload size={16} />}{busy ? j("busy") : managerCount(t, locale, "manager.junior.import.action", remaining)}</button></div>
        <div className="user-mgmt-table-wrap"><table className={`user-mgmt-table user-mgmt-table--compact ${importStyles.table}`}><thead><tr><th>{j("row")}</th><th>{t("manager.performance.junior")}</th><th>{t("manager.content.parent")}</th><th>{j("link")}</th><th>{j("check")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.row}>
          <td data-label={j("row")}>{number(row.row)}</td>
          <td data-label={t("manager.performance.junior")}><b>{row.junior_first_name} {row.junior_last_name}</b><small>{row.junior_birth_date ? new Date(`${row.junior_birth_date}T12:00:00Z`).toLocaleDateString(managerLocaleTag(locale), { timeZone: "UTC" }) : j("noBirth")} · {row.junior_email || j("noEmail")}</small>{Object.entries(row.field_values).map(([id, value]) => <small key={id}>{fields.find(field => field.id === id)?.label} : {Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? j(value ? "yes" : "no") : String(value)}</small>)}</td>
          <td data-label={t("manager.content.parent")}>{row.parents.length ? row.parents.map((parent, index) => <div key={index} className={importStyles.parent}><b>{parent.first_name} {parent.last_name}</b><small>{parent.email}{parent.exists ? j("existingSuffix") : ""}</small>{Object.entries(parent.field_values).map(([id, value]) => <small key={id}>{fields.find(field => field.id === id)?.label} : {Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? j(value ? "yes" : "no") : String(value)}</small>)}</div>) : j("noParent")}</td>
          <td data-label={j("link")}>{row.parents.length ? row.parents.map((parent, index) => <div key={index} className={importStyles.parent}>{parent.is_primary ? j("primaryPrefix") : ""}{t(`manager.junior.relation.${parent.relation}`)}</div>) : "—"}</td>
          <td data-label={j("check")}><span className={row.errors.length ? importStyles.invalid : "pill-soft"}>{progress.current.completed.has(row.row) ? j("done") : row.errors.length ? [...row.errors.filter(key => key !== "manager.junior.import.customInvalid").map(key => t(key)), ...row.field_errors.map(issue => `${issue.label.replace(/^(junior|parent1|parent2)/, prefix => j(prefix))} : ${t(issue.key)}`)].join(" · ") : row.possible_duplicate ? j("validDuplicate") : j("valid")}</span></td>
        </tr>)}</tbody></table></div>
      </section>
    </> : null}
    {summary ? <section className={styles.quickPanel} role="status"><div className={styles.sectionHeading}><div><h2>{j(summary.errors.length ? "partial" : "finished")}</h2><p>{managerJuniorFormat(t, "import.summary", { juniors: number(summary.juniors_created_or_updated), parents: number(summary.parents_created_or_updated), links: number(summary.associations), errors: number(summary.errors.length) })}</p></div>{summary.errors.length ? null : <CheckCircle2 size={22} />}</div>
      {summary.errors.length ? <div className="notice-card"><p>{j("resumeHelp")}</p>{summary.errors.map(item => <div key={item.row}>{managerJuniorFormat(t, "import.rowError", { row: number(item.row), error: managerJuniorFeedback(t, item.error) ?? "" })}</div>)}</div> : null}
      <div className={actionStyles.topActions} style={{ marginTop: 14 }}><Link className={actionStyles.primaryButton} href="/manager/access">{j("invites")}</Link></div>
    </section> : null}
  </div>;
}
