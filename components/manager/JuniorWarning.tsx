"use client";
import { TriangleAlert } from "lucide-react";
import styles from "./JuniorWarning.module.css";
export default function JuniorWarning({ label }: { label: string }) {
  return <span className={styles.warning} role="img" aria-label={label} title={label}><TriangleAlert size={15} aria-hidden="true" /></span>;
}
