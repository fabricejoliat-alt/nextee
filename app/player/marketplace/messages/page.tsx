"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox as InboxIcon, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import MarketplaceSafetyActions from "@/components/player/MarketplaceSafetyActions";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import InlineNotice from "@/components/ui/InlineNotice";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import playerUi from "@/components/player/PlayerUI.module.css";
import styles from "../Marketplace.module.css";

function Inbox() {
  const { locale, t } = useI18n();
  const params = useSearchParams(), messageId = params.get("message");
  const [messages, setMessages] = useState<Array<{ id: string; subject: string; message: string; reply_email: string; created_at: string }>>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setError(false); setBusy(true);
    try {
      const context = await resolveEffectivePlayerContext();
      const { data } = await supabase.auth.getSession();
      const query = new URLSearchParams();
      if (context.role === "parent") query.set("child_id", context.effectiveUserId);
      if (messageId) query.set("message", messageId);
      const response = await fetch(`/api/player/marketplace/messages?${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
      if (!response.ok) throw new Error();
      setMessages((await response.json()).messages);
    } catch { setError(true); } finally { setBusy(false); }
  }, [messageId]);
  useEffect(() => { void load(); }, [load]);
  return <div className="player-dashboard-bg player-marketplace-page"><div className={`app-shell marketplace-page ${styles.page} ${styles.secondaryPage}`}>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("nav.marketplace"), href: "/player/marketplace" }, { label: marketplaceSafetyText(locale, "messages") }]} />
    <div className="glass-section"><div className={`marketplace-header ${styles.header}`}>
      <div><h1 className={`section-title ${styles.title}`}>{marketplaceSafetyText(locale, "messages")}</h1>
        <p className="section-subtitle">{marketplaceSafetyText(locale, "messagesIntro")}</p></div>
      <Link className={playerUi.secondary} href="/player/marketplace"><ArrowLeft size={16} aria-hidden="true" />{t("common.back")}</Link>
    </div></div>
    {error && <InlineNotice variant="error" title={marketplaceSafetyText(locale, "error")} />}
    {busy ? <div className={playerUi.panel}><ListLoadingBlock label={t("common.loading")} /></div>
      : !error && !messages.length ? <div className={playerUi.panel}><div className={playerUi.empty}><InboxIcon size={20} aria-hidden="true" />{marketplaceSafetyText(locale, "noMessages")}</div></div>
      : <div className={styles.messageList}>{messages.map(row => <article className={`${playerUi.panel} ${styles.messageCard}`} key={row.id}>
          <header className={playerUi.panelHeader}><div><h2>{row.subject}</h2>
            <div className={styles.messageMeta}><span><Mail size={14} aria-hidden="true" />{row.reply_email}</span>
              <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleDateString(locale)}</time></div>
          </div></header>
          <p className={styles.messageBody}>{row.message}</p>
          <MarketplaceSafetyActions messageId={row.id} />
        </article>)}</div>}
  </div></div>;
}
export default function Page() { return <Suspense><Inbox /></Suspense>; }
