import Link from "next/link";
import { ChevronRight } from "lucide-react";
import styles from "./PlayerBreadcrumb.module.css";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export default function PlayerBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} style={{ display: "contents" }}>
          {index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
          {item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}
