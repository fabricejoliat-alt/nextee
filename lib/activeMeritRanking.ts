export type MeritRanking = { player_id: string; rank_net: number; rank_brut: number };
/** Preserve the business ordering (including ties), then close ranks after exclusions. */
export function activeMeritRanking<T extends MeritRanking>(rows: T[], allowed: Set<string>): T[] {
  const active = rows.filter(row => allowed.has(row.player_id));
  const net = [...active].sort((a,b) => a.rank_net-b.rank_net);
  const gross = [...active].sort((a,b) => a.rank_brut-b.rank_brut);
  const ranks = (sorted: T[], key: "rank_net"|"rank_brut") => {
    let rank=0; let previous:number|undefined;
    return new Map(sorted.map(row => { if(previous!==row[key])rank++;previous=row[key];return [row.player_id,rank]; }));
  };
  const netRanks=ranks(net,"rank_net"), grossRanks=ranks(gross,"rank_brut");
  return net.map(row => ({ ...row, rank_net:netRanks.get(row.player_id)!, rank_brut:grossRanks.get(row.player_id)! }));
}
