"use client";

/* eslint-disable @next/next/no-img-element -- Private media use temporary signed Storage URLs. */
import { useState } from "react";
import AccessibleDialog from "@/components/ui/AccessibleDialog";

import { CalendarDays, FileText, Image as ImageIcon, LockKeyhole, RefreshCw, Video, ArrowUpRight, X } from "lucide-react";
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
  const context = `${clubId}:${playerId}`;
  const [preview, setPreview] = useState<{ context: string; id: string; failed: boolean } | null>(null);
  const activeDocument = !loading && !error && preview?.context === context ? data?.documents.find(document => document.id === preview.id) : null;
  const previewKind = activeDocument?.mime_type?.startsWith("image/") ? "image"
    : activeDocument?.mime_type?.startsWith("video/") ? "video"
    : activeDocument?.mime_type?.startsWith("audio/") ? "audio"
    : activeDocument?.mime_type === "application/pdf" || activeDocument?.file_name.toLowerCase().endsWith(".pdf") ? "pdf" : null;
  const previewFailed = () => setPreview(previous => previous ? { ...previous, failed: true } : null);
  const size = (bytes: number | null) => bytes == null ? "" : new Intl.NumberFormat(managerLocaleTag(locale), { style: "unit", unit: bytes >= 1048576 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(bytes / (bytes >= 1048576 ? 1048576 : 1024));
  return <section className={campStyles.panel}>
    <div className={campStyles.panelHeader}><div><h2>{t("manager.junior.documents.title")}</h2><p>{t("manager.junior.documents.help")}</p></div><button type="button" className={styles.refresh} disabled={loading} onClick={() => { setPreview(null); reload(); }}><RefreshCw size={15} />{t("manager.refresh")}</button></div>
    {error ? <p className={styles.error} role="alert">{managerJuniorFeedback(t, error)}</p> : null}
    {loading ? <ListLoadingBlock label={t("manager.junior.documents.loading")} /> : data?.documents.length ? <div className={styles.grid}>{data.documents.map(document => {
      const Icon = document.mime_type?.startsWith("image/") ? ImageIcon : document.mime_type?.startsWith("video/") ? Video : FileText;
      return <article className={styles.document} key={document.id}>
        <span className={styles.icon}><Icon size={23} /></span>
        <div className={styles.content}><h3>{document.file_name}</h3><p>{[document.uploaded_by_name, managerJuniorDate(t, locale, document.created_at, false), size(document.size_bytes)].filter(Boolean).join(" · ")}</p>
          {document.event ? <span className={styles.event}><CalendarDays size={13} /><span>{document.event.title || t("coach.activity.other")} · {managerJuniorDate(t, locale, document.event.starts_at, false)}</span></span> : null}
          {document.coach_only ? <span className={styles.staff}><LockKeyhole size={12} />{t("manager.junior.documents.staffOnly")}</span> : null}
        </div>
        <button type="button" onClick={() => setPreview({ context, id: document.id, failed: false })} className={styles.open} aria-label={`${t("manager.junior.documents.open")} : ${document.file_name}`}>{t("manager.junior.documents.open")}</button>
      </article>;
    })}</div> : !error ? <div className={styles.empty}><FileText size={28} /><b>{t("manager.junior.documents.empty")}</b><p>{t("manager.junior.documents.emptyHelp")}</p></div> : null}
    {activeDocument ? <AccessibleDialog portal label={activeDocument.file_name} onClose={() => setPreview(null)} className={styles.viewer}>
      <header className={styles.viewerHeader}>
        <h2>{activeDocument.file_name}</h2>
        <div className={styles.viewerActions}>
          <a href={activeDocument.url} target="_blank" rel="noopener noreferrer" className={styles.viewerButton} aria-label={t("manager.junior.documents.openExternal")} title={t("manager.junior.documents.openExternal")}><ArrowUpRight size={20} /></a>
          <button type="button" onClick={() => setPreview(null)} className={styles.viewerButton} aria-label={t("common.close")} title={t("common.close")}><X size={20} /></button>
        </div>
      </header>
      <div className={styles.viewerBody}>
        {preview?.failed || !previewKind ? <div className={styles.previewFallback}><FileText size={32} /><p>{t("manager.junior.documents.previewUnavailable")}</p><a href={activeDocument.url} target="_blank" rel="noopener noreferrer" className={styles.open}>{t("manager.junior.documents.openExternal")}<ArrowUpRight size={15} /></a></div>
          : previewKind === "image" ? <img src={activeDocument.url} alt={activeDocument.file_name} className={styles.viewerImage} onError={previewFailed} />
          : previewKind === "video" ? <video src={activeDocument.url} controls playsInline preload="metadata" className={styles.viewerVideo} onError={previewFailed} />
          : previewKind === "audio" ? <audio src={activeDocument.url} controls preload="metadata" aria-label={activeDocument.file_name} onError={previewFailed} />
          : <iframe src={`${activeDocument.url}#view=FitH`} title={activeDocument.file_name} className={styles.viewerFrame} onError={previewFailed} />}
      </div>
    </AccessibleDialog> : null}
  </section>;
}
