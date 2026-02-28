"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { Search } from "lucide-react";

type ClubRow = {
  id: string;
  name: string | null;
};

type ClubMemberRow = {
  club_id: string;
  user_id: string;
  role: string | null;
  is_active: boolean | null;
};

type PlayerProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  handicap: number | null;
  sex: string | null;
};

type PlayerListItem = PlayerProfileRow & {
  club_ids: string[];
  club_names: string[];
};

function fullName(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

function initials(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return fi + li || "👤";
}

function sexLabel(v: string | null | undefined, fr = true) {
  if (v === "male") return fr ? "Homme" : "Male";
  if (v === "female") return fr ? "Femme" : "Female";
  if (v === "other") return fr ? "Autre" : "Other";
  return fr ? "Non défini" : "Not set";
}

export default function CoachPlayersPage() {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [players, setPlayers] = useState<PlayerListItem[]>([]);
  const [clubs, setClubs] = useState<ClubRow[]>([]);

  const [query, setQuery] = useState("");
  const [sexFilter, setSexFilter] = useState<"all" | "male" | "female" | "other" | "none">("all");
  const [clubFilter, setClubFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: authRes, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authRes.user) throw new Error("Session invalide.");
        const uid = authRes.user.id;

        const myMembershipsRes = await supabase
          .from("club_members")
          .select("club_id,user_id,role,is_active")
          .eq("user_id", uid)
          .eq("is_active", true);
        if (myMembershipsRes.error) throw new Error(myMembershipsRes.error.message);

        const myClubIds = Array.from(
          new Set(
            ((myMembershipsRes.data ?? []) as ClubMemberRow[])
              .filter((m) => Boolean(m.club_id))
              .map((m) => m.club_id)
          )
        );

        if (myClubIds.length === 0) {
          setPlayers([]);
          setClubs([]);
          setLoading(false);
          return;
        }

        const clubsRes = await supabase.from("clubs").select("id,name").in("id", myClubIds);
        if (clubsRes.error) throw new Error(clubsRes.error.message);
        const clubsList = ((clubsRes.data ?? []) as ClubRow[]).sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "", "fr")
        );
        setClubs(clubsList);
        const clubNameById = new Map(clubsList.map((c) => [c.id, c.name ?? "Club"]));

        const playerMembersRes = await supabase
          .from("club_members")
          .select("club_id,user_id,role,is_active")
          .in("club_id", myClubIds)
          .eq("role", "player")
          .eq("is_active", true);
        if (playerMembersRes.error) throw new Error(playerMembersRes.error.message);

        const rows = (playerMembersRes.data ?? []) as ClubMemberRow[];
        const playerIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));

        if (playerIds.length === 0) {
          setPlayers([]);
          setLoading(false);
          return;
        }

        const profilesRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url,handicap,sex")
          .in("id", playerIds);
        if (profilesRes.error) throw new Error(profilesRes.error.message);
        const profileRows = (profilesRes.data ?? []) as PlayerProfileRow[];
        const byProfileId = new Map(profileRows.map((p) => [p.id, p]));

        const clubsByPlayer = new Map<string, Set<string>>();
        rows.forEach((r) => {
          if (!clubsByPlayer.has(r.user_id)) clubsByPlayer.set(r.user_id, new Set());
          clubsByPlayer.get(r.user_id)!.add(r.club_id);
        });

        const list: PlayerListItem[] = playerIds
          .map((id) => {
            const p = byProfileId.get(id);
            if (!p) return null;
            const clubIds = Array.from(clubsByPlayer.get(id) ?? []);
            const clubNames = clubIds.map((cid) => clubNameById.get(cid) ?? "Club");
            return { ...p, club_ids: clubIds, club_names: clubNames };
          })
          .filter((x): x is PlayerListItem => Boolean(x))
          .sort((a, b) => {
            const la = (a.last_name ?? "").toLocaleLowerCase("fr-CH");
            const lb = (b.last_name ?? "").toLocaleLowerCase("fr-CH");
            if (la !== lb) return la.localeCompare(lb, "fr-CH");
            const fa = (a.first_name ?? "").toLocaleLowerCase("fr-CH");
            const fb = (b.first_name ?? "").toLocaleLowerCase("fr-CH");
            return fa.localeCompare(fb, "fr-CH");
          });

        setPlayers(list);
        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? tr("Erreur chargement.", "Loading error."));
        setPlayers([]);
        setClubs([]);
        setLoading(false);
      }
    })();
  }, [locale]);

  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (clubFilter !== "all" && !p.club_ids.includes(clubFilter)) return false;

      if (sexFilter === "male" && p.sex !== "male") return false;
      if (sexFilter === "female" && p.sex !== "female") return false;
      if (sexFilter === "other" && p.sex !== "other") return false;
      if (sexFilter === "none" && !!p.sex) return false;

      if (!q) return true;
      const name = fullName(p).toLowerCase();
      const clubText = p.club_names.join(" ").toLowerCase();
      return name.includes(q) || clubText.includes(q);
    });
  }, [players, query, sexFilter, clubFilter]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {tr("Joueurs", "Players")}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                {tr("Liste des joueurs du club", "List of club players")}
              </div>
            </div>
            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/manager">
                {t("common.back")}
              </Link>
            </div>
          </div>
          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
              <Search size={16} />
              {tr("Filtrer les joueurs", "Filter players")}
            </div>

            <div className="grid-2">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{tr("Nom", "Name")}</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("Rechercher nom/prénom…", "Search first/last name...")}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{tr("Sexe", "Sex")}</span>
                <select value={sexFilter} onChange={(e) => setSexFilter(e.target.value as any)}>
                  <option value="all">{tr("Tous", "All")}</option>
                  <option value="male">{tr("Homme", "Male")}</option>
                  <option value="female">{tr("Femme", "Female")}</option>
                  <option value="other">{tr("Autre", "Other")}</option>
                  <option value="none">{tr("Non défini", "Not set")}</option>
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={fieldLabelStyle}>{tr("Club", "Club")}</span>
              <select value={clubFilter} onChange={(e) => setClubFilter(e.target.value)}>
                <option value="all">{tr("Tous les clubs", "All clubs")}</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "Club"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : filteredPlayers.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                {tr("Aucun joueur trouvé.", "No player found.")}
              </div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {filteredPlayers.map((p) => (
                  <Link
                    key={p.id}
                    href={`/manager/players/${p.id}?returnTo=${encodeURIComponent("/manager/players")}`}
                    className="marketplace-link"
                  >
                    <div className="marketplace-item">
                      <div className="marketplace-row" style={{ gridTemplateColumns: "56px 1fr", alignItems: "center" }}>
                        <div style={avatarBoxStyle}>
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            initials(p)
                          )}
                        </div>

                        <div className="marketplace-body">
                          <div className="marketplace-item-title">{fullName(p)}</div>
                          <div className="marketplace-meta">
                            {tr("Sexe", "Sex")}: {sexLabel(p.sex, locale !== "en")} • Handicap{" "}
                            {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                          </div>
                          <div className="marketplace-meta">{p.club_names.join(" • ") || "Club"}</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

const avatarBoxStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 16,
  overflow: "hidden",
  background: "rgba(255,255,255,0.75)",
  border: "1px solid rgba(0,0,0,0.10)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  color: "var(--green-dark)",
  flexShrink: 0,
};
