"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserRound, UserRoundCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { marketplaceSafetyRequest } from "@/components/player/MarketplaceSafetyActions";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import InlineNotice from "@/components/ui/InlineNotice";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import playerUi from "@/components/player/PlayerUI.module.css";
import styles from "../Marketplace.module.css";

export default function MarketplaceBlockedPage() {
  const { locale, t } = useI18n();
  const [blocks, setBlocks] = useState<Array<{ blocked_id: string; created_at: string; name: string }>>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setError(false); setBusy(true);
    try {
      const context = await resolveEffectivePlayerContext();
      const { data } = await supabase.auth.getSession();
      const query = new URLSearchParams();
      if (context.role === "parent") query.set("child_id", context.effectiveUserId);
      const response = await fetch(`/api/player/marketplace/safety?${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
      if (!response.ok) throw new Error();
      setBlocks((await response.json()).blocks);
    } catch { setError(true); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function unblock(id: string) {
    if (busy) return;
    setBusy(true); setError(false);
    try { await marketplaceSafetyRequest({ action: "unblock", user_id: id }); await load(); }
    catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="player-dashboard-bg player-marketplace-page"><div className={`app-shell marketplace-page ${styles.page} ${styles.secondaryPage}`}>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("nav.marketplace"), href: "/player/marketplace" }, { label: marketplaceSafetyText(locale, "blockedUsers") }]} />
    <div className="glass-section"><div className={`marketplace-header ${styles.header}`}>
      <div><h1 className={`section-title ${styles.title}`}>{marketplaceSafetyText(locale, "blockedUsers")}</h1>
        <p className="section-subtitle">{marketplaceSafetyText(locale, "blocksIntro")}</p></div>
      <Link className={playerUi.secondary} href="/player/marketplace"><ArrowLeft size={16} aria-hidden="true" />{t("common.back")}</Link>
    </div></div>
    <section className={playerUi.panel} aria-label={marketplaceSafetyText(locale, "blockedUsers")}>
      {error && <InlineNotice variant="error" title={marketplaceSafetyText(locale, "error")} />}
      {busy && !blocks.length ? <ListLoadingBlock label={t("common.loading")} /> : <>
        {!error && !blocks.length && <div className={playerUi.empty}><ShieldCheck size={20} aria-hidden="true" />{marketplaceSafetyText(locale, "noBlocks")}</div>}
        {blocks.length > 0 && <div className={styles.memberList}>{blocks.map((row, index) => <article className={styles.blockedRow} key={row.blocked_id}>
          <div className={styles.memberIdentity}><span className={styles.memberIcon}><UserRound size={20} aria-hidden="true" /></span>
            <div><h2>{row.name || `${t("common.defaultName")} ${index + 1}`}</h2>
              <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleDateString(locale)}</time></div>
          </div>
          <button type="button" className={playerUi.secondary} onClick={() => void unblock(row.blocked_id)} disabled={busy}>
            <UserRoundCheck size={16} aria-hidden="true" />{marketplaceSafetyText(locale, "unblock")}
          </button>
        </article>)}</div>}
      </>}
    </section>
  </div></div>;
}
