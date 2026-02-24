"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Repeat, Trash2, PlusCircle, Search } from "lucide-react";

type GroupRow = { id: string; name: string | null; club_id: string };
type ClubRow = { id: string; name: string | null };

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

type SeriesRow = {
  id: string;
  group_id: string;
  club_id: string;
  title: string | null;
  location_text: string | null;
  duration_minutes: number;
  weekday: number; // 0..6 (JS)
  time_of_day: string; // "HH:mm:ss"
  interval_weeks: number;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  is_active: boolean;
  created_by: string;
};

type CoachLite = { id: string; first_name: string | null; last_name: string | null };

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap?: number | null;
  avatar_url?: string | null;
};

function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
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
  return (fi + li) || "👤";
}

function weekdayFromDate(d: Date) {
  // JS: 0=Sun..6=Sat
  return d.getDay();
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

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

export default function CoachEventEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [clubName, setClubName] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [series, setSeries] = useState<SeriesRow | null>(null);

  // UI mode
  const [editScope, setEditScope] = useState<"occurrence" | "series">("occurrence");

  // occurrence fields
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [locationText, setLocationText] = useState<string>("");

  // series fields
  const [weekday, setWeekday] = useState<number>(2);
  const [timeOfDay, setTimeOfDay] = useState<string>("18:00");
  const [intervalWeeks, setIntervalWeeks] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(() => ymdToday());
  const [endDate, setEndDate] = useState<string>(() => toYMD(addDays(new Date(), 60)));
  const [seriesActive, setSeriesActive] = useState<boolean>(true);

  // coaches
  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [coachIdsSelected, setCoachIdsSelected] = useState<string[]>([]);

  // players (same design as planning page)
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});
  const [initialSelectedPlayerIds, setInitialSelectedPlayerIds] = useState<string[]>([]);

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

  const selectedPlayersList = useMemo(
    () =>
      Object.values(selectedPlayers).sort((a, b) =>
        fullName(a).localeCompare(fullName(b), "fr")
      ),
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

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!groupId || !eventId) throw new Error("Paramètres manquants.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      // event
      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,starts_at,duration_minutes,location_text,series_id,status")
        .eq("id", eventId)
        .maybeSingle();

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Entraînement introuvable.");
      const ev = eRes.data as EventRow;
      setEvent(ev);

      setStartsAtLocal(isoToLocalInput(ev.starts_at));
      setDurationMinutes(ev.duration_minutes);
      setLocationText(ev.location_text ?? "");

      // group
      const gRes = await supabase.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle();
      if (gRes.error) throw new Error(gRes.error.message);
      if (!gRes.data) throw new Error("Groupe introuvable.");
      setGroup(gRes.data as GroupRow);

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", gRes.data.club_id).maybeSingle();
      if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? "Club");
      else setClubName("Club");

      // series
      if (ev.series_id) {
        const sRes = await supabase
          .from("club_event_series")
          .select(
            "id,group_id,club_id,title,location_text,duration_minutes,weekday,time_of_day,interval_weeks,start_date,end_date,is_active,created_by"
          )
          .eq("id", ev.series_id)
          .maybeSingle();

        if (sRes.error) throw new Error(sRes.error.message);
        const s = (sRes.data ?? null) as SeriesRow | null;
        setSeries(s);

        if (s) {
          setEditScope("occurrence");
          setWeekday(s.weekday);
          setTimeOfDay((s.time_of_day ?? "18:00:00").slice(0, 5));
          setIntervalWeeks(s.interval_weeks ?? 1);
          setStartDate(s.start_date ?? ymdToday());
          setEndDate(s.end_date ?? toYMD(addDays(new Date(), 60)));
          setSeriesActive(!!s.is_active);
        } else {
          setEditScope("occurrence");
        }
      } else {
        setSeries(null);
        setEditScope("occurrence");
      }

      // ✅ group coaches (BD: coach_group_coaches.coach_user_id)
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

      // ✅ group players (BD: coach_group_players.player_user_id)
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

      // selected coaches on event (BD: club_event_coaches.coach_id)
      const ecRes = await supabase.from("club_event_coaches").select("coach_id").eq("event_id", eventId);
      if (!ecRes.error) setCoachIdsSelected((ecRes.data ?? []).map((r: any) => r.coach_id as string));
      else setCoachIdsSelected([]);

      // selected attendees -> selectedPlayers map
      const eaRes = await supabase.from("club_event_attendees").select("player_id").eq("event_id", eventId);
      const selectedIds = !eaRes.error ? (eaRes.data ?? []).map((r: any) => r.player_id as string) : [];
      setInitialSelectedPlayerIds(selectedIds);

      const defaultSelected: Record<string, ProfileLite> = {};
      plList.forEach((p) => {
        if (selectedIds.includes(p.id)) defaultSelected[p.id] = p;
      });
      setSelectedPlayers(defaultSelected);

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setGroup(null);
      setClubName("");
      setEvent(null);
      setSeries(null);
      setCoaches([]);
      setPlayers([]);
      setCoachIdsSelected([]);
      setSelectedPlayers({});
      setInitialSelectedPlayerIds([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const playerIdsSelected = useMemo(() => Object.keys(selectedPlayers), [selectedPlayers]);

  const playersAddedOnSave = useMemo(() => {
    const initial = new Set(initialSelectedPlayerIds);
    return playerIdsSelected.filter((id) => !initial.has(id));
  }, [initialSelectedPlayerIds, playerIdsSelected]);

  const playersRemovedOnSave = useMemo(() => {
    const current = new Set(playerIdsSelected);
    return initialSelectedPlayerIds.filter((id) => !current.has(id));
  }, [initialSelectedPlayerIds, playerIdsSelected]);

  async function syncPlayerChangesOnFuturePlannedEvents() {
    if (!groupId) return;
    if (playersAddedOnSave.length === 0 && playersRemovedOnSave.length === 0) return;

    const nowIso = new Date().toISOString();
    const futureRes = await supabase
      .from("club_events")
      .select("id")
      .eq("group_id", groupId)
      .eq("status", "scheduled")
      .gte("starts_at", nowIso);

    if (futureRes.error) throw new Error(futureRes.error.message);

    const futureEventIds = ((futureRes.data ?? []) as Array<{ id: string }>)
      .map((r) => String(r.id ?? ""))
      .filter(Boolean);
    if (futureEventIds.length === 0) return;

    if (playersAddedOnSave.length > 0) {
      const addRows = futureEventIds.flatMap((eid) =>
        playersAddedOnSave.map((pid) => ({ event_id: eid, player_id: pid, status: "expected" }))
      );

      const addRes = await supabase
        .from("club_event_attendees")
        .upsert(addRows, { onConflict: "event_id,player_id", ignoreDuplicates: true });

      if (addRes.error) throw new Error(addRes.error.message);
    }

    if (playersRemovedOnSave.length > 0) {
      const delRes = await supabase
        .from("club_event_attendees")
        .delete()
        .in("event_id", futureEventIds)
        .in("player_id", playersRemovedOnSave);

      if (delRes.error) throw new Error(delRes.error.message);
    }
  }

  const canSaveOccurrence = useMemo(() => {
    if (busy || loading) return false;
    if (!event) return false;
    if (!startsAtLocal) return false;
    return true;
  }, [busy, loading, event, startsAtLocal]);

  const canSaveSeries = useMemo(() => {
    if (busy || loading) return false;
    if (!event?.series_id) return false;
    if (!series) return false;
    if (!startDate || !endDate) return false;
    if (endDate < startDate) return false;
    if (!timeOfDay) return false;
    if (intervalWeeks < 1) return false;
    return true;
  }, [busy, loading, event?.series_id, series, startDate, endDate, timeOfDay, intervalWeeks]);

  async function saveOccurrenceOnly() {
    if (!event) return;
    setBusy(true);
    setError(null);

    try {
      const dt = new Date(startsAtLocal);
      if (Number.isNaN(dt.getTime())) throw new Error("Date/heure invalide.");

      const upd = await supabase
        .from("club_events")
        .update({
          starts_at: dt.toISOString(),
          duration_minutes: durationMinutes,
          location_text: locationText.trim() || null,
        })
        .eq("id", eventId);

      if (upd.error) throw new Error(upd.error.message);

      // replace coaches
      const delC = await supabase.from("club_event_coaches").delete().eq("event_id", eventId);
      if (delC.error) throw new Error(delC.error.message);
      if (coachIdsSelected.length > 0) {
        const insC = await supabase
          .from("club_event_coaches")
          .insert(coachIdsSelected.map((cid) => ({ event_id: eventId, coach_id: cid })));
        if (insC.error) throw new Error(insC.error.message);
      }

      // replace attendees
      const delA = await supabase.from("club_event_attendees").delete().eq("event_id", eventId);
      if (delA.error) throw new Error(delA.error.message);
      if (playerIdsSelected.length > 0) {
        const insA = await supabase
          .from("club_event_attendees")
          .insert(playerIdsSelected.map((pid) => ({ event_id: eventId, player_id: pid, status: "expected" })));
        if (insA.error) throw new Error(insA.error.message);
      }

      await syncPlayerChangesOnFuturePlannedEvents();

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning/${eventId}`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur sauvegarde.");
      setBusy(false);
    }
  }

  async function saveSeriesAndRegenerateFuture() {
    if (!event?.series_id || !series || !group) return;

    const ok = window.confirm(
      "Mettre à jour la récurrence ?\n\n⚠️ Cela va supprimer toutes les occurrences FUTURES de cette récurrence (à partir d’aujourd’hui), puis les recréer avec les nouveaux paramètres."
    );
    if (!ok) return;

    setBusy(true);
    setError(null);

    try {
      if (!startDate || !endDate) throw new Error("Dates de la récurrence manquantes.");
      if (endDate < startDate) throw new Error("La date de fin doit être après la date de début.");

      // 1) update series template
      const updS = await supabase
        .from("club_event_series")
        .update({
          weekday,
          time_of_day: timeOfDay.length === 5 ? `${timeOfDay}:00` : timeOfDay,
          interval_weeks: intervalWeeks,
          start_date: startDate,
          end_date: endDate,
          duration_minutes: durationMinutes,
          location_text: locationText.trim() || null,
          is_active: seriesActive,
        })
        .eq("id", event.series_id);

      if (updS.error) throw new Error(updS.error.message);

      // 2) delete future occurrences for this series
      const nowIso = new Date().toISOString();
      const delFuture = await supabase
        .from("club_events")
        .delete()
        .eq("series_id", event.series_id)
        .gte("starts_at", nowIso);

      if (delFuture.error) throw new Error(delFuture.error.message);

      // 3) regenerate occurrences (cap 80)
      const startLocal = new Date(`${startDate}T00:00:00`);
      const endLocal = new Date(`${endDate}T23:59:59`);

      let cursor = nextWeekdayOnOrAfter(startLocal, weekday);
      let count = 0;

      const occurrences: any[] = [];
      while (cursor <= endLocal) {
        const dt = combineDateAndTime(toYMD(cursor), timeOfDay);
        const startsIso = dt.toISOString();

        if (startsIso >= nowIso) {
          occurrences.push({
            group_id: group.id,
            club_id: group.club_id,
            starts_at: startsIso,
            duration_minutes: durationMinutes,
            location_text: locationText.trim() || null,
            series_id: event.series_id,
            created_by: meId || series.created_by,
          });

          count += 1;
          if (count >= 80) break;
        }

        cursor = addDays(cursor, intervalWeeks * 7);
      }

      if (seriesActive && occurrences.length === 0) {
        throw new Error("Aucune occurrence future générée (vérifie dates/jour/heure).");
      }

      let createdEventIds: string[] = [];
      if (seriesActive && occurrences.length > 0) {
        const eIns = await supabase.from("club_events").insert(occurrences).select("id");
        if (eIns.error) throw new Error(eIns.error.message);
        createdEventIds = (eIns.data ?? []).map((r: any) => r.id as string);
      }

      // 4) apply coaches/attendees to regenerated events
      if (seriesActive && createdEventIds.length > 0) {
        if (coachIdsSelected.length > 0) {
          const coachRows = createdEventIds.flatMap((eid) =>
            coachIdsSelected.map((cid) => ({ event_id: eid, coach_id: cid }))
          );
          const cIns = await supabase.from("club_event_coaches").insert(coachRows);
          if (cIns.error) throw new Error(cIns.error.message);
        }

        if (playerIdsSelected.length > 0) {
          const attRows = createdEventIds.flatMap((eid) =>
            playerIdsSelected.map((pid) => ({ event_id: eid, player_id: pid, status: "expected" }))
          );
          const aIns = await supabase.from("club_event_attendees").insert(attRows);
          if (aIns.error) throw new Error(aIns.error.message);
        }
      }

      await syncPlayerChangesOnFuturePlannedEvents();

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur mise à jour récurrence.");
      setBusy(false);
    }
  }

  async function removeThisEvent() {
    const ok = window.confirm("Supprimer CET entraînement planifié ? (irréversible)");
    if (!ok) return;

    setBusy(true);
    setError(null);

    const del = await supabase.from("club_events").delete().eq("id", eventId);
    if (del.error) setError(del.error.message);

    setBusy(false);
    router.push(`/coach/groups/${groupId}/planning`);
  }

  async function removeWholeSeries() {
    if (!event?.series_id) return;

    const ok = window.confirm(
      "Supprimer la RÉCURRENCE entière ?\n\n⚠️ Cela supprime la série + toutes ses occurrences (passées et futures)."
    );
    if (!ok) return;

    setBusy(true);
    setError(null);

    try {
      const delEvents = await supabase.from("club_events").delete().eq("series_id", event.series_id);
      if (delEvents.error) throw new Error(delEvents.error.message);

      const delSeries = await supabase.from("club_event_series").delete().eq("id", event.series_id);
      if (delSeries.error) throw new Error(delSeries.error.message);

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur suppression récurrence.");
      setBusy(false);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Modifier — {group?.name ?? "Groupe"}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                Club: {clubName || "Club"}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                Retour
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : !event ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <>
                {/* Scope switch if recurring */}
                {event.series_id ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setEditScope("occurrence")}
                      style={
                        editScope === "occurrence"
                          ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
                          : {}
                      }
                    >
                      Cette occurrence
                    </button>

                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !series}
                      onClick={() => setEditScope("series")}
                      style={
                        editScope === "series"
                          ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
                          : {}
                      }
                    >
                      <Repeat size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                      Récurrence
                    </button>

                    <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      ℹ️ Récurrence = supprime & recrée les occurrences futures
                    </div>
                  </div>
                ) : null}

                <div className="hr-soft" />

                {/* OCCURRENCE */}
                {editScope === "occurrence" ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div className="grid-2">
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Date & heure</span>
                        <input
                          type="datetime-local"
                          value={startsAtLocal}
                          onChange={(e) => setStartsAtLocal(e.target.value)}
                          disabled={busy}
                        />
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Durée</span>
                        <select
                          value={durationMinutes}
                          onChange={(e) => setDurationMinutes(Number(e.target.value))}
                          disabled={busy}
                        >
                          {[45, 60, 75, 90, 105, 120].map((m) => (
                            <option key={m} value={m}>
                              {m} min
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Lieu (optionnel)</span>
                      <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
                    </label>
                  </div>
                ) : null}

                {/* SERIES */}
                {editScope === "series" ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {!series ? (
                      <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                        Série introuvable. Tu peux modifier l’occurrence uniquement.
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
                            <input
                              type="time"
                              value={timeOfDay}
                              onChange={(e) => setTimeOfDay(e.target.value)}
                              disabled={busy}
                            />
                          </label>
                        </div>

                        <div className="grid-2">
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Du</span>
                            <input
                              type="date"
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              disabled={busy}
                            />
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Au</span>
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              disabled={busy}
                            />
                          </label>
                        </div>

                        <div className="grid-2">
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Durée</span>
                            <select
                              value={durationMinutes}
                              onChange={(e) => setDurationMinutes(Number(e.target.value))}
                              disabled={busy}
                            >
                              {[45, 60, 75, 90, 105, 120].map((m) => (
                                <option key={m} value={m}>
                                  {m} min
                                </option>
                              ))}
                            </select>
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Rythme</span>
                            <select
                              value={intervalWeeks}
                              onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                              disabled={busy}
                            >
                              {[1, 2, 3, 4].map((w) => (
                                <option key={w} value={w}>
                                  Toutes les {w} semaine{w > 1 ? "s" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>Lieu (optionnel)</span>
                          <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
                        </label>

                        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900 }}>
                          <input
                            type="checkbox"
                            checked={seriesActive}
                            onChange={(e) => setSeriesActive(e.target.checked)}
                            disabled={busy}
                          />
                          Récurrence active
                        </label>

                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          ⚠️ En enregistrant, on supprime toutes les occurrences futures de cette récurrence et on les recrée (max 80).
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="hr-soft" />

                {/* Coaches */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>Coachs</div>
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
                          {nameOf(c.first_name, c.last_name)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Players — SAME DESIGN AS PLANNING PAGE */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
                    Joueurs attendus
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
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                        Aucun joueur dans ce groupe.
                      </div>
                    ) : selectedPlayersList.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                        Aucun joueur sélectionné.
                      </div>
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

                {/* Save */}
                {editScope === "occurrence" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={!canSaveOccurrence}
                    onClick={saveOccurrenceOnly}
                    style={{ width: "100%", background: "var(--green-dark)", borderColor: "var(--green-dark)", color: "#fff" }}
                  >
                    {busy ? "Enregistrement…" : "Enregistrer cette occurrence"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={!canSaveSeries}
                    onClick={saveSeriesAndRegenerateFuture}
                    style={{ width: "100%", background: "var(--green-dark)", borderColor: "var(--green-dark)", color: "#fff" }}
                  >
                    {busy ? "Enregistrement…" : "Enregistrer la récurrence (futur)"}
                  </button>
                )}

                {/* Delete */}
                <button
                  type="button"
                  className="btn btn-danger soft"
                  disabled={busy}
                  onClick={removeThisEvent}
                  style={{ width: "100%" }}
                >
                  <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                  Supprimer cette occurrence
                </button>

                {event.series_id ? (
                  <button
                    type="button"
                    className="btn btn-danger soft"
                    disabled={busy}
                    onClick={removeWholeSeries}
                    style={{ width: "100%" }}
                  >
                    <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                    Supprimer la récurrence entière
                  </button>
                ) : null}
              </>
            )}
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
