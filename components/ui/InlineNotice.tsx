import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import styles from "./InlineNotice.module.css";

export default function InlineNotice({ title, children, variant = "warning", className = "" }: {
  title: string;
  children?: ReactNode;
  variant?: "warning" | "error" | "success" | "info";
  className?: string;
}) {
  const Icon = variant === "success" ? CheckCircle2 : variant === "info" ? Info : CircleAlert;
  return <div className={`${styles.notice} ${styles[variant]} ${className}`} role={variant === "error" ? "alert" : "status"}>
    <Icon size={19} aria-hidden="true" />
    <div className={styles.content}><strong>{title}</strong>{children}</div>
  </div>;
}
