import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/app/manager/camps/Camps.module.css";

export default function ManagerLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Chargement de l’espace Manager">
      <div className={styles.breadcrumb}><span>Manager</span></div>
      <div className={styles.topline}>
        <div><h1>Manager</h1><p className={styles.lead}>Chargement de l’espace de gestion…</p></div>
      </div>
      <section className={styles.panel}><ListLoadingBlock label="Chargement des données…" /></section>
    </div>
  );
}
