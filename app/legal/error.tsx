"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full reload is the recovery action for a failed route. */
import styles from "./LegalPublic.module.css";

export default function LegalError({ reset }: { reset: () => void }) {
  return <main className={styles.page}>
    <h1 className={styles.heading}>Votre espace n’a pas pu se charger</h1>
    <p className={styles.lead} role="alert">Réessayez pour retrouver vos documents et vos données.</p>
    <button type="button" className={styles.primary} onClick={reset}>Réessayer</button>
    <footer className={styles.footer}><a href="/legal/my">Recharger mes documents</a><a href="/player/profile">Retour au profil</a></footer>
  </main>;
}
