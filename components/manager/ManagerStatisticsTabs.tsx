"use client";

import { useRef, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import campStyles from "@/app/manager/camps/Camps.module.css";
import styles from "@/components/manager/ManagerStatisticsTabs.module.css";

type TabItem<T extends string> = { value: T; label: string };

export default function ManagerStatisticsTabs<T extends string>({ items, value, onChange, ariaLabel, mobileGrid = false, mobileSelect = false }: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  mobileGrid?: boolean;
  mobileSelect?: boolean;
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
    {mobileSelect ? <div className={styles.mobileSelect}><select aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value as T)}>{items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={20} aria-hidden="true" /></div> : null}
    <div ref={listRef} className={`${styles.tabs} ${mobileGrid ? styles.mobileGrid : ""} ${mobileSelect ? styles.desktopTabs : ""}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={(event) => handleKeyDown(event, index)}>{item.label}</button>)}
    </div>
  </section>;
}
