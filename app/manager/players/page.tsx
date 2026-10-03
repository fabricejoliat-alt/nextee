"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useManagerResource } from "@/components/manager/useManagerResource";
import { managerFormat, managerLocaleTag } from "@/lib/managerLocale";

type Club = { id: string; name: string | null };
type Player = {
  id: string; first_name: string | null; last_name: string | null;
  avatar_url: string | null; handicap: number | null; sex: string | null;
  club_ids: string[]; club_names: string[];
};
type Directory = { clubs: Club[]; players: Player[] };
type SexFilter = "all" | "male" | "female" | "other" | "none";

function fullName(player: Player) {
  return [player.first_name?.trim(), player.last_name?.trim()].filter(Boolean).join(" ") || "—";
}
function initials(player: Player) {
  return [player.first_name?.trim().charAt(0), player.last_name?.trim().charAt(0)].filter(Boolean).join("").toUpperCase() || "👤";
}

export default function ManagerPlayersPage() {
  const { locale, t } = useI18n();
  const tr = (key: string) => t(`manager.legacyPlayers.${key}`);
  const directory = useManagerResource<Directory>("/api/manager/players/directory", "directory_load_failed");
  const [query, setQuery] = useState("");
  const [sexFilter, setSexFilter] = useState<SexFilter>("all");
  const [clubFilter, setClubFilter] = useState("all");
  const ready = !directory.loading && !directory.error && Array.isArray(directory.data?.clubs) && Array.isArray(directory.data?.players);
  const clubs = ready ? directory.data!.clubs : [];
  const selectedClub = clubFilter === "all" || clubs.some((club) => club.id === clubFilter) ? clubFilter : "all";
  const rows = useMemo(() => {
    const players = ready ? directory.data!.players : [];
    const term = query.trim().toLocaleLowerCase(managerLocaleTag(locale));
    return players.filter((player) => {
      if (selectedClub !== "all" && !player.club_ids.includes(selectedClub)) return false;
      if (sexFilter === "none" && player.sex) return false;
      if (sexFilter !== "all" && sexFilter !== "none" && player.sex !== sexFilter) return false;
      const haystack = `${fullName(player)} ${player.club_names.join(" ")}`.toLocaleLowerCase(managerLocaleTag(locale));
      return !term || haystack.includes(term);
    }).sort((a, b) => (a.last_name ?? "").localeCompare(b.last_name ?? "", managerLocaleTag(locale)) || (a.first_name ?? "").localeCompare(b.first_name ?? "", managerLocaleTag(locale)));
  }, [directory.data, ready, query, selectedClub, sexFilter, locale]);
  const sexLabel = (value: string | null) => tr(value === "male" || value === "female" || value === "other" ? value : "notSet");
  return <div className="player-dashboard-bg"><div className="app-shell marketplace-page">
    <div className="glass-section"><div className="marketplace-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 6 }}><h1 className="section-title" style={{ marginBottom: 0 }}>{tr("title")}</h1><p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>{tr("lead")}</p></div>
      <div className="marketplace-actions" style={{ marginTop: 2, width: "auto", flexWrap: "wrap" }}><button type="button" className="cta-green cta-green-inline" style={{ flex: "0 0 auto" }} disabled={directory.loading} onClick={directory.reload}>{tr("refresh")}</button><Link className="cta-green cta-green-inline" style={{ flex: "0 0 auto" }} href="/manager">{t("common.back")}</Link></div>
    </div>{directory.error ? <div role="alert" className="marketplace-error">{tr("loadError")}</div> : null}</div>
    <div className="glass-section"><div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}><Search size={16}/>{tr("filter")}</div>
      <div className="grid-2">
        <label style={{ display: "grid", gap: 6 }}><span style={fieldLabelStyle}>{tr("name")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("search")}/></label>
        <label style={{ display: "grid", gap: 6 }}><span style={fieldLabelStyle}>{tr("sex")}</span><select value={sexFilter} onChange={(event) => setSexFilter(event.target.value as SexFilter)}>{(["all","male","female","other","none"] as const).map((value) => <option key={value} value={value}>{tr(value === "none" ? "notSet" : value)}</option>)}</select></label>
      </div>
      <label style={{ display: "grid", gap: 6 }}><span style={fieldLabelStyle}>{tr("club")}</span><select value={selectedClub} disabled={!ready} onChange={(event) => setClubFilter(event.target.value)}><option value="all">{tr("allClubs")}</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? tr("club")}</option>)}</select></label>
    </div></div>
    <div className="glass-section"><div className="glass-card">
      {directory.loading ? <ListLoadingBlock label={t("common.loading")}/>
      : !ready ? null
      : !clubs.length ? <div className="marketplace-empty">{tr("noClubs")}</div>
      : !rows.length ? <div className="marketplace-empty">{tr("empty")}</div>
      : <div className="marketplace-list marketplace-list-top">{rows.map((player) => {
        const name = fullName(player);
        return <Link key={player.id} href={`/manager/players/${player.id}?returnTo=${encodeURIComponent("/manager/players")}`} className="marketplace-link" aria-label={managerFormat(t,"manager.legacyPlayers.open",{name})}>
          <div className="marketplace-item"><div className="marketplace-row" style={{ gridTemplateColumns: "56px 1fr", alignItems: "center" }}>
            <div style={avatarBoxStyle}>{player.avatar_url ? <img src={player.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : initials(player)}</div>
            <div className="marketplace-body"><div className="marketplace-item-title">{name}</div><div className="marketplace-meta">{tr("sex")}: {sexLabel(player.sex)} • {tr("handicap")} {typeof player.handicap === "number" ? new Intl.NumberFormat(managerLocaleTag(locale),{minimumFractionDigits:1,maximumFractionDigits:1}).format(player.handicap) : "—"}</div><div className="marketplace-meta">{player.club_names.join(" • ") || tr("club")}</div></div>
          </div></div>
        </Link>;
      })}</div>}
    </div></div>
  </div></div>;
}

const fieldLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" };
const avatarBoxStyle: React.CSSProperties = { width: 56, height: 56, borderRadius: 16, overflow: "hidden", background: "rgba(255,255,255,0.75)", border: "1px solid rgba(0,0,0,0.10)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, color: "var(--green-dark)", flexShrink: 0 };
