import Link from "next/link";
import styles from "./LegalPublic.module.css";

export default function LegalLoading() {
  return <main className={styles.page} aria-busy="true">
    <h1 className={styles.heading}>Chargement de votre espace</h1>
    <p className={styles.lead} role="status">Vos documents et vos données sont en cours de chargement…</p>
    <footer className={styles.footer}><Link href="/player/profile">Retour au profil</Link></footer>
  </main>;
}
