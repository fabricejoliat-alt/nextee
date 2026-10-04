"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Doc = { id: string; document_key: string; kind: string; scope: string; club_id: string | null; audience_roles: string[]; eligible_role: string | null; action_kind: string; required: boolean;
  version: { id: string; version_number: number; published_at: string; snapshot: { translations?: Record<string, { title: string }> } } | null;
  state: { version_id: string; decision: string; conflict: boolean } | null };
type Presentation = { id: string; rendered_snapshot: { title: string; body: string; action_label: string; version_number: number; locale: string }; expires_at: string };
type Decision = { id: string; actor_id: string; beneficiary_id: string; decision: string; rendered_snapshot: { title: string; body: string; locale: string }; decided_at: string };
export default function MyLegalPage() {
  const [docs, setDocs] = useState<Doc[]>([]); const [history, setHistory] = useState<Decision[]>([]);
  const [childHistory, setChildHistory] = useState<Decision[]>([]);
  const [children, setChildren] = useState<Array<{ child_id: string; club_id: string }>>([]);
  const [subject, setSubject] = useState(""); const [locale, setLocale] = useState("fr"); const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [selected, setSelected] = useState<Doc | null>(null); const [code, setCode] = useState(""); const [status, setStatus] = useState("");
  const [pendingKey, setPendingKey] = useState(""); const [busy, setBusy] = useState(false);
  const api = useCallback(async (path: string, body?: object) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const response = await fetch(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Erreur"); return data;
  }, []);
  const refresh = useCallback(async () => {
    const [d, h, c] = await Promise.all([api("/api/legal/documents"), api("/api/legal/history"), api("/api/legal/children")]);
    setDocs(d.documents); setHistory(h.decisions); setChildren(c.children); setChildHistory([]);
  }, [api]);
  useEffect(() => { refresh().catch((e) => setStatus(String(e))); const onFocus = () => refresh().catch(() => {});
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); }; }, [refresh]);
  async function open(d: Doc, childId?: string) { setBusy(true); setStatus(""); setSelected(d); setPresentation(null); setCode(""); setPendingKey("");
    try { const result = await api("/api/legal/present", { document_id: d.id, beneficiary_id: childId || undefined,
      role: childId ? "parent" : d.eligible_role, locale }); setPresentation(result.presentation); setSubject(childId ?? "self"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }
  async function sendCode() { if (!presentation) return; setBusy(true); try { await api("/api/legal/parent-confirmation", { presentation_id: presentation.id });
    setStatus("Code envoyé à l’adresse vérifiée du parent."); } catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }
  async function decide(decision: string) { if (!presentation) return; setBusy(true); setStatus("");
    const key = pendingKey || crypto.randomUUID(); setPendingKey(key);
    try { await api("/api/legal/decide", { presentation_id: presentation.id, decision, idempotency_key: key, parent_code: code });
      setStatus("Décision enregistrée."); setPresentation(null); setPendingKey(""); await refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }
  function download(row: Decision) { const blob = new Blob([JSON.stringify(row, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `activitee-decision-${row.id}.json`;
    link.click(); URL.revokeObjectURL(url); }
  return <main style={{ maxWidth: 820, margin: "auto", padding: "32px 20px max(100px, env(safe-area-inset-bottom))" }}>
    <h1>Documents et consentements</h1><p>Chaque document indique l’action demandée. Une autorisation facultative peut être refusée sans bloquer les autres fonctions.</p>
    <label>Langue du document <select value={locale} onChange={(e) => { setLocale(e.target.value); setPresentation(null); }}>
      {["fr","en","de","it"].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
    {status && <p role="status">{status}</p>}
    {docs.map((d) => <section key={d.id} style={{ border: "1px solid #ced9d0", borderRadius: 12, padding: 18, marginTop: 16 }}>
      <h2>{d.version?.snapshot.translations?.[locale]?.title ?? d.document_key}</h2><p>Version {d.version?.version_number ?? "—"} · {d.scope} · {d.required ? "requis" : "facultatif"}</p>
      <p>État : {d.state?.version_id === d.version?.id ? d.state.decision : "validation requise"}{d.state?.conflict ? " · conflit à résoudre" : ""}</p>
      {d.kind !== "parent_authorization" && <button disabled={busy || !d.eligible_role} onClick={() => open(d)}>Lire et décider pour moi</button>}
      {d.kind === "parent_authorization" || d.kind === "specific_consent" ? children.filter((c) => d.scope === "platform" || c.club_id === d.club_id)
        .map((c) => <button key={`${d.id}-${c.child_id}-${c.club_id}`} disabled={busy} onClick={() => open(d, c.child_id)}>Pour l’enfant {c.child_id.slice(0, 8)}</button>) : null}
    </section>)}
    {presentation && <section role="dialog" aria-modal="true" aria-labelledby="legal-title" style={{ background: "white", border: "2px solid #294d39", borderRadius: 12, padding: 20, marginTop: 24 }}>
      <h2 id="legal-title">{presentation.rendered_snapshot.title}</h2><p>Version {presentation.rendered_snapshot.version_number} · {presentation.rendered_snapshot.locale.toUpperCase()}</p>
      <article style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{presentation.rendered_snapshot.body}</article>
      {subject !== "self" && <div><p>Cette décision concerne l’enfant {subject.slice(0, 8)}. Une confirmation indépendante est nécessaire.</p>
        <button disabled={busy} onClick={sendCode}>Envoyer un code</button><label>Code reçu <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label></div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
        <button disabled={busy} onClick={() => decide(({ accept: "accepted", acknowledge: "acknowledged", authorize: "authorized", consent: "consented", read: "acknowledged" } as Record<string,string>)[selected?.action_kind ?? "accept"])}>{presentation.rendered_snapshot.action_label}</button>
        <button disabled={busy} onClick={() => decide("refused")}>Refuser</button>
        {selected?.kind === "specific_consent" && <button disabled={busy} onClick={() => decide("withdrawn")}>Retirer mon consentement</button>}
        <button onClick={() => setPresentation(null)}>Fermer</button>
      </div></section>}
    <h2>Historique de mes décisions</h2>{history.map((row) => <details key={row.id} style={{ marginBottom: 12 }}><summary>{row.rendered_snapshot.title} · {row.decision} · {new Date(row.decided_at).toLocaleString()}</summary>
      <p>Acteur : {row.actor_id} · Bénéficiaire : {row.beneficiary_id} · langue : {row.rendered_snapshot.locale}</p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{row.rendered_snapshot.body}</pre><button onClick={() => download(row)}>Télécharger la preuve</button></details>)}
    {children.length > 0 && <section><h2>Décisions concernant mes enfants</h2>
      {children.map((child) => <button key={`${child.child_id}-${child.club_id}`} onClick={async () => { setChildHistory([]); try {
        const result = await api(`/api/legal/history?beneficiary_id=${encodeURIComponent(child.child_id)}&club_id=${encodeURIComponent(child.club_id)}`);
        setChildHistory(result.decisions); setStatus("");
      } catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } }}>
        Enfant {child.child_id.slice(0, 8)} · club {child.club_id.slice(0, 8)}
      </button>)}
      {childHistory.map((row) => <details key={row.id} style={{ marginTop: 12 }}><summary>{row.rendered_snapshot.title} · {row.decision} · {new Date(row.decided_at).toLocaleString()}</summary>
        <p>Acteur : {row.actor_id} · Bénéficiaire : {row.beneficiary_id}</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{row.rendered_snapshot.body}</pre><button onClick={() => download(row)}>Télécharger la preuve</button>
      </details>)}
    </section>}
    <p><Link href="/legal">Textes publics</Link> · <Link href="/legal/request">Demande relative à mes données</Link></p>
    <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/"); }}>
      Se déconnecter et revenir à l’accueil
    </button>
  </main>;
}
