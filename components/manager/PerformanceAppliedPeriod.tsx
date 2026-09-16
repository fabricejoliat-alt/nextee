import styles from "@/components/manager/PerformanceAppliedPeriod.module.css";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Zurich" }).format(date);
}

export default function PerformanceAppliedPeriod({ from, to }: { from: string; to: string }) {
  return <p className={styles.period}><span>Période appliquée</span>{formatDate(from)} – {formatDate(to)}</p>;
}
