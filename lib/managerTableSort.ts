export type TableSort<K extends string> = { key: K; direction: "asc" | "desc" };
export type TableSortValue = string | number | null | undefined;

export function toggleTableSort<K extends string>(current: TableSort<K> | null, key: K): TableSort<K> {
  return { key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" };
}

/** Sort real values, preserve ties, and keep missing values last in either direction. */
export function sortManagerTable<T, K extends string>(rows: readonly T[], sort: TableSort<K> | null, value: (row: T, key: K) => TableSortValue, locale: string): T[] {
  if (!sort) return [...rows];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const missing = (entry: TableSortValue) => entry == null || entry === "" || typeof entry === "number" && !Number.isFinite(entry);
  return rows.map((row, index) => ({ row, index, value: value(row, sort.key) })).sort((a, b) => {
    const aMissing = missing(a.value), bMissing = missing(b.value);
    if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
    const comparison = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : collator.compare(String(a.value), String(b.value));
    return comparison === 0 ? a.index - b.index : comparison * (sort.direction === "asc" ? 1 : -1);
  }).map(entry => entry.row);
}
