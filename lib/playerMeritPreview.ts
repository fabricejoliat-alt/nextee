export type MeritPreviewRow = {
  player_id: string;
  full_name: string;
  rank_net: number;
  rank_brut: number;
};

export function playerMeritPreview<T extends MeritPreviewRow>(rows: T[], playerId: string, mode: "net" | "brut"): T[] {
  const rank = mode === "net" ? "rank_net" : "rank_brut";
  const sorted = [...rows].sort((a, b) => a[rank] - b[rank] || a.full_name.localeCompare(b.full_name));
  const me = sorted.findIndex(row => row.player_id === playerId);
  if (me < 0) return sorted.slice(0, 4);
  const selected = new Set([0, me]);
  if (me > 0) selected.add(me - 1);
  if (me + 1 < sorted.length) selected.add(me + 1);
  // At either end of the ranking, fill remaining slots with the nearest players.
  for (let distance = 1; selected.size < Math.min(4, sorted.length); distance++) {
    for (const index of [me - distance, me + distance]) {
      if (index >= 0 && index < sorted.length && selected.size < 4) selected.add(index);
    }
  }
  return [...selected].sort((a, b) => a - b).map(index => sorted[index]);
}
