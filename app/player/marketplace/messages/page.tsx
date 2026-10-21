"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Inbox as InboxIcon, Mail, Reply, Send, Trash2, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { organizationFetch } from "@/lib/organizationFetch";
import MarketplaceSafetyActions from "@/components/player/MarketplaceSafetyActions";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import { marketplaceMessageError, marketplaceMessageText } from "@/lib/marketplaceMessageLabels";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import InlineNotice from "@/components/ui/InlineNotice";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import playerUi from "@/components/player/PlayerUI.module.css";
import styles from "../Marketplace.module.css";

type Message = { id: string; item_id: string | null; subject: string; message: string; reply_email: string; created_at: string; correspondent: string; can_reply: boolean };
type Context = Awaited<ReturnType<typeof resolveEffectivePlayerContext>>;

async function mutate(input: Record<string, unknown>, expected: Context) {
  const context = await resolveEffectivePlayerContext();
  if (context.effectiveUserId !== expected.effectiveUserId || context.viewerUserId !== expected.viewerUserId) throw new Error("forbidden");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("unauthorized");
  const response = await organizationFetch("/api/player/marketplace/messages", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, child_id: context.role === "parent" ? context.effectiveUserId : null }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "unavailable");
  return result;
}

function MessageCard({ row, sent, canEdit, context, onDelete }: { row: Message; sent: boolean; canEdit: boolean; context: Context; onDelete: () => Promise<void> }) {
  const { locale } = useI18n();
  const text = (key: Parameters<typeof marketplaceMessageText>[1]) => marketplaceMessageText(locale, key);
  const [open, setOpen] = useState(false), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [replied, setReplied] = useState(false);
  const lock = useRef(false), requestId = useRef<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      await mutate({ action: "reply", message_id: row.id, message, request_id: requestId.current }, context);
      setReplied(true); setOpen(false); setMessage(""); requestId.current = null;
    } catch (cause) { setError(marketplaceMessageError(locale, cause instanceof Error ? cause.message : "unavailable")); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await onDelete(); }
    catch (cause) { setError(marketplaceMessageError(locale, cause instanceof Error ? cause.message : "unavailable")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <article className={`${playerUi.panel} ${styles.messageCard}`}>
    <header className={playerUi.panelHeader}><div><h2>{row.subject}</h2>
      <div className={styles.messageMeta}><span><Mail size={14} aria-hidden="true" />{sent ? `${text("to")} ` : ""}{row.correspondent || row.reply_email || text("member")}</span>
        <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</time></div>
    </div></header>
    <p className={styles.messageBody}>{row.message}</p>
    {replied && <InlineNotice variant="success" title={text("replied")} />}
    {error && <InlineNotice variant="error" title={error} />}
    <div className={styles.messageActions}>
      {!sent && row.can_reply && <button className={playerUi.primary} type="button" disabled={busy} onClick={() => { setOpen(!open); setError(""); }} aria-expanded={open} aria-controls={`reply-${row.id}`}><Reply size={16} aria-hidden="true" />{text("reply")}</button>}
      {canEdit && <button className={`${playerUi.iconButton} ${playerUi.dangerIcon}`} type="button" disabled={busy} onClick={() => void remove()} aria-label={text("delete")} title={text("delete")}><Trash2 size={17} aria-hidden="true" /></button>}
      {row.item_id && <Link className={playerUi.iconButton} href={`/player/marketplace/${row.item_id}${context.role === "parent" ? `?child_id=${context.effectiveUserId}` : ""}`} aria-label={text("listing")} title={text("listing")}><Eye size={17} aria-hidden="true" /></Link>}
    </div>
    {open && <form className={styles.messageReply} id={`reply-${row.id}`} onSubmit={submit}>
      <label htmlFor={`reply-text-${row.id}`}>{text("response")}</label>
      <textarea id={`reply-text-${row.id}`} value={message} onChange={event => { setMessage(event.target.value); requestId.current = null; }} rows={4} maxLength={4000} required disabled={busy} autoFocus />
      <div className={styles.messageActions}>
        <button type="submit" className={playerUi.primary} disabled={busy || !message.trim()}><Send size={15} aria-hidden="true" />{text(busy ? "sending" : "send")}</button>
        <button type="button" className={playerUi.secondary} disabled={busy} onClick={() => setOpen(false)}>{text("cancel")}</button>
      </div>
    </form>}
    {!sent && canEdit && <MarketplaceSafetyActions messageId={row.id} />}
  </article>;
}

function Inbox() {
  const { locale, t } = useI18n();
  const text = (key: Parameters<typeof marketplaceMessageText>[1]) => marketplaceMessageText(locale, key);
  const params = useSearchParams(), messageId = params.get("message"), childId = params.get("child_id");
  const sent = params.get("box") === "sent";
  const [messages, setMessages] = useState<Message[]>([]), [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(true), [moreBusy, setMoreBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(false), [hasMore, setHasMore] = useState(false);
  const [deleted, setDeleted] = useState<Message | null>(null), [undoBusy, setUndoBusy] = useState(false);
  const generation = useRef(0), moreLock = useRef(false), undoLock = useRef(false);
  const href = (box: boolean) => {
    const query = new URLSearchParams();
    if (box) query.set("box", "sent");
    if (childId) query.set("child_id", childId);
    return `/player/marketplace/messages${query.size ? `?${query}` : ""}`;
  };
  const load = useCallback(async (offset = 0) => {
    const current = ++generation.current;
    if (!offset) { setBusy(true); setMessages([]); setContext(null); }
    setError("");
    try {
      const context = await resolveEffectivePlayerContext();
      const { data } = await supabase.auth.getSession();
      const query = new URLSearchParams({ box: sent ? "sent" : "received", offset: String(offset) });
      if (context.role === "parent") query.set("child_id", childId || context.effectiveUserId);
      if (messageId) query.set("message", messageId);
      const response = await organizationFetch(`/api/player/marketplace/messages?${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "unavailable");
      if (current !== generation.current) return;
      setMessages(previous => offset ? [...previous, ...result.messages.filter((row: Message) => !previous.some(p => p.id === row.id))] : result.messages);
      setContext(context); setCanEdit(result.can_edit === true); setHasMore(result.has_more === true);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "unavailable"); }
    finally { if (current === generation.current) setBusy(false); }
  }, [messageId, sent, childId]); // The explicit child change must reload the inbox.
  useEffect(() => { setDeleted(null); void load(); const active = generation.current; return () => { if (generation.current === active) generation.current = active + 1; }; }, [load]);
  async function more() {
    if (moreLock.current) return;
    moreLock.current = true; setMoreBusy(true);
    try { await load(messages.length); } finally { moreLock.current = false; setMoreBusy(false); }
  }
  async function remove(row: Message) {
    if (!context) return;
    await mutate({ action: "delete", message_id: row.id }, context);
    setMessages(current => current.filter(message => message.id !== row.id)); setDeleted(row);
  }
  async function undo() {
    if (!context || !deleted || undoLock.current) return;
    undoLock.current = true; setUndoBusy(true); setError("");
    try {
      await mutate({ action: "restore", message_id: deleted.id }, context);
      setMessages(current => [...current.filter(row => row.id !== deleted.id), deleted].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setDeleted(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "unavailable"); }
    finally { undoLock.current = false; setUndoBusy(false); }
  }
  return <div className="player-dashboard-bg player-marketplace-page"><div className={`app-shell marketplace-page ${styles.page} ${styles.secondaryPage}`}>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("nav.marketplace"), href: "/player/marketplace" }, { label: marketplaceSafetyText(locale, "messages") }]} />
    <div className="glass-section"><div className={`marketplace-header ${styles.header}`}>
      <div><h1 className={`section-title ${styles.title}`}>{marketplaceSafetyText(locale, "messages")}</h1>
        <p className="section-subtitle">{marketplaceSafetyText(locale, "messagesIntro")}</p></div>
      <Link className={playerUi.secondary} href="/player/marketplace"><ArrowLeft size={16} aria-hidden="true" />{t("common.back")}</Link>
    </div></div>
    <div className={styles.messageToolbar}>
      <nav className={styles.messageTabs} aria-label={marketplaceSafetyText(locale, "messages")}>
        <Link href={href(false)} aria-current={!sent ? "page" : undefined}><InboxIcon size={15} aria-hidden="true" />{text("received")}</Link>
        <Link href={href(true)} aria-current={sent ? "page" : undefined}><Send size={15} aria-hidden="true" />{text("sent")}</Link>
      </nav>
    </div>
    {messageId && <Link className={styles.messageAll} href={href(sent)}><ArrowLeft size={15} aria-hidden="true" />{text("all")}</Link>}
    {error && <InlineNotice variant="error" title={marketplaceMessageError(locale, error)}><button className={playerUi.secondary} type="button" onClick={() => void load()}>{t("coach.retry")}</button></InlineNotice>}
    {deleted && <InlineNotice variant="success" title={text("deleted")}><p>{text("deleteHint")}</p><button className={playerUi.secondary} type="button" onClick={() => void undo()} disabled={undoBusy}><Undo2 size={15} aria-hidden="true" />{text("undo")}</button></InlineNotice>}
    {!busy && context && !canEdit && <InlineNotice variant="info" title={text("readOnly")} />}
    {busy ? <div className={playerUi.panel}><ListLoadingBlock label={t("common.loading")} /></div>
      : !error && !messages.length ? <div className={playerUi.panel}><div className={playerUi.empty}><InboxIcon size={20} aria-hidden="true" />{sent ? text("noSent") : marketplaceSafetyText(locale, "noMessages")}</div></div>
      : context && <div className={styles.messageList}>{messages.map(row => <MessageCard key={row.id} row={row} sent={sent} context={context} canEdit={canEdit} onDelete={() => remove(row)} />)}</div>}
    {!busy && hasMore && <button className={playerUi.secondary} type="button" disabled={moreBusy} onClick={() => void more()}>{moreBusy ? t("common.loading") : text("more")}</button>}
  </div></div>;
}
export default function Page() { return <Suspense><Inbox /></Suspense>; }
