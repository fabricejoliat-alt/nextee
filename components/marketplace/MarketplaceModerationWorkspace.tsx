"use client";
/* eslint-disable @next/next/no-img-element -- Private listing photos use expiring signed URLs. */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText, type MarketplaceSafetyLabel } from "@/lib/marketplaceSafetyLabels";
import styles from "./MarketplaceModerationWorkspace.module.css";

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

export default function MarketplaceModerationWorkspace() {
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
    return <article className={styles.card} key={item.id}>
      <div className={styles.cardHeader}><h2>{item.title}</h2><span>{data.clubs.find(row => row.id === item.club_id)?.name}</span></div>
      <p>{[item.category, item.brand, item.model].filter(Boolean).join(" · ")} · {item.is_free ? t("marketplace.free") : `${item.price ?? "—"} CHF`}</p>
      <p className={styles.description}>{item.description}</p>
      <p>{item.owner_name} · {item.contact_email} {item.contact_phone}</p>
      <div className={styles.photos}>{item.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${item.title} — ${index + 1}`} /></a>)}</div>
      <strong>{text(item.moderation_status as "pending" | "approved" | "rejected")}</strong>
      {item.moderation_note && <p>{item.moderation_note}</p>}
      {reports.map(report => <div className={styles.report} key={report.id}>
        <strong>{text(report.reason)}</strong> · {new Date(report.created_at).toLocaleDateString(locale)}
        <p className={styles.description}>{report.details}</p>
        <button className="btn" disabled={busy} onClick={() => void action({ action: "resolve", report_id: report.id })}>{text("resolve")}</button>
      </div>)}
      <label className={styles.label}>{text("note")}<textarea rows={2} value={note} maxLength={2000} disabled={busy} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} /></label>
      <div className={styles.actions}>
        <button className="btn btn-primary" disabled={busy || item.moderation_status === "approved"} onClick={() => void action({ action: "approve", item_id: item.id, revision: item.moderation_revision, note })}>{text("approve")}</button>
        <button className="btn" disabled={busy || note.trim().length < 3} onClick={() => void action({ action: "reject", item_id: item.id, revision: item.moderation_revision, note })}>{text("reject")}</button>
        <button className="btn" disabled={busy || note.trim().length < 3} onClick={() => void action({ action: "suspend", item_id: item.id, note })}>{text("suspend")}</button>
      </div>
    </article>;
  }
  return <div className={styles.page}>
    <header className={styles.header}><h1>{text("moderation")}</h1><p>{text("reviewInstructions")}</p></header>
    <div className={styles.toolbar}>
      <select aria-label={text("allClubs")} value={club} disabled={busy} onChange={event => setClub(event.target.value)}>
        <option value="">{text("allClubs")}</option>{data.clubs.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
      </select>
      <select aria-label={text("moderation")} value={status} disabled={busy} onChange={event => setStatus(event.target.value)}>
        {(["pending", "approved", "rejected"] as const).map(value => <option key={value} value={value}>{text(value)}</option>)}
      </select>
      <button className="btn" disabled={busy} onClick={() => void load()}>{text("refresh")}</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {saved && <p role="status">{text("saved")}</p>}
    {busy && <p role="status">{t("common.loading")}</p>}
    <h2>{text("reports")} ({data.reports.length})</h2>
    {data.items.filter(item => data.reports.some(report => report.item_id === item.id)).map(listing)}
    {data.reports.filter(report => !report.item_id).map(report => {
      const message = data.messages.find(message => message.id === report.message_id);
      const note = notes[report.id] ?? "";
      return <article className={styles.card} key={report.id}>
        <strong>{message?.subject ?? text("removed")} · {text(report.reason)}</strong>
        {message && <><p>{message.reply_email}</p><p className={styles.description}>{message.message}</p></>}
        <p>{report.details}</p>
        {message && <label className={styles.label}>{text("note")}<textarea rows={2} value={note} maxLength={2000} disabled={busy} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} /></label>}
        <div className={styles.actions}>
          {message && <button className="btn" disabled={busy || note.trim().length < 3} onClick={() => void action({ action: "suspend", message_id: message.id, note })}>{text("suspend")}</button>}
          <button className="btn" disabled={busy} onClick={() => void action({ action: "resolve", report_id: report.id })}>{text("resolve")}</button>
        </div>
      </article>;
    })}
    <h2>{text(status as "pending" | "approved" | "rejected")}</h2>
    {!busy && !data.items.some(item => item.moderation_status === status) && <p>{text("noItems")}</p>}
    {data.items.filter(item => item.moderation_status === status && !data.reports.some(report => report.item_id === item.id)).map(listing)}
    {data.suspensions.length > 0 && <><h2>{text("suspensions")}</h2>{data.suspensions.map(row => <article className={styles.card} key={`${row.club_id}/${row.user_id}`}>
      <strong>{row.name} · {data.clubs.find(club => club.id === row.club_id)?.name}</strong><p>{row.reason}</p>
      <button className="btn" disabled={busy} onClick={() => void action({ action: "unsuspend", user_id: row.user_id, club_id: row.club_id })}>{text("restore")}</button>
    </article>)}</>}
  </div>;
}
