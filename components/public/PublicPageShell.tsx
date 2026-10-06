import type { ReactNode } from "react";
import PublicSimpleHeader from "./PublicSimpleHeader";
import styles from "./PublicPageShell.module.css";

export default function PublicPageShell({ children }: { children: ReactNode }) {
  return <div className={styles.root}><PublicSimpleHeader /><div className={styles.content}>{children}</div></div>;
}
