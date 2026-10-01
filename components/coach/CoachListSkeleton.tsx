import styles from "./CoachListSkeleton.module.css";

export default function CoachListSkeleton({ label }: { label: string }) {
  return <div className={styles.list} role="status" aria-label={label} aria-busy="true">
    {[0, 1, 2].map((row) => <div className={styles.card} aria-hidden="true" key={row}><i/><div><span/><span/><span/></div></div>)}
  </div>;
}
