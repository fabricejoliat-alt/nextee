"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, Menu } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./PublicSimpleHeader.module.css";

export default function PublicSimpleHeader() {
  const [signedIn, setSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [homeHref, setHomeHref] = useState("/player");
  useEffect(() => {
    async function refresh(userId?: string) {
      setSignedIn(Boolean(userId));
      if (userId) {
        const { data: profile } = await supabase.from("profiles").select("app_role").eq("id", userId).maybeSingle();
        setHomeHref(profile?.app_role === "coach" ? "/coach" : profile?.app_role === "manager" ? "/manager" : "/player");
      } else setMenuOpen(false);
    }
    void supabase.auth.getSession().then(({ data }) => refresh(data.session?.user.id));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { void refresh(session?.user.id); });
    return () => subscription.unsubscribe();
  }, []);
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-grid app-header-grid--centered">
          <div className="header-left header-left--icon">
            {signedIn ? <button type="button" className="icon-btn" aria-label="Ouvrir le menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Menu size={22} /></button> : null}
            {menuOpen ? <nav className={styles.menu} aria-label="Menu"><Link href={homeHref} onClick={() => setMenuOpen(false)}>Retour à mon espace</Link><Link href="/legal/my" onClick={() => setMenuOpen(false)}>Mes documents</Link><Link href="/legal" onClick={() => setMenuOpen(false)}>Documents juridiques</Link></nav> : null}
          </div>
          <div className="header-center header-center--brand">
            <Link href="/" className="brand" aria-label="ActiviTee - Accueil">
              <span className="brand-nex">Activi</span>
              <span className="brand-tee">Tee</span>
            </Link>
          </div>
          <div className="header-right header-right--icon">
            {signedIn && <Link href="/legal/my" className={styles.navLink} aria-label="Mes documents"><FileText size={17} aria-hidden="true" /><span>Mes documents</span></Link>}
          </div>
        </div>
      </div>
    </header>
  );
}
