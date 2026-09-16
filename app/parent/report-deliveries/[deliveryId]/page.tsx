"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { PeriodicReportView, type PublishedReport } from "@/components/parent/PeriodicReportView";
import campStyles from "@/app/manager/camps/Camps.module.css";
import styles from "@/components/manager/ManagerPlayerStatistics.module.css";

export default function ParentPeriodicReportDeliveryPage({ params }: { params: Promise<{ deliveryId: string }> }) {
  const [deliveryId, setDeliveryId] = useState("");
  const [reports, setReports] = useState<PublishedReport[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void params.then((value) => setDeliveryId(value.deliveryId)); }, [params]);
  useEffect(() => { if (!deliveryId) return; void (async () => { const session = await supabase.auth.getSession(); const response = await fetch(`/api/parent/report-deliveries/${deliveryId}`, { headers: session.data.session?.access_token ? { Authorization: `Bearer ${session.data.session.access_token}` } : {}, cache: "no-store" }); const json = await response.json(); if (!response.ok) setError(json.error ?? "Rapport indisponible."); else setReports(json.reports ?? []); })(); }, [deliveryId]);
  if (error) return <main className="admin-page"><div className="admin-shell"><div className="card" role="alert">{error}</div></div></main>;
  if (!reports) return <main className="admin-page"><div className="admin-shell"><section className={campStyles.panel}><ListLoadingBlock label="Chargement des rapports…" /></section></div></main>;
  return <main className="admin-page"><div className="admin-shell"><div className={styles.stack}>{reports.map((report) => <PeriodicReportView key={report.id} report={report} compactHeading={reports.length > 1} />)}<p className={styles.caption}>Chaque section concerne uniquement le junior nommé. Aucune comparaison collective ni note interne n’est publiée.</p></div></div></main>;
}
