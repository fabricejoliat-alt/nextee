"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./PublicSimpleHeader.module.css";

export default function PublicSimpleHeader() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => subscription.unsubscribe();
  }, []);
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-grid app-header-grid--centered">
          <div className="header-left header-left--icon" aria-hidden="true" />
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
