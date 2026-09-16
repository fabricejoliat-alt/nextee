"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import campStyles from "@/app/manager/camps/Camps.module.css";
import { PeriodicReportView, type PublishedReport } from "@/components/parent/PeriodicReportView";

export default function ParentPeriodicReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const [reportId, setReportId] = useState(""); const [report, setReport] = useState<PublishedReport | null>(null); const [error, setError] = useState("");
  useEffect(() => { void params.then((value) => setReportId(value.reportId)); }, [params]);
  useEffect(() => { if (!reportId) return; void (async () => { const session = await supabase.auth.getSession(); const response = await fetch(`/api/parent/reports/${reportId}`, { headers: session.data.session?.access_token ? { Authorization: `Bearer ${session.data.session.access_token}` } : {}, cache: "no-store" }); const json = await response.json(); if (!response.ok) setError(json.error ?? "Rapport indisponible."); else setReport(json.report); })(); }, [reportId]);
  if (error) return <main className="admin-page"><div className="admin-shell"><div className="card" role="alert">{error}</div></div></main>;
  if (!report) return <main className="admin-page"><div className="admin-shell"><section className={campStyles.panel}><ListLoadingBlock label="Chargement du rapport…" /></section></div></main>;
  return <main className="admin-page"><div className="admin-shell"><PeriodicReportView report={report} /><p>Ce rapport contient uniquement les informations autorisées pour l’espace parent. Les notes internes et comparaisons collectives en sont exclues.</p></div></main>;
}
