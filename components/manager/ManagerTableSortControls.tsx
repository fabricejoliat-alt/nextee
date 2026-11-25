"use client";

import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { TableSort } from "@/lib/managerTableSort";
import { useManagerPerformanceLabels } from "./useManagerPerformanceLabels";
import tableStyles from "./PerformanceTables.module.css";

export type SortColumn<K extends string> = { key: K; label: string };

export function SortHeader<K extends string>({ column, sort, onSort }: { column: SortColumn<K>; sort: TableSort<K> | null; onSort: (key: K) => void }) {
  const { t } = useManagerPerformanceLabels();
  const active = sort?.key === column.key;
  const Icon = active ? sort.direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
    <button type="button" className={tableStyles.sortHeader} onClick={() => onSort(column.key)} title={t(active && sort.direction === "asc" ? "manager.performance.sortDescending" : "manager.performance.sortAscending")}>
      {column.label}<Icon size={14} aria-hidden="true" />
    </button>
  </th>;
}

export function TableSortControls<K extends string>({ columns, sort, onSort }: { columns: SortColumn<K>[]; sort: TableSort<K> | null; onSort: (key: K) => void }) {
  const { t } = useManagerPerformanceLabels();
  const Icon = sort?.direction === "desc" ? ArrowDown : ArrowUp;
  return <div className={tableStyles.mobileSort}>
    <label><span>{t("manager.performance.sortBy")}</span><select value={sort?.key ?? ""} onChange={event => onSort(event.target.value as K)}>
      <option value="" disabled>{t("manager.performance.initialOrder")}</option>{columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}
    </select></label>
    <button type="button" disabled={!sort} onClick={() => sort && onSort(sort.key)} aria-label={t(sort?.direction === "asc" ? "manager.performance.sortDescending" : "manager.performance.sortAscending")}>
      <Icon size={16} aria-hidden="true" />{t(sort?.direction === "desc" ? "manager.performance.descending" : "manager.performance.ascending")}
    </button>
  </div>;
}
