"use client";
/* eslint-disable @next/next/no-img-element -- Private listing photos use expiring signed URLs. */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Ban, Check, CheckCheck, Mail, Phone, RefreshCw, ShieldCheck, UserRound, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText, type MarketplaceSafetyLabel } from "@/lib/marketplaceSafetyLabels";
import styles from "./MarketplaceModerationWorkspace.module.css";
import pageStyles from "@/components/admin/AdminHomeStats.module.css";
import controls from "@/app/manager/camps/Camps.module.css";
import InlineNotice from "@/components/ui/InlineNotice";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type Listing = {
  id: string; club_id: string; user_id: string; title: string; description: string | null; category: string | null;
  brand: string | null; model: string | null; contact_email: string | null; contact_phone: string | null;
  price: number | null; is_free: boolean; moderation_status: string; moderation_revision: number;
  moderation_note: string | null; images: string[]; owner_name: string;
};
type Report = { id: string; item_id: string | null; message_id: string | null; club_id: string; reason: MarketplaceSafetyLabel; details: string; created_at: string };
type Suspension = { user_id: string; club_id: string; reason: string; name: string };
type Payload = { clubs: Array<{ id: string; name: string }>; items: Listing[]; reports: Report[]; suspensions: Suspension[]; messages: Array<{ id: string; subject: string; message: string; reply_email: string }> };
const empty: Payload = { clubs: [], items: [], reports: [], suspensions: [], messages: [] };
const statusFilters = [
  { value: "pending", label: "queuePending" },
  { value: "approved", label: "queueApproved" },
  { value: "rejected", label: "queueRejected" },
] as const;

export default function MarketplaceModerationWorkspace({ audience = "admin" }: { audience?: "manager" | "admin" }) {
  const { locale, t } = useI18n();
  const text = (key: MarketplaceSafetyLabel) => marketplaceSafetyText(locale, key);
  const params = useSearchParams();
  const [club, setClub] = useState(params.get("club") ?? "");
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState<Payload>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const endpoint = `/api/marketplace/moderation?${new URLSearchParams({ status, ...(club ? { club_id: club } : {}) })}`;
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (cause) { setData(empty); setError(cause instanceof Error ? cause.message : "Erreur"); }
    finally { setBusy(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  async function action(input: Record<string, unknown>) {
    if (busy) return;
    if (input.action === "suspend" && !window.confirm(text("suspensionConfirm"))) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch(endpoint, { method: "POST",
        headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load(); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : text("error")); }
    finally { setBusy(false); }
  }
  function listing(item: Listing) {
    const reports = data.reports.filter(report => report.item_id === item.id);
    const note = notes[item.id] ?? "";
    return <article className={styles.listing} key={item.id}>
      <div className={styles.listingHeader}>
        <div>
          <p className={styles.clubName}>{data.clubs.find(row => row.id === item.club_id)?.name}</p>
          <h3>{item.title}</h3>
          <p className={styles.meta}>{[item.category, item.brand, item.model].filter(Boolean).join(" · ")}</p>
        </div>
        <div className={styles.listingBadges}>
          <span className={styles.price}>{item.is_free ? t("marketplace.free") : `${item.price ?? "—"} CHF`}</span>
          <span className={`${styles.badge} ${styles[item.moderation_status]}`}>{text(item.moderation_status as "pending" | "approved" | "rejected")}</span>
        </div>
      </div>
      <div className={styles.listingContent}>
        {item.images.length > 0 && <div className={styles.photos}>{item.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${item.title} — ${index + 1}`} loading="lazy" /></a>)}</div>}
        <div className={styles.details}>
          {item.description && <p className={styles.description}>{item.description}</p>}
          <div className={styles.contact}>
            <span><UserRound size={14} aria-hidden="true" />{item.owner_name}</span>
            {item.contact_email && <span><Mail size={14} aria-hidden="true" />{item.contact_email}</span>}
            {item.contact_phone && <span><Phone size={14} aria-hidden="true" />{item.contact_phone}</span>}
          </div>
        </div>
      </div>
      {item.moderation_note && <InlineNotice variant={item.moderation_status === "rejected" ? "error" : "info"} title={text("decision")}><p>{item.moderation_note}</p></InlineNotice>}
      {reports.map(report => <div className={styles.report} key={report.id}>
        <InlineNotice title={text(report.reason)}>
          <p>{new Date(report.created_at).toLocaleDateString(locale)}</p>
          <p className={styles.description}>{report.details}</p>
        </InlineNotice>
        <button className={controls.secondary} disabled={busy} onClick={() => void action({ action: "resolve", report_id: report.id })}><CheckCheck size={16} aria-hidden="true" />{text("resolve")}</button>
      </div>)}
      <div className={styles.decision}>
        <label className={controls.field}>{text("note")}<textarea rows={2} value={note} maxLength={2000} disabled={busy} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} /></label>
        <div className={styles.actions}>
          <button className={controls.primary} disabled={busy || item.moderation_status === "approved"} onClick={() => void action({ action: "approve", item_id: item.id, revision: item.moderation_revision, note })}><Check size={16} aria-hidden="true" />{text("approve")}</button>
          <button className={controls.secondary} disabled={busy || note.trim().length < 3} onClick={() => void action({ action: "reject", item_id: item.id, revision: item.moderation_revision, note })}><X size={16} aria-hidden="true" />{text("reject")}</button>
          <button className={controls.danger} disabled={busy || note.trim().length < 3} onClick={() => void action({ action: "suspend", item_id: item.id, note })}><Ban size={16} aria-hidden="true" />{text("suspend")}</button>
        </div>
      </div>
    </article>;
  }
  const reportedItems = data.items.filter(item => data.reports.some(report => report.item_id === item.id));
  const queueItems = data.items.filter(item => item.moderation_status === status && !reportedItems.includes(item));
  return <div className={`${pageStyles.page} ${styles.page}`}>
    {audience === "manager" && <nav className={styles.breadcrumb} aria-label={t("manager.content.breadcrumb")}>
      <Link href={`/manager${club ? `?club=${encodeURIComponent(club)}` : ""}`}>{t("manager.content.manager")}</Link>
      <span aria-hidden="true">/</span><span>{text("moderation")}</span>
    </nav>}
    <header className={pageStyles.topline}>
      <div><h1>{text("moderation")}</h1><p className={pageStyles.lead}>{text("reviewInstructions")}</p></div>
      <button type="button" className={pageStyles.refreshButton} disabled={busy} onClick={() => void load()}>
        <RefreshCw size={16} aria-hidden="true" className={busy ? pageStyles.spin : undefined} />{text("refresh")}
      </button>
    </header>
    {error && <InlineNotice variant="error" title={error} />}
    {saved && <InlineNotice variant="success" title={text("saved")} />}
    <section className={pageStyles.quickPanel} aria-labelledby="marketplace-listings-title">
      <div className={`${pageStyles.sectionHeading} ${styles.panelHeader}`}>
        <div><h2 id="marketplace-listings-title">{text("listings")}</h2></div>
        <label className={`${controls.field} ${styles.clubFilter}`}>{t("organization.context")}
          <select value={club} disabled={busy} onChange={event => setClub(event.target.value)}>
            <option value="">{text("allClubs")}</option>{data.clubs.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.statusTabs} role="group" aria-label={text("publicationStatus")}>
        {statusFilters.map(filter => <button type="button" key={filter.value} aria-pressed={status === filter.value} disabled={busy}
          onClick={() => { setStatus(filter.value); setSaved(false); }}>{text(filter.label)}</button>)}
      </div>
      {busy ? <ListLoadingBlock label={t("common.loading")} /> : !error && <>
        {!queueItems.length && <p className={pageStyles.attentionEmpty}>{text("noItems")}</p>}
        <div className={styles.list}>{queueItems.map(listing)}</div>
      </>}
    </section>
    {!error && <>
    {data.reports.length > 0 && <section className={pageStyles.quickPanel} aria-labelledby="marketplace-reports-title">
    <div className={pageStyles.sectionHeading}><h2 id="marketplace-reports-title">{text("reports")} <span className={`${styles.badge} ${styles.pending}`}>{data.reports.length}</span></h2></div>
    <div className={styles.list}>
    {reportedItems.map(listing)}
    {data.reports.filter(report => !report.item_id).map(report => {
      const message = data.messages.find(message => message.id === report.message_id);
      const note = notes[report.id] ?? "";
      return <article className={styles.listing} key={report.id}>
        <div className={styles.listingHeader}><h3>{message?.subject ?? text("removed")}</h3></div>
        {message && <><p className={styles.contact}>{message.reply_email}</p><p className={styles.description}>{message.message}</p></>}
        <InlineNotice title={text(report.reason)}><p>{report.details}</p></InlineNotice>
        {message && <label className={controls.field}>{text("note")}<textarea rows={2} value={note} maxLength={2000} disabled={busy} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} /></label>}
        <div className={styles.actions}>
          {message && <button className={controls.danger} disabled={busy || note.trim().length < 3} onClick={() => void action({ action: "suspend", message_id: message.id, note })}><Ban size={16} aria-hidden="true" />{text("suspend")}</button>}
          <button className={controls.secondary} disabled={busy} onClick={() => void action({ action: "resolve", report_id: report.id })}><CheckCheck size={16} aria-hidden="true" />{text("resolve")}</button>
        </div>
      </article>;
    })}
    </div></section>}
    {data.suspensions.length > 0 && <section className={pageStyles.quickPanel} aria-labelledby="marketplace-suspensions-title">
      <div className={pageStyles.sectionHeading}><h2 id="marketplace-suspensions-title">{text("suspensions")}</h2></div>
      <div className={styles.list}>{data.suspensions.map(row => <article className={styles.listing} key={`${row.club_id}/${row.user_id}`}>
        <div className={styles.listingHeader}><div><h3>{row.name}</h3><p className={styles.meta}>{data.clubs.find(club => club.id === row.club_id)?.name}</p></div>
          <button className={controls.secondary} disabled={busy} onClick={() => void action({ action: "unsuspend", user_id: row.user_id, club_id: row.club_id })}><ShieldCheck size={16} aria-hidden="true" />{text("restore")}</button>
        </div><p className={styles.description}>{row.reason}</p>
      </article>)}</div>
    </section>}
    </>}
  </div>;
}
