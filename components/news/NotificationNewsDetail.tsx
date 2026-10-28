"use client";

import { Suspense, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import styles from "./NotificationNewsDetail.module.css";

type Props = {
  news: Array<{ id: string; title: string; summary?: string | null; body: string; image_url?: string | null }>;
  loading: boolean;
  error?: string | null;
  homeHref: string;
};

/** Uses only the role API's authorized results, never a privileged lookup by ID. */
export function NotificationNewsDetailContent({ news, loading, error, homeHref }: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const { locale } = useI18n();
  const titleId = useId();
  const id = params.get("news_id");
  if (!id || loading || error) return null;
  const item = news.find(row => row.id === id);
  const tr = (fr: string, en: string, de: string, it: string) => pickLocaleText(locale, fr, en, de, it);
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("news_id");
    router.replace(`${homeHref}/news${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  return <AccessibleDialog onClose={close} labelledBy={titleId} className={styles.dialog}>
    <header className={styles.header}>
      <h2 id={titleId}>{item?.title ?? tr("Actualité indisponible", "News unavailable", "Nachricht nicht verfügbar", "Notizia non disponibile")}</h2>
      <button type="button" onClick={close} aria-label={tr("Fermer", "Close", "Schließen", "Chiudi")}><X size={20} /></button>
    </header>
    {item ? <article className={styles.body}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Same managed image as the news feed. */}
      {item.image_url ? <img src={item.image_url} alt="" /> : null}
      {item.summary ? <p>{item.summary}</p> : null}
      <div dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(item.body) }} />
    </article> : <div className={styles.body}><p role="status">{tr(
      "Cette actualité a été supprimée ou n’est plus accessible. Vous pouvez consulter les autres actualités.",
      "This news item was deleted or is no longer accessible. You can browse the other news.",
      "Diese Nachricht wurde gelöscht oder ist nicht mehr zugänglich. Sie können die anderen Nachrichten ansehen.",
      "Questa notizia è stata eliminata o non è più accessibile. Puoi consultare le altre notizie.",
    )}</p><button type="button" onClick={close}>{tr("Voir les actualités", "Browse news", "Nachrichten ansehen", "Vedi le notizie")}</button></div>}
  </AccessibleDialog>;
}

export default function NotificationNewsDetail(props: Props) {
  return <Suspense fallback={null}><NotificationNewsDetailContent {...props} /></Suspense>;
}
