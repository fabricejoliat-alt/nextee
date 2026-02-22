"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  Calendar,
  PlusCircle,
  Repeat,
  Trash2,
  Pencil,
  Users,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type GroupRow = { id: string; name: string | null; club_id: string };
type ClubRow = { id: string; name: string | null };

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap?: number | null;
  avatar_url?: string | null;
};

type CoachLite = {
  id: string; // coach_user_id
  first_name: string | null;
  last_name: string | null;
};

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type SeriesInsert = {
  group_id: string;
  club_id: string;
  title: string | null;
  location_text: string | null;
  duration_minutes: number;
  weekday: number;
  time_of_day: string; // "HH:mm:ss" or "HH:mm"
  interval_weeks: number;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  is_active: boolean;
  created_by: string;
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalDatetime() {
  const d = new Date();
  return isoToLocalInput(d.toISOString());
}

function ymdToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function toYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDayISO(ymd: string) {
  // ymd = YYYY-MM-DD (local) => ISO at local midnight
  const d = new Date(`${ymd}T00:00:00`);
  return d.toISOString();
}

function nextDayStartISO(ymd: string) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

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

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

type FilterMode = "upcoming" | "past" | "range";

export default function CoachGroupPlanningPage() {
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [clubName, setClubName] = useState("");

  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [players, setPlayers] = useState<ProfileLite[]>([]);

  const [events, setEvents] = useState<EventRow[]>([]);

  // Coaches selected (simple chips)
  const [coachIdsSelected, setCoachIdsSelected] = useState<string[]>([]);

  // Players selected (same design as group creation)
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});

  // create form
  const [mode, setMode] = useState<"single" | "series">("single");

  // single
  const [startsAtLocal, setStartsAtLocal] = useState<string>(() => nowLocalDatetime());
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [locationText, setLocationText] = useState<string>("");

  // series
  const [weekday, setWeekday] = useState<number>(2); // mardi défaut
  const [timeOfDay, setTimeOfDay] = useState<string>("18:00");
  const [intervalWeeks, setIntervalWeeks] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(() => ymdToday());
  const [endDate, setEndDate] = useState<string>(() => toYMD(addDays(new Date(), 60)));

  // ✅ NEW — filter
  const [filterMode, setFilterMode] = useState<FilterMode>("upcoming");
  const [rangeFrom, setRangeFrom] = useState<string>(() => toYMD(addDays(new Date(), -30)));
  const [rangeTo, setRangeTo] = useState<string>(() => toYMD(addDays(new Date(), 30)));

  const selectedPlayersList = useMemo(
    () => Object.values(selectedPlayers).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [selectedPlayers]
  );

  const candidatesPlayers = useMemo(() => {
    const q = queryPlayers.trim().toLowerCase();
    const base = players.filter((p) => !selectedPlayers[p.id]);

    const filtered = !q
      ? base
      : base.filter((p) => {
          const n = fullName(p).toLowerCase();
          const h = typeof p.handicap === "number" ? String(p.handicap) : "";
          return n.includes(q) || h.includes(q);
        });

    return filtered.slice(0, 30);
  }, [players, queryPlayers, selectedPlayers]);

  const allPlayersSelected = useMemo(() => {
    const total = players.length;
    const selectedCount = Object.keys(selectedPlayers).length;
    return total > 0 && selectedCount === total;
  }, [players.length, selectedPlayers]);

  function toggleInList(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function toggleSelectedPlayer(p: ProfileLite) {
    setSelectedPlayers((prev) => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = p;
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!groupId) throw new Error("Groupe manquant.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      // group
      const gRes = await supabase.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle();
      if (gRes.error) throw new Error(gRes.error.message);
      if (!gRes.data) throw new Error("Groupe introuvable.");
      setGroup(gRes.data as GroupRow);

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", gRes.data.club_id).maybeSingle();
      if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? "Club");
      else setClubName("Club");

      // coaches in group
      const coRes = await supabase
        .from("coach_group_coaches")
        .select("coach_user_id, profiles:coach_user_id ( id, first_name, last_name )")
        .eq("group_id", groupId);

      if (coRes.error) throw new Error(coRes.error.message);
      const coList: CoachLite[] = (coRes.data ?? []).map((r: any) => ({
        id: r.coach_user_id,
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
      }));
      setCoaches(coList);

      // players in group
      const plRes = await supabase
        .from("coach_group_players")
        .select("player_user_id, profiles:player_user_id ( id, first_name, last_name, handicap, avatar_url )")
        .eq("group_id", groupId);

      if (plRes.error) throw new Error(plRes.error.message);
      const plList: ProfileLite[] = (plRes.data ?? []).map((r: any) => ({
        id: r.profiles?.id ?? r.player_user_id,
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
        handicap: r.profiles?.handicap ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
      plList.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
      setPlayers(plList);

      // defaults selections
      setCoachIdsSelected(coList.map((c) => c.id));

      // default: all players selected
      const defaultSelected: Record<string, ProfileLite> = {};
      plList.forEach((p) => (defaultSelected[p.id] = p));
      setSelectedPlayers(defaultSelected);

      // ✅ events filtered
      let isoFrom: string | null = null;
      let isoTo: string | null = null;

      if (filterMode === "upcoming") {
        const from = new Date();
        const to = addDays(from, 90);
        isoFrom = from.toISOString();
        isoTo = to.toISOString();
      } else if (filterMode === "past") {
        const to = new Date(); // now
        const from = addDays(to, -90);
        isoFrom = from.toISOString();
        isoTo = to.toISOString();
      } else {
        // range
        if (rangeFrom) isoFrom = startOfDayISO(rangeFrom);
        if (rangeTo) isoTo = nextDayStartISO(rangeTo); // inclusive end date
      }

      let q = supabase
        .from("club_events")
        .select("id,group_id,club_id,starts_at,duration_minutes,location_text,series_id,status")
        .eq("group_id", groupId)
        .order("starts_at", { ascending: true });

      if (isoFrom) q = q.gte("starts_at", isoFrom);
      if (isoTo) q = q.lt("starts_at", isoTo);

      const eRes = await q;
      if (eRes.error) throw new Error(eRes.error.message);
      setEvents((eRes.data ?? []) as EventRow[]);

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setGroup(null);
      setClubName("");
      setCoaches([]);
      setPlayers([]);
      setEvents([]);
      setSelectedPlayers({});
      setCoachIdsSelected([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, filterMode, rangeFrom, rangeTo]);

  async function createSingleEvent() {
    if (!group || busy) return;
    setBusy(true);
    setError(null);

    try {
      const dt = new Date(startsAtLocal);
      if (Number.isNaN(dt.getTime())) throw new Error("Date/heure invalide.");

      const { data: insData, error: insErr } = await supabase
        .from("club_events")
        .insert({
          group_id: group.id,
          club_id: group.club_id,
          starts_at: dt.toISOString(),
          duration_minutes: durationMinutes,
          location_text: locationText.trim() || null,
          created_by: meId,
        })
        .select("id")
        .single();

      if (insErr) throw new Error(insErr.message);
      const eventId = insData.id as string;

      // coaches link
      if (coachIdsSelected.length > 0) {
        const rows = coachIdsSelected.map((cid) => ({ event_id: eventId, coach_id: cid }));
        const cIns = await supabase.from("club_event_coaches").insert(rows);
        if (cIns.error) throw new Error(cIns.error.message);
      }

      // attendees
      const playerIds = Object.keys(selectedPlayers);
      if (playerIds.length > 0) {
        const rows = playerIds.map((pid) => ({ event_id: eventId, player_id: pid, status: "expected" }));
        const aIns = await supabase.from("club_event_attendees").insert(rows);
        if (aIns.error) throw new Error(aIns.error.message);
      }

      await load();
      setBusy(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur création.");
      setBusy(false);
    }
  }

  function weekdayFromDate(d: Date) {
    return d.getDay(); // 0=Sun..6=Sat
  }

  function nextWeekdayOnOrAfter(start: Date, targetWeekday: number) {
    const d = new Date(start);
    const w = weekdayFromDate(d);
    const diff = (targetWeekday - w + 7) % 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function combineDateAndTime(localYMD: string, hhmm: string) {
    const t = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
    return new Date(`${localYMD}T${t}`);
  }

  async function createSeries() {
    if (!group || busy) return;
    setBusy(true);
    setError(null);

    try {
      if (!startDate || !endDate) throw new Error("Dates de la récurrence manquantes.");
      if (endDate < startDate) throw new Error("La date de fin doit être après la date de début.");

      const seriesPayload: SeriesInsert = {
        group_id: group.id,
        club_id: group.club_id,
        title: null,
        location_text: locationText.trim() || null,
        duration_minutes: durationMinutes,
        weekday,
        time_of_day: timeOfDay.length === 5 ? `${timeOfDay}:00` : timeOfDay,
        interval_weeks: intervalWeeks,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        created_by: meId,
      };

      const sIns = await supabase.from("club_event_series").insert(seriesPayload).select("id").single();
      if (sIns.error) throw new Error(sIns.error.message);
      const seriesId = sIns.data.id as string;

      // generate occurrences (cap 80)
      const startLocal = new Date(`${startDate}T00:00:00`);
      const endLocal = new Date(`${endDate}T23:59:59`);

      let cursor = nextWeekdayOnOrAfter(startLocal, weekday);
      let count = 0;

      const occurrences: any[] = [];
      while (cursor <= endLocal) {
        const dt = combineDateAndTime(toYMD(cursor), timeOfDay);
        occurrences.push({
          group_id: group.id,
          club_id: group.club_id,
          starts_at: dt.toISOString(),
          duration_minutes: durationMinutes,
          location_text: locationText.trim() || null,
          series_id: seriesId,
          created_by: meId,
        });

        count += 1;
        if (count >= 80) break;
        cursor = addDays(cursor, intervalWeeks * 7);
      }

      if (occurrences.length === 0) throw new Error("Aucune occurrence générée (vérifie jour/horaires).");

      const eIns = await supabase.from("club_events").insert(occurrences).select("id");
      if (eIns.error) throw new Error(eIns.error.message);

      const createdEventIds = (eIns.data ?? []).map((r: any) => r.id as string);

      // link coaches
      if (coachIdsSelected.length > 0 && createdEventIds.length > 0) {
        const coachRows = createdEventIds.flatMap((eid) => coachIdsSelected.map((cid) => ({ event_id: eid, coach_id: cid })));
        const cIns = await supabase.from("club_event_coaches").insert(coachRows);
        if (cIns.error) throw new Error(cIns.error.message);
      }

      // attendees
      const playerIds = Object.keys(selectedPlayers);
      if (playerIds.length > 0 && createdEventIds.length > 0) {
        const attRows = createdEventIds.flatMap((eid) => playerIds.map((pid) => ({ event_id: eid, player_id: pid, status: "expected" })));
        const aIns = await supabase.from("club_event_attendees").insert(attRows);
        if (aIns.error) throw new Error(aIns.error.message);
      }

      await load();
      setBusy(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur création récurrence.");
      setBusy(false);
    }
  }

  async function deleteEvent(eventId: string) {
    const ok = window.confirm("Supprimer cet entraînement planifié ? (irréversible)");
    if (!ok) return;

    setBusy(true);
    setError(null);

    const del = await supabase.from("club_events").delete().eq("id", eventId);
    if (del.error) setError(del.error.message);
    setBusy(false);
    await load();
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Planification — {group?.name ?? "Groupe"}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>Club: {clubName}</div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}`}>
                Retour
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Create */}
        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
                <Calendar size={16} />
                Créer un entraînement
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMode("single")}
                  disabled={busy}
                  style={mode === "single" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                >
                  Unique
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMode("series")}
                  disabled={busy}
                  style={mode === "series" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                >
                  <Repeat size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  Récurrent
                </button>
              </div>
            </div>

            <div className="hr-soft" />

            {/* Core fields */}
            {mode === "single" ? (
              <div className="grid-2">
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Date & heure</span>
                  <input type="datetime-local" value={startsAtLocal} onChange={(e) => setStartsAtLocal(e.target.value)} disabled={busy} />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Durée</span>
                  <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} disabled={busy}>
                    {[45, 60, 75, 90, 105, 120].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Jour</span>
                    <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={busy}>
                      <option value={1}>Lundi</option>
                      <option value={2}>Mardi</option>
                      <option value={3}>Mercredi</option>
                      <option value={4}>Jeudi</option>
                      <option value={5}>Vendredi</option>
                      <option value={6}>Samedi</option>
                      <option value={0}>Dimanche</option>
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Heure</span>
                    <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} disabled={busy} />
                  </label>
                </div>

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Du</span>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Au</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
                  </label>
                </div>

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Durée</span>
                    <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} disabled={busy}>
                      {[45, 60, 75, 90, 105, 120].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Rythme</span>
                    <select value={intervalWeeks} onChange={(e) => setIntervalWeeks(Number(e.target.value))} disabled={busy}>
                      {[1, 2, 3, 4].map((w) => (
                        <option key={w} value={w}>
                          Toutes les {w} semaine{w > 1 ? "s" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                  ⚠️ On matérialise les occurrences (max 80) pour que ce soit simple à éditer/supprimer par événement.
                </div>
              </div>
            )}

            <label style={{ display: "grid", gap: 6 }}>
              <span style={fieldLabelStyle}>Lieu (optionnel)</span>
              <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} placeholder="Ex: Practice / putting / parcours" />
            </label>

            <div className="hr-soft" />

            {/* Select coaches */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
                <Users size={16} /> Coachs
              </div>

              {coaches.length === 0 ? (
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun coach dans ce groupe.</div>
              ) : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {coaches.map((c) => {
                    const on = coachIdsSelected.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setCoachIdsSelected((prev) => toggleInList(prev, c.id))}
                        style={on ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                      >
                        {fullName(c)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Select players */}
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
                <Users size={16} /> Joueurs attendus
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || players.length === 0 || allPlayersSelected}
                  onClick={() => {
                    const map: Record<string, ProfileLite> = {};
                    players.forEach((p) => (map[p.id] = p));
                    setSelectedPlayers(map);
                  }}
                >
                  Tout sélectionner
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={busy || players.length === 0 || Object.keys(selectedPlayers).length === 0}
                  onClick={() => setSelectedPlayers({})}
                >
                  Tout désélectionner
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <Search
                  size={18}
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    opacity: 0.7,
                  }}
                />
                <input
                  value={queryPlayers}
                  onChange={(e) => setQueryPlayers(e.target.value)}
                  disabled={busy}
                  placeholder="Rechercher un joueur (nom, handicap)…"
                  style={{ paddingLeft: 44 }}
                />
              </div>

              {/* Selected */}
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Sélection ({selectedPlayersList.length})</div>

                {players.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun joueur dans ce groupe.</div>
                ) : selectedPlayersList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun joueur sélectionné.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedPlayersList.map((p) => (
                      <div key={p.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {initials(p)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                              Handicap {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-danger soft"
                          onClick={() => toggleSelectedPlayer(p)}
                          disabled={busy}
                          style={{ padding: "10px 12px" }}
                          aria-label="Retirer"
                          title="Retirer"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add */}
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Ajouter ({candidatesPlayers.length})</div>

                {players.length > 0 && candidatesPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun résultat.</div>
                ) : candidatesPlayers.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {candidatesPlayers.map((p) => (
                      <div key={p.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {initials(p)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                              Handicap {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="glass-btn"
                          onClick={() => toggleSelectedPlayer(p)}
                          disabled={busy}
                          style={{
                            width: 44,
                            height: 42,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(255,255,255,0.70)",
                            border: "1px solid rgba(0,0,0,0.08)",
                          }}
                          aria-label="Ajouter joueur"
                          title="Ajouter"
                        >
                          <PlusCircle size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              className="btn"
              disabled={busy || loading || !group}
              onClick={() => (mode === "single" ? createSingleEvent() : createSeries())}
              style={{
                width: "100%",
                background: "var(--green-dark)",
                borderColor: "var(--green-dark)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <PlusCircle size={18} />
              {busy ? "Enregistrement…" : mode === "single" ? "Créer l’entraînement" : "Créer la récurrence"}
            </button>
          </div>
        </div>

        {/* ✅ Filters for list */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
              <SlidersHorizontal size={16} />
              Filtrer les entraînements
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setFilterMode("upcoming")}
                style={filterMode === "upcoming" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
              >
                À venir
              </button>

              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setFilterMode("past")}
                style={filterMode === "past" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
              >
                Passés
              </button>

              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setFilterMode("range")}
                style={filterMode === "range" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
              >
                Plage de dates
              </button>
            </div>

            {filterMode === "range" ? (
              <>
                <div className="hr-soft" />
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Du</span>
                    <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} disabled={busy} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Au</span>
                    <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} disabled={busy} />
                  </label>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                {filterMode === "upcoming"
                  ? "Fenêtre par défaut : 90 prochains jours."
                  : "Fenêtre par défaut : 90 derniers jours."}
              </div>
            )}
          </div>
        </div>

        {/* List */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : events.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                {filterMode === "upcoming"
                  ? "Aucun entraînement à venir (sur 90 jours)."
                  : filterMode === "past"
                  ? "Aucun entraînement passé (sur 90 jours)."
                  : "Aucun entraînement sur cette plage de dates."}
              </div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {events.map((e) => (
                  <div key={e.id} className="marketplace-item">
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                          {fmtDateTime(e.starts_at)}
                        </div>

                        <div className="marketplace-price-pill">{e.duration_minutes} min</div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="pill-soft">{clubName || "Club"}</span>
                        {e.series_id ? <span className="pill-soft">Récurrent</span> : <span className="pill-soft">Unique</span>}
                        {e.location_text ? (
                          <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>📍 {e.location_text}</span>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                        <Link className="btn" href={`/coach/groups/${groupId}/planning/${e.id}`}>
                          Ouvrir
                        </Link>

                        <Link className="btn" href={`/coach/groups/${groupId}/planning/${e.id}/edit`}>
                          <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          Modifier
                        </Link>

                        <button
                          type="button"
                          className="btn btn-danger soft"
                          disabled={busy}
                          onClick={() => deleteEvent(e.id)}
                          title="Supprimer"
                        >
                          <Trash2 size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Note */}
        <div className="glass-section" style={{ marginTop: 12 }}>
          <div className="glass-card" style={{ color: "rgba(0,0,0,0.62)", fontWeight: 800, fontSize: 12 }}>
            👉 Le coach planifie uniquement la date/lieu/coachs/joueurs attendus. Le joueur saisit le contenu (postes + sensations) après, comme aujourd’hui.
          </div>
        </div>
      </div>
    </div>
  );
}

const avatarBoxStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  overflow: "hidden",
  background: "rgba(255,255,255,0.65)",
  border: "1px solid rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  color: "var(--green-dark)",
  flexShrink: 0,
};

const lightRowCardStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 14,
  background: "rgba(255,255,255,0.65)",
  padding: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};