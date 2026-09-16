"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, Languages, RefreshCw, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { messages } from "@/lib/i18n/messages";
import styles from "./AdminHomeStats.module.css";

type Stats = { organizations: number; managers: number; missingTranslations: number };

export default function AdminHomeStats() {
  const [stats, setStats] = useState<Stats>({ organizations: 0, managers: 0, missingTranslations: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStats() {
    setLoading(true); setError(null);
    try {
      const [organizations, managers, translations] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("app_role", "manager"),
        supabase.from("app_translations").select("key", { count: "exact", head: true }).in("locale", ["en", "de", "it"]),
      ]);
      if (organizations.error) throw new Error(organizations.error.message);
      if (managers.error) throw new Error(managers.error.message);
      const referenceTranslationCount = Object.keys(messages.fr).length * 3;
      const savedTranslations = translations.error ? 0 : translations.count ?? 0;
      setStats({ organizations: organizations.count ?? 0, managers: managers.count ?? 0, missingTranslations: Math.max(0, referenceTranslationCount - savedTranslations) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de chargement"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadStats(); }, []);

  const cards = [
    { label: "Organisations", value: stats.organizations, detail: "Espaces administrés", icon: Building2, href: "/admin/organizations", action: "Gérer les organisations" },
    { label: "Managers", value: stats.managers, detail: "Accès de gestion actifs", icon: Users, href: "/admin/users", action: "Gérer les managers" },
    { label: "Traductions manquantes", value: stats.missingTranslations, detail: "EN, DE et IT à compléter", icon: Languages, href: "/admin/translations", action: "Compléter les traductions" },
  ];

  return <div className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ display: "flex", alignItems: "center", minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>Administration</nav>
    <div className={styles.topline}><div><h1>Bonjour</h1><p className={styles.lead}>Une vue d’ensemble de votre plateforme ActiviTee.</p></div><button type="button" className={styles.refreshButton} onClick={() => void loadStats()} disabled={loading}><RefreshCw size={16} className={loading ? styles.spin : undefined}/>{loading ? "Actualisation…" : "Actualiser"}</button></div>
    {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}
    <section className={styles.overview}><div className={styles.sectionHeading}><div><h2>Vue d’ensemble</h2><p>Les éléments essentiels à suivre.</p></div></div><div className={styles.statsGrid}>{cards.map((card) => { const Icon = card.icon; return <article className={styles.statCard} key={card.label}><div className={styles.statTop}><span className={styles.statIcon}><Icon size={20}/></span><Link href={card.href} aria-label={card.action}><ChevronRight size={18}/></Link></div><span>{card.label}</span><b>{loading ? "—" : card.value}</b><small>{card.detail}</small></article>; })}</div></section>
    <section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>Raccourcis</h2><p>Accédez rapidement aux principales tâches d’administration.</p></div></div><div className={styles.quickGrid}>{cards.map((card) => { const Icon = card.icon; return <Link key={card.href} href={card.href} className={styles.quickLink}><span><Icon size={18}/></span><div><b>{card.action}</b><small>{card.detail}</small></div><ChevronRight size={17}/></Link>})}</div></section>
  </div>;
}
