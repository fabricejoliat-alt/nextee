"use client";
import { useState } from "react";
import Link from "next/link";
export default function LegalRequestPage() {
  const [email, setEmail] = useState(""); const [kind, setKind] = useState("access"); const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); const response = await fetch("/api/legal/data-request", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, kind, description }) });
    setStatus(response.ok ? "Demande reçue. Une vérification de votre identité sera nécessaire avant toute action." : "Demande indisponible. Contactez l’assistance."); }
  return <main style={{ maxWidth: 700, margin: "auto", padding: "32px 20px 100px" }}><h1>Demande relative à mes données</h1>
    <p>Une demande de suppression est examinée avant toute suppression effective. Elle ne supprime pas immédiatement le compte ou les données.</p>
    <form onSubmit={submit}><label>Adresse e-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Type de demande<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="access">Accès</option><option value="rectification">Rectification</option><option value="erasure">Suppression</option><option value="other">Autre</option></select></label>
      <label>Précisions<textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label><button>Envoyer la demande</button></form>
    <p role="status">{status}</p><Link href="/legal">Documents juridiques</Link></main>;
}
