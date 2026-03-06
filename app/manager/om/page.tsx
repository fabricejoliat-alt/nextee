"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Trash2, Plus, Trophy, ListChecks } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type ManagedOrg = { id: string; name: string };
type ExceptionalTournament = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
};
type OMRankingRow = {
  player_id: string;
  full_name: string;
  tournament_points_net: number | string;
  bonus_points_net: number | string;
  total_points_net: number | string;
  rank_net: number;
  tournament_points_brut: number | string;
  bonus_points_brut: number | string;
  total_points_brut: number | string;
  rank_brut: number;
  period_slot: number;
  period_limit: number;
};
type ProfileAvatarRow = {
  id: string;
  avatar_url: string | null;
};
type GroupLite = { id: string; name: string | null; is_active: boolean | null };
type InternalContest = {
  id: string;
  organization_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  contest_date: string;
  updated_at: string;
};

function labelByLocale(locale: string, fr: string, en: string, de: string, it: string) {
  if (locale === "fr") return fr;
  if (locale === "de") return de;
  if (locale === "it") return it;
  return en;
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export default function ManagerOrderOfMeritPage() {
  const { locale } = useI18n();
  const todayInZurich = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()), []);
  const yearStartInZurich = useMemo(() => `${todayInZurich.slice(0, 4)}-01-01`, [todayInZurich]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<ManagedOrg[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [rows, setRows] = useState<ExceptionalTournament[]>([]);
  const [rankingRows, setRankingRows] = useState<OMRankingRow[]>([]);
  const [avatarByPlayerId, setAvatarByPlayerId] = useState<Record<string, string | null>>({});
  const [rankingMode, setRankingMode] = useState<"net" | "brut">("net");
  const [rankingFrom, setRankingFrom] = useState(yearStartInZurich);
  const [rankingTo, setRankingTo] = useState(todayInZurich);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [contests, setContests] = useState<InternalContest[]>([]);
  const [contestTitle, setContestTitle] = useState("");
  const [contestDescription, setContestDescription] = useState("");
  const [contestDate, setContestDate] = useState(todayInZurich);
  const [contestGroupId, setContestGroupId] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  const txt = useMemo(
    () => ({
      title: labelByLocale(locale, "Ordre du mérite", "Order of Merit", "Order of Merit", "Ordine di merito"),
      subtitle: labelByLocale(
        locale,
        "Gestion des tournois exceptionnels",
        "Exceptional tournaments management",
        "Verwaltung aussergewoehnlicher Turniere",
        "Gestione tornei eccezionali"
      ),
      organization: labelByLocale(locale, "Organisation", "Organization", "Organisation", "Organizzazione"),
      loading: labelByLocale(locale, "Chargement…", "Loading…", "Laedt…", "Caricamento…"),
      addTitle: labelByLocale(
        locale,
        "Ajouter un tournoi exceptionnel",
        "Add exceptional tournament",
        "Aussergewoehnliches Turnier hinzufuegen",
        "Aggiungi torneo eccezionale"
      ),
      listTitle: labelByLocale(
        locale,
        "Liste des tournois exceptionnels",
        "Exceptional tournaments list",
        "Liste der aussergewoehnlichen Turniere",
        "Elenco tornei eccezionali"
      ),
      name: labelByLocale(locale, "Nom", "Name", "Name", "Nome"),
      description: labelByLocale(locale, "Description", "Description", "Beschreibung", "Descrizione"),
      startsOn: labelByLocale(locale, "Début", "Start", "Beginn", "Inizio"),
      endsOn: labelByLocale(locale, "Fin", "End", "Ende", "Fine"),
      active: labelByLocale(locale, "Actif", "Active", "Aktiv", "Attivo"),
      inactive: labelByLocale(locale, "Inactif", "Inactive", "Inaktiv", "Inattivo"),
      noData: labelByLocale(
        locale,
        "Aucun tournoi exceptionnel.",
        "No exceptional tournament.",
        "Kein aussergewoehnliches Turnier.",
        "Nessun torneo eccezionale."
      ),
      add: labelByLocale(locale, "Ajouter", "Add", "Hinzufuegen", "Aggiungi"),
      activate: labelByLocale(locale, "Activer", "Activate", "Aktivieren", "Attiva"),
      deactivate: labelByLocale(locale, "Désactiver", "Deactivate", "Deaktivieren", "Disattiva"),
      delete: labelByLocale(locale, "Supprimer", "Delete", "Loeschen", "Elimina"),
      chooseOrg: labelByLocale(
        locale,
        "Aucune organisation manager trouvée.",
        "No managed organization found.",
        "Keine verwaltete Organisation gefunden.",
        "Nessuna organizzazione gestita trovata."
      ),
      created: labelByLocale(locale, "Tournoi ajouté.", "Tournament added.", "Turnier hinzugefuegt.", "Torneo aggiunto."),
      updated: labelByLocale(locale, "Statut mis à jour.", "Status updated.", "Status aktualisiert.", "Stato aggiornato."),
      deleted: labelByLocale(locale, "Tournoi supprimé.", "Tournament deleted.", "Turnier geloescht.", "Torneo eliminato."),
      genericError: labelByLocale(locale, "Erreur", "Error", "Fehler", "Errore"),
      requiredName: labelByLocale(
        locale,
        "Le nom est obligatoire.",
        "Name is required.",
        "Name ist erforderlich.",
        "Il nome e obbligatorio."
      ),
      rankingTitle: labelByLocale(locale, "Classement OM", "OM ranking", "OM-Rangliste", "Classifica OM"),
      rankingDateFrom: labelByLocale(locale, "Du", "From", "Von", "Dal"),
      rankingDateTo: labelByLocale(locale, "Au", "To", "Bis", "Al"),
      rankingNet: labelByLocale(locale, "Net", "Net", "Netto", "Netto"),
      rankingBrut: labelByLocale(locale, "Brut", "Gross", "Brutto", "Lordo"),
      rankingPos: labelByLocale(locale, "Rang", "Rank", "Rang", "Posizione"),
      rankingPlayer: labelByLocale(locale, "Joueur", "Player", "Spieler", "Giocatore"),
      rankingTournament: labelByLocale(locale, "Tournois", "Tournaments", "Turniere", "Tornei"),
      rankingBonus: labelByLocale(locale, "Bonus", "Bonus", "Bonus", "Bonus"),
      rankingTotal: labelByLocale(locale, "Total", "Total", "Total", "Totale"),
      rankingPeriod: labelByLocale(
        locale,
        "Période {slot} • meilleurs {limit} tours",
        "Period {slot} • best {limit} rounds",
        "Periode {slot} • beste {limit} Runden",
        "Periodo {slot} • migliori {limit} giri"
      ),
      rankingEmpty: labelByLocale(locale, "Aucun score OM.", "No OM scores.", "Keine OM-Scores.", "Nessun punteggio OM."),
      contestsTitle: labelByLocale(locale, "Concours internes", "Internal contests", "Interne Wettbewerbe", "Concorsi interni"),
      createContest: labelByLocale(locale, "Créer un concours", "Create contest", "Wettbewerb erstellen", "Crea concorso"),
      contestName: labelByLocale(locale, "Titre", "Title", "Titel", "Titolo"),
      contestDescription: labelByLocale(locale, "Description", "Description", "Beschreibung", "Descrizione"),
      contestDate: labelByLocale(locale, "Date", "Date", "Datum", "Data"),
      contestGroup: labelByLocale(locale, "Groupe (optionnel)", "Group (optional)", "Gruppe (optional)", "Gruppo (opzionale)"),
      noGroup: labelByLocale(locale, "Aucun groupe", "No group", "Keine Gruppe", "Nessun gruppo"),
      contestCreated: labelByLocale(locale, "Concours créé.", "Contest created.", "Wettbewerb erstellt.", "Concorso creato."),
      noContest: labelByLocale(locale, "Aucun concours.", "No contest.", "Kein Wettbewerb.", "Nessun concorso."),
      editContest: labelByLocale(locale, "Gérer classement", "Manage ranking", "Rangliste verwalten", "Gestisci classifica"),
    }),
    [locale]
  );

  function formatPoints(value: number | string | null | undefined) {
    const n = typeof value === "number" ? value : Number(value ?? 0);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
  }

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadExceptionalTournaments(orgId: string) {
    if (!orgId) {
      setRows([]);
      return;
    }
    const q = await supabase
      .from("om_exceptional_tournaments")
      .select("id,organization_id,name,description,starts_on,ends_on,is_active")
      .eq("organization_id", orgId)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (q.error) throw new Error(q.error.message);
    setRows((q.data ?? []) as ExceptionalTournament[]);
  }

  async function loadGroupsAndContests(orgId: string) {
    if (!orgId) {
      setGroups([]);
      setContests([]);
      return;
    }
    const [gRes, cRes] = await Promise.all([
      supabase
        .from("coach_groups")
        .select("id,name,is_active")
        .eq("club_id", orgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("om_internal_contests")
        .select("id,organization_id,group_id,title,description,contest_date,updated_at")
        .eq("organization_id", orgId)
        .order("contest_date", { ascending: false })
        .order("updated_at", { ascending: false }),
    ]);
    if (gRes.error) throw new Error(gRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);
    setGroups((gRes.data ?? []) as GroupLite[]);
    setContests((cRes.data ?? []) as InternalContest[]);
  }

  async function loadRanking(orgId: string, fromDate: string, toDate: string) {
    if (!orgId || !fromDate || !toDate) {
      setRankingRows([]);
      setAvatarByPlayerId({});
      return;
    }
    const rangeFrom = fromDate <= toDate ? fromDate : toDate;
    const rangeTo = fromDate <= toDate ? toDate : fromDate;
    setRankingLoading(true);
    const r = await supabase.rpc("om_ranking_snapshot", { p_org_id: orgId, p_from: rangeFrom, p_as_of: rangeTo });
    setRankingLoading(false);
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as OMRankingRow[];
    setRankingRows(rows);

    const playerIds = Array.from(new Set(rows.map((row) => row.player_id).filter(Boolean)));
    if (playerIds.length === 0) {
      setAvatarByPlayerId({});
      return;
    }
    const profilesRes = await supabase.from("profiles").select("id,avatar_url").in("id", playerIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    const nextMap: Record<string, string | null> = {};
    ((profilesRes.data ?? []) as ProfileAvatarRow[]).forEach((p) => {
      nextMap[p.id] = p.avatar_url ?? null;
    });
    setAvatarByPlayerId(nextMap);
  }

  async function loadOrgsAndRows() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/manager/my-clubs", { method: "GET", headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? txt.genericError));

      const nextOrgs: ManagedOrg[] = (Array.isArray(json?.clubs) ? json.clubs : [])
        .map((c: any) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "Club") }))
        .filter((x: ManagedOrg) => Boolean(x.id));
      setOrgs(nextOrgs);

      const nextOrgId = organizationId || nextOrgs[0]?.id || "";
      setOrganizationId(nextOrgId);
      if (!nextOrgId) {
        setRows([]);
        setRankingRows([]);
        setGroups([]);
        setContests([]);
        return;
      }

      await loadExceptionalTournaments(nextOrgId);
      await loadGroupsAndContests(nextOrgId);
      await loadRanking(nextOrgId, rankingFrom, rankingTo);
    } catch (e: any) {
      setError(String(e?.message ?? txt.genericError));
      setRows([]);
      setRankingRows([]);
      setGroups([]);
      setContests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrgsAndRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      try {
        await loadExceptionalTournaments(organizationId);
        await loadGroupsAndContests(organizationId);
        await loadRanking(organizationId, rankingFrom, rankingTo);
      } catch (e: any) {
        setError(String(e?.message ?? txt.genericError));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      try {
        await loadRanking(organizationId, rankingFrom, rankingTo);
      } catch (e: any) {
        setError(String(e?.message ?? txt.genericError));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingFrom, rankingTo]);

  async function onCreateContest() {
    setError(null);
    setSuccess(null);
    if (!organizationId || !contestTitle.trim() || !contestDate) return;
    const ins = await supabase.from("om_internal_contests").insert({
      organization_id: organizationId,
      group_id: contestGroupId || null,
      title: contestTitle.trim(),
      description: contestDescription.trim() || null,
      contest_date: contestDate,
    });
    if (ins.error) {
      setError(ins.error.message);
      return;
    }
    setContestTitle("");
    setContestDescription("");
    setContestDate(todayInZurich);
    setContestGroupId("");
    setSuccess(txt.contestCreated);
    await loadGroupsAndContests(organizationId);
  }

  const periodSlot = rankingRows[0]?.period_slot ?? null;
  const periodLimit = rankingRows[0]?.period_limit ?? null;
  const periodLabel =
    periodSlot && periodLimit
      ? txt.rankingPeriod.replace("{slot}", String(periodSlot)).replace("{limit}", String(periodLimit))
      : null;
  const sortedRankingRows = [...rankingRows].sort((a, b) => {
    if (rankingMode === "net") {
      if (a.rank_net !== b.rank_net) return a.rank_net - b.rank_net;
      return a.full_name.localeCompare(b.full_name);
    }
    if (a.rank_brut !== b.rank_brut) return a.rank_brut - b.rank_brut;
    return a.full_name.localeCompare(b.full_name);
  });

  async function onAdd() {
    setError(null);
    setSuccess(null);
    if (!organizationId) return;
    if (!name.trim()) {
      setError(txt.requiredName);
      return;
    }
    setSaving(true);
    const { error: insertError } = await supabase.from("om_exceptional_tournaments").insert({
      organization_id: organizationId,
      name: name.trim(),
      description: description.trim() || null,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      is_active: true,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setDescription("");
    setStartsOn("");
    setEndsOn("");
    setSuccess(txt.created);
    await loadOrgsAndRows();
  }

  async function onToggle(row: ExceptionalTournament) {
    setError(null);
    setSuccess(null);
    const { error: updateError } = await supabase
      .from("om_exceptional_tournaments")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(txt.updated);
    await loadOrgsAndRows();
  }

  async function onDelete(row: ExceptionalTournament) {
    setError(null);
    setSuccess(null);
    const { error: deleteError } = await supabase.from("om_exceptional_tournaments").delete().eq("id", row.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setSuccess(txt.deleted);
    await loadOrgsAndRows();
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header" style={{ alignItems: "center" }}>
            <div className="section-title" style={{ marginBottom: 0, display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Trophy size={18} />
              {txt.title}
            </div>
          </div>
          <div style={{ opacity: 0.72, fontSize: 14, marginTop: 6 }}>{txt.subtitle}</div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>{txt.organization}</span>
              <select
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className="search-input"
                style={{ maxWidth: 440 }}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            {!loading && orgs.length === 0 ? <div style={{ opacity: 0.72 }}>{txt.chooseOrg}</div> : null}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>{txt.rankingTitle}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>{txt.rankingDateFrom}</span>
                  <input className="search-input" type="date" value={rankingFrom} onChange={(e) => setRankingFrom(e.target.value)} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>{txt.rankingDateTo}</span>
                  <input className="search-input" type="date" value={rankingTo} onChange={(e) => setRankingTo(e.target.value)} />
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={`btn ${rankingMode === "net" ? "btn-active-om-light" : ""}`}
                onClick={() => setRankingMode("net")}
                aria-pressed={rankingMode === "net"}
              >
                {txt.rankingNet}
              </button>
              <button
                type="button"
                className={`btn ${rankingMode === "brut" ? "btn-active-om-light" : ""}`}
                onClick={() => setRankingMode("brut")}
                aria-pressed={rankingMode === "brut"}
              >
                {txt.rankingBrut}
              </button>
            </div>
            {periodLabel ? <div style={{ fontSize: 13, opacity: 0.72 }}>{periodLabel}</div> : null}
            {rankingLoading ? (
              <ListLoadingBlock label={txt.loading} />
            ) : sortedRankingRows.length === 0 ? (
              <div style={{ opacity: 0.72 }}>{txt.rankingEmpty}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {sortedRankingRows.map((row) => (
                  <div key={row.player_id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            minWidth: 44,
                            height: 28,
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.10)",
                            display: "grid",
                            placeItems: "center",
                            fontWeight: 900,
                            fontSize: 13,
                          }}
                        >
                          #{rankingMode === "net" ? row.rank_net : row.rank_brut}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              overflow: "hidden",
                              background: "rgba(0,0,0,0.08)",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {avatarByPlayerId[row.player_id] ? (
                              <img src={avatarByPlayerId[row.player_id] ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <span>{initialsFromName(row.full_name)}</span>
                            )}
                          </div>
                          <div style={{ fontWeight: 800 }}>{row.full_name}</div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>
                        {rankingMode === "net" ? formatPoints(row.total_points_net) : formatPoints(row.total_points_brut)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <ListChecks size={17} />
              {txt.contestsTitle}
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <input
                className="search-input"
                value={contestTitle}
                onChange={(e) => setContestTitle(e.target.value)}
                placeholder={txt.contestName}
                disabled={!organizationId}
              />
              <input
                className="search-input"
                value={contestDescription}
                onChange={(e) => setContestDescription(e.target.value)}
                placeholder={txt.contestDescription}
                disabled={!organizationId}
              />
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{txt.contestDate}</span>
                <input className="search-input" type="date" value={contestDate} onChange={(e) => setContestDate(e.target.value)} disabled={!organizationId} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{txt.contestGroup}</span>
                <select className="search-input" value={contestGroupId} onChange={(e) => setContestGroupId(e.target.value)} disabled={!organizationId}>
                  <option value="">{txt.noGroup}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name ?? "—"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button
                type="button"
                className="cta-green cta-green-inline"
                onClick={onCreateContest}
                disabled={!organizationId || !contestTitle.trim() || !contestDate}
              >
                <Plus size={16} />
                {txt.createContest}
              </button>
            </div>
            {contests.length === 0 ? (
              <div style={{ opacity: 0.72 }}>{txt.noContest}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {contests.map((c) => (
                  <div key={c.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{c.title}</div>
                        <div style={{ fontSize: 13, opacity: 0.7 }}>{c.contest_date}</div>
                      </div>
                      <Link className="btn" href={`/manager/om/contests/${c.id}`}>
                        {txt.editContest}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>{txt.addTitle}</div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <input
                className="search-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={txt.name}
                disabled={!organizationId || saving}
              />
              <input
                className="search-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={txt.description}
                disabled={!organizationId || saving}
              />
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{txt.startsOn}</span>
                <input className="search-input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} disabled={!organizationId || saving} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{txt.endsOn}</span>
                <input className="search-input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} disabled={!organizationId || saving} />
              </label>
            </div>

            <div>
              <button type="button" className="cta-green cta-green-inline" disabled={!organizationId || saving} onClick={onAdd}>
                <Plus size={16} />
                {txt.add}
              </button>
            </div>
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>{txt.listTitle}</div>
            {loading ? (
              <ListLoadingBlock label={txt.loading} />
            ) : rows.length === 0 ? (
              <div style={{ opacity: 0.72 }}>{txt.noData}</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="marketplace-item"
                    style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12, display: "grid", gap: 8 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 800 }}>{row.name}</div>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: row.is_active ? "rgba(22,163,74,0.15)" : "rgba(107,114,128,0.16)",
                          color: row.is_active ? "#166534" : "#374151",
                        }}
                      >
                        {row.is_active ? txt.active : txt.inactive}
                      </span>
                    </div>
                    {row.description ? <div style={{ opacity: 0.8 }}>{row.description}</div> : null}
                    <div style={{ fontSize: 13, opacity: 0.7 }}>
                      {txt.startsOn}: {row.starts_on ?? "—"} · {txt.endsOn}: {row.ends_on ?? "—"}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => onToggle(row)}>
                        {row.is_active ? txt.deactivate : txt.activate}
                      </button>
                      <button type="button" className="btn btn-danger" onClick={() => onDelete(row)}>
                        <Trash2 size={15} />
                        {txt.delete}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error ? (
          <div className="glass-section">
            <div className="marketplace-error">{error}</div>
          </div>
        ) : null}
        {success ? (
          <div className="glass-section">
            <div style={{ color: "#166534", fontWeight: 700 }}>{success}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
