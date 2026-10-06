"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PublicSimpleHeader from "./PublicSimpleHeader";
import styles from "./GlobalHeaderBoundary.module.css";

export default function GlobalHeaderBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hasOwnHeader = pathname === "/" || pathname === "/contact"
    || /^\/(admin|coach|manager|parent|player|legal)(\/|$)/.test(pathname);
  if (hasOwnHeader) return children;
  return <><PublicSimpleHeader /><div className={styles.content}>{children}</div></>;
}
