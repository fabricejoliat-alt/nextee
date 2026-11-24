"use client";

import { CalendarDays, FileText, Image as ImageIcon, LockKeyhole, RefreshCw, Video, ArrowUpRight } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerJuniorDate, managerJuniorFeedback } from "@/lib/managerJuniorPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import { useManagerResource } from "./useManagerResource";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import campStyles from "@/app/manager/camps/Camps.module.css";
import styles from "./ManagerPlayerDocuments.module.css";

type Document = { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; created_at: string; coach_only: boolean; uploaded_by_name: string | null; event: { title: string | null; starts_at: string } | null; url: string; url_expires_at: string };

export default function ManagerPlayerDocuments({ clubId, playerId }: { clubId: string; playerId: string }) {
  const { t, locale } = useI18n();
  const { data, loading, error, reload } = useManagerResource<{ documents: Document[] }>(`/api/manager/clubs/${clubId}/players/${playerId}/documents`, t("manager.junior.documents.loadError"));
  const size = (bytes: number | null) => bytes == null ? "" : new Intl.NumberFormat(managerLocaleTag(locale), { style: "unit", unit: bytes >= 1048576 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(bytes / (bytes >= 1048576 ? 1048576 : 1024));
  return <section className={campStyles.panel}>
    <div className={campStyles.panelHeader}><div><h2>{t("manager.junior.documents.title")}</h2><p>{t("manager.junior.documents.help")}</p></div><button type="button" className={styles.refresh} disabled={loading} onClick={reload}><RefreshCw size={15} />{t("manager.refresh")}</button></div>
    {error ? <p className={styles.error} role="alert">{managerJuniorFeedback(t, error)}</p> : null}
    {loading ? <ListLoadingBlock label={t("manager.junior.documents.loading")} /> : data?.documents.length ? <div className={styles.grid}>{data.documents.map(document => {
      const Icon = document.mime_type?.startsWith("image/") ? ImageIcon : document.mime_type?.startsWith("video/") ? Video : FileText;
      return <article className={styles.document} key={document.id}>
        <span className={styles.icon}><Icon size={23} /></span>
        <div className={styles.content}><h3>{document.file_name}</h3><p>{[document.uploaded_by_name, managerJuniorDate(t, locale, document.created_at, false), size(document.size_bytes)].filter(Boolean).join(" · ")}</p>
          {document.event ? <span className={styles.event}><CalendarDays size={13} /><span>{document.event.title || t("coach.activity.other")} · {managerJuniorDate(t, locale, document.event.starts_at, false)}</span></span> : null}
          {document.coach_only ? <span className={styles.staff}><LockKeyhole size={12} />{t("manager.junior.documents.staffOnly")}</span> : null}
        </div>
        <a href={document.url} target="_blank" rel="noopener noreferrer" className={styles.open} aria-label={`${t("manager.junior.documents.open")} : ${document.file_name}`}>{t("manager.junior.documents.open")}<ArrowUpRight size={15} /></a>
      </article>;
    })}</div> : !error ? <div className={styles.empty}><FileText size={28} /><b>{t("manager.junior.documents.empty")}</b><p>{t("manager.junior.documents.emptyHelp")}</p></div> : null}
  </section>;
}
