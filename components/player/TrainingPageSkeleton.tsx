import styles from "./TrainingPageSkeleton.module.css";

export default function TrainingPageSkeleton({ variant, label }: { variant: "form" | "detail"; label: string }) {
  if (variant === "detail") {
    return (
      <div className={styles.detail} aria-live="polite" aria-busy="true" aria-label={label}>
        <div className={`${styles.card} ${styles.hero}`}><span /><div><i /><i /><i /></div></div>
        <div className={styles.kpis}>{Array.from({ length: 4 }, (_, index) => <div className={styles.card} key={index}><b /><i /><i /></div>)}</div>
        <div className={`${styles.card} ${styles.wide}`}><b /><i /><i /><i /></div>
        <div className={styles.columns}><div className={styles.card}><b /><i /><i /></div><div className={styles.card}><b /><i /><i /></div></div>
      </div>
    );
  }

  return (
    <div className={styles.form} aria-live="polite" aria-busy="true" aria-label={label}>
      <div className={`${styles.card} ${styles.formCard}`}><b /><i /><i /><i /><i /></div>
      <div className={`${styles.card} ${styles.formCard}`}><b /><i /><i /></div>
      <div className={`${styles.card} ${styles.formCard}`}><b /><i /><i /><i /></div>
      <div className={`${styles.card} ${styles.formCard}`}><b /><i /><i /></div>
    </div>
  );
}
