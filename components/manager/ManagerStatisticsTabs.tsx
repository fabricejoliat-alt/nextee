"use client";

import { useRef, type KeyboardEvent } from "react";
import campStyles from "@/app/manager/camps/Camps.module.css";
import styles from "@/components/manager/ManagerStatisticsTabs.module.css";

type TabItem<T extends string> = { value: T; label: string };

export default function ManagerStatisticsTabs<T extends string>({ items, value, onChange, ariaLabel, mobileGrid = false }: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  mobileGrid?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.value);
    listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]?.focus();
  }

  return <section className={campStyles.panel}>
    <div ref={listRef} className={`${styles.tabs} ${mobileGrid ? styles.mobileGrid : ""}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={(event) => handleKeyDown(event, index)}>{item.label}</button>)}
    </div>
  </section>;
}
