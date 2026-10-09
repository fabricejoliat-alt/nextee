"use client";

import { adminFetch } from "@/lib/adminFetch";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Mail, Save } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ContactSettingsAdmin.module.css";

export default function ContactSettingsAdmin() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function accessToken() { return (await supabase.auth.getSession()).data.session?.access_token; }
  useEffect(() => {
    async function load() {
      try {
        const token = await accessToken();
        const response = await adminFetch("/api/admin/contact-settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Chargement impossible.");
        setEmail(data.contact_email);
        setLoaded(true);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
      finally { setLoading(false); }
    }
    void load();
  }, []);
  async function save(event: React.FormEvent) {
    if (!loaded) { event.preventDefault(); return; }
    event.preventDefault(); setSaving(true); setNotice(""); setError("");
    try {
      const token = await accessToken();
      const response = await adminFetch("/api/admin/contact-settings", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ contact_email: email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Enregistrement impossible.");
      setEmail(data.contact_email); setNotice("Adresse de contact enregistrée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true" /><span>Contact</span></nav>
    <header className={styles.heading}><span className={styles.eyebrow}>Plateforme</span><h1>Contact</h1><p>Adresse publique utilisée sur la page de contact d’ActiviTee.</p></header>
    <section className={styles.card} aria-labelledby="email-title"><div className={styles.cardHeading}><span className={styles.icon}><Mail size={19} aria-hidden="true" /></span><div><h2 id="email-title">Adresse e-mail de contact</h2><p>Les visiteurs pourront vous écrire à cette adresse depuis la page Contact.</p></div></div>
      {loading ? <p>Chargement…</p> : loaded && <form onSubmit={save} className={styles.form}><label htmlFor="platform-contact-email">Adresse e-mail</label><input id="platform-contact-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        <div className={styles.actions}><button type="submit" disabled={saving}><Save size={16} aria-hidden="true" /> {saving ? "Enregistrement…" : "Enregistrer"}</button><Link href="/contact">Voir la page de contact</Link></div></form>}
      {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
  </div>;
}
