"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Repeat, CalendarPlus, Search } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { supabase } from "@/lib/supabaseClient";

type EventType = "training" | "interclub" | "camp" | "session" | "event";
type CreateMode = "single" | "series";

type ClubLite = { id: string; name: string | null };
type GroupLite = {
  id: string;
  name: string | null;
  club_id: string;
  head_coach_name: string | null;
};
type UserLite = { id: string; club_id: string; name: string };

type CreateDataResponse = {
  clubs: ClubLite[];
  groups: GroupLite[];
  players: UserLite[];
  coaches: UserLite[];
  group_players?: Array<{ group_id: string; player_id: string }>;
  group_coaches?: Array<{ group_id: string; coach_id: string }>;
};

const EVENT_TYPES: Array<{ value: EventType; fr: string; en: string }> = [
  { value: "training", fr: "Entraînement", en: "Training" },
  { value: "interclub", fr: "Interclub", en: "Interclub" },
  { value: "camp", fr: "Stage/Camp", en: "Camp" },
  { value: "session", fr: "Séance", en: "Session" },
  { value: "event", fr: "Événement", en: "Event" },
];

function nowLocalDatetime() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ymdToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function quarterHourOptions() {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) out.push(`${pad(h)}:${pad(m)}`);
  }
  return out;
}

const QUARTER_HOURS = quarterHourOptions();

function splitLocalDateTime(localDateTime: string) {
  const [d = "", t = ""] = String(localDateTime ?? "").split("T");
  return {
    date: d,
    time: t.slice(0, 5),
  };
}

function withLocalDate(localDateTime: string, nextDate: string) {
  const { time } = splitLocalDateTime(localDateTime);
  const safeTime = time || "00:00";
  return `${nextDate}T${safeTime}`;
}

function withLocalTime(localDateTime: string, nextTime: string) {
  const { date } = splitLocalDateTime(localDateTime);
  const safeDate = date || ymdToday();
  return `${safeDate}T${nextTime}`;
}

function SearchablePicker({
  label,
  options,
  selected,
  onToggle,
  disabled,
  placeholder,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 80);
  }, [options, query]);

  return (
    <div
      style={{
        padding: 12,
        display: "grid",
        gap: 8,
        border: "1px solid rgba(0,0,0,0.10)",
        borderRadius: 12,
        background: "rgba(255,255,255,0.95)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 900 }}>{label}</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #ddd", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          style={{ border: 0, outline: "none", width: "100%", background: "transparent", padding: 0 }}
        />
      </label>
      <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 6 }}>
        {filtered.map((o) => (
          <label key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={selected.has(o.id)} onChange={() => onToggle(o.id)} disabled={disabled} />
            <span>{o.label}</span>
          </label>
        ))}
        {filtered.length === 0 ? <div style={{ fontSize: 12, color: "#666" }}>Aucun résultat</div> : null}
      </div>
    </div>
  );
}

export default function ManagerEventCreatePage() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clubs, setClubs] = useState<ClubLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [players, setPlayers] = useState<UserLite[]>([]);
  const [coaches, setCoaches] = useState<UserLite[]>([]);

  const [mode, setMode] = useState<CreateMode>("single");
  const [eventType, setEventType] = useState<EventType>("training");
  const [title, setTitle] = useState("");
  const [locationText, setLocationText] = useState("");
  const [coachNote, setCoachNote] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);

  const [startsAtLocal, setStartsAtLocal] = useState(nowLocalDatetime());
  const [endsAtLocal, setEndsAtLocal] = useState(() => {
    const s = new Date(nowLocalDatetime());
    s.setHours(s.getHours() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}T${pad(s.getHours())}:${pad(s.getMinutes())}`;
  });

  const [weekday, setWeekday] = useState(2);
  const [timeOfDay, setTimeOfDay] = useState("18:00");
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [startDate, setStartDate] = useState(ymdToday());
  const [endDate, setEndDate] = useState(toYMD(addDays(new Date(), 60)));

  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [selectedCoachIds, setSelectedCoachIds] = useState<Set<string>>(new Set());
  const [directSupportGroupId, setDirectSupportGroupId] = useState("");
  const [groupPlayersLinks, setGroupPlayersLinks] = useState<Array<{ group_id: string; player_id: string }>>([]);
  const [groupCoachesLinks, setGroupCoachesLinks] = useState<Array<{ group_id: string; coach_id: string }>>([]);
  const [openTargets, setOpenTargets] = useState<Record<"groups" | "players" | "coaches", boolean>>({
    groups: false,
    players: false,
    coaches: false,
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error(tr("Session invalide.", "Invalid session."));

        const res = await fetch("/api/manager/events/create", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as Partial<CreateDataResponse> & { error?: string };
        if (!res.ok) throw new Error(String(json.error ?? tr("Chargement impossible.", "Load failed.")));

        const g = Array.isArray(json.groups) ? json.groups : [];
        setClubs(Array.isArray(json.clubs) ? json.clubs : []);
        setGroups(g);
        setPlayers(Array.isArray(json.players) ? json.players : []);
        setCoaches(Array.isArray(json.coaches) ? json.coaches : []);
        setGroupPlayersLinks(Array.isArray(json.group_players) ? json.group_players : []);
        setGroupCoachesLinks(Array.isArray(json.group_coaches) ? json.group_coaches : []);
        setSelectedGroupIds(new Set());
        setSelectedPlayerIds(new Set());
        setSelectedCoachIds(new Set());
      } catch (e: any) {
        setError(e?.message ?? tr("Erreur inattendue.", "Unexpected error."));
      } finally {
        setLoading(false);
      }
    })();
  }, [locale]);

  const groupOptions = useMemo(
    () =>
      groups
        .map((g) => ({
          id: g.id,
          label: `${g.name ?? tr("Groupe", "Group")}${g.head_coach_name ? ` (${g.head_coach_name})` : ""}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr-CH")),
    [groups, tr]
  );

  const playerOptions = useMemo(() => players.map((p) => ({ id: p.id, label: p.name })), [players]);
  const coachOptions = useMemo(() => coaches.map((p) => ({ id: p.id, label: p.name })), [coaches]);
  const allGroupIds = useMemo(() => groupOptions.map((g) => g.id), [groupOptions]);
  const allPlayerIds = useMemo(() => playerOptions.map((p) => p.id), [playerOptions]);
  const allCoachIds = useMemo(() => coachOptions.map((c) => c.id), [coachOptions]);

  const playerIdsByGroupId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    groupPlayersLinks.forEach((row) => {
      const gid = String(row.group_id ?? "").trim();
      const pid = String(row.player_id ?? "").trim();
      if (!gid || !pid) return;
      if (!map.has(gid)) map.set(gid, new Set());
      map.get(gid)!.add(pid);
    });
    return map;
  }, [groupPlayersLinks]);

  const coachIdsByGroupId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    groupCoachesLinks.forEach((row) => {
      const gid = String(row.group_id ?? "").trim();
      const cid = String(row.coach_id ?? "").trim();
      if (!gid || !cid) return;
      if (!map.has(gid)) map.set(gid, new Set());
      map.get(gid)!.add(cid);
    });
    return map;
  }, [groupCoachesLinks]);
  const lockPlayerCoachSelection = selectedGroupIds.size > 0;
  const isDirectSelectionMode = selectedGroupIds.size === 0 && selectedPlayerIds.size > 0 && selectedCoachIds.size > 0;

  const directCompatibleGroupOptions = useMemo(() => {
    if (!isDirectSelectionMode) return [];
    return groupOptions.filter((g) => {
      const groupPlayerIds = playerIdsByGroupId.get(g.id) ?? new Set<string>();
      const groupCoachIds = coachIdsByGroupId.get(g.id) ?? new Set<string>();
      const allPlayersInside = Array.from(selectedPlayerIds).every((pid) => groupPlayerIds.has(pid));
      const allCoachesInside = Array.from(selectedCoachIds).every((cid) => groupCoachIds.has(cid));
      return allPlayersInside && allCoachesInside;
    });
  }, [isDirectSelectionMode, groupOptions, playerIdsByGroupId, coachIdsByGroupId, selectedPlayerIds, selectedCoachIds]);

  useEffect(() => {
    const nextPlayers = new Set<string>();
    const nextCoaches = new Set<string>();
    selectedGroupIds.forEach((gid) => {
      (playerIdsByGroupId.get(gid) ?? new Set()).forEach((id) => nextPlayers.add(id));
      (coachIdsByGroupId.get(gid) ?? new Set()).forEach((id) => nextCoaches.add(id));
    });
    setSelectedPlayerIds(nextPlayers);
    setSelectedCoachIds(nextCoaches);
  }, [selectedGroupIds, playerIdsByGroupId, coachIdsByGroupId]);

  useEffect(() => {
    if (!lockPlayerCoachSelection) return;
    setOpenTargets((prev) => ({ ...prev, players: false, coaches: false }));
  }, [lockPlayerCoachSelection]);

  useEffect(() => {
    if (!isDirectSelectionMode) {
      setDirectSupportGroupId("");
      return;
    }
    const exists = directCompatibleGroupOptions.some((g) => g.id === directSupportGroupId);
    if (exists) return;
    setDirectSupportGroupId(directCompatibleGroupOptions[0]?.id ?? "");
  }, [isDirectSelectionMode, directCompatibleGroupOptions, directSupportGroupId]);

  function toggle(setter: (v: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function selectAll(setter: (v: Set<string>) => void, ids: string[]) {
    setter(new Set(ids));
  }

  function clearAll(setter: (v: Set<string>) => void) {
    setter(new Set());
  }

  async function submit() {
    if (saving) return;
    setError(null);

    const groupSelected = selectedGroupIds.size > 0;
    const directPlayerCoachSelection = isDirectSelectionMode;

    if (!groupSelected && !directPlayerCoachSelection) {
      setError(
        tr(
          "Sélectionne au moins un groupe, ou bien au moins un joueur et un coach.",
          "Select at least one group, or at least one player and one coach."
        )
      );
      return;
    }
    if (directPlayerCoachSelection && !directSupportGroupId) {
      setError(
        tr(
          "Choisis un groupe support compatible avec les joueurs et coachs sélectionnés.",
          "Choose a support group compatible with selected players and coaches."
        )
      );
      return;
    }
    if ((eventType === "session" || eventType === "event" || eventType === "camp") && !title.trim()) {
      setError(eventType === "session" ? tr("Nom de la séance requis.", "Session name is required.") : eventType === "camp" ? tr("Nom du stage/camp requis.", "Camp name is required.") : tr("Nom de l’événement requis.", "Event name is required."));
      return;
    }
    if (mode === "series" && endDate < startDate) {
      setError(tr("La date de fin doit être après le début.", "End date must be after start date."));
      return;
    }

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error(tr("Session invalide.", "Invalid session."));

      const targetGroupIds = groupSelected ? Array.from(selectedGroupIds) : [directSupportGroupId];
      const body = {
        mode,
        eventType,
        title: title.trim() || null,
        startsAt: startsAtLocal,
        endsAt: endsAtLocal,
        durationMinutes,
        locationText: locationText.trim() || null,
        coachNote: coachNote.trim() || null,
        series: {
          weekday,
          timeOfDay,
          intervalWeeks,
          startDate,
          endDate,
        },
        groupTarget: {
          mode: "selected",
          ids: targetGroupIds,
        },
        playerTarget: {
          mode: "selected",
          ids: Array.from(selectedPlayerIds),
        },
        coachTarget: {
          mode: "selected",
          ids: Array.from(selectedCoachIds),
        },
        parentTarget: {
          mode: "none",
          ids: [],
        },
      };

      const res = await fetch("/api/manager/events/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        firstEventId?: string | null;
      };
      if (!res.ok) throw new Error(String(json.error ?? tr("Création impossible.", "Could not create events.")));

      if (json.firstEventId) {
        router.push(`/manager/calendar?event=${encodeURIComponent(String(json.firstEventId))}`);
      } else {
        router.push("/manager/calendar");
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? tr("Erreur de création.", "Creation error."));
      setSaving(false);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page" style={{ display: "grid", gap: 14, color: "rgba(17,24,39,1)" }}>
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {tr("Ajouter un événement", "Add event")}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.65)" }}>
                {tr("Manager: création multi-cibles (groupes, joueurs, coachs)", "Manager: multi-target event creation (groups, players, coaches)")}
              </div>
            </div>
            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/manager/calendar">
                {tr("Retour", "Back")}
              </Link>
            </div>
          </div>
          {error ? <div className="marketplace-error">{error}</div> : null}
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={`btn ${mode === "single" ? "btn-active-green" : ""}`} onClick={() => setMode("single")}>
                <CalendarPlus size={14} /> {tr("Unique", "Single")}
              </button>
              <button type="button" className={`btn ${mode === "series" ? "btn-active-green" : ""}`} onClick={() => setMode("series")}>
                <Repeat size={14} /> {tr("Récurrent", "Recurring")}
              </button>
            </div>

            <div className="grid-2">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Type d’événement", "Event type")}</span>
                <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} disabled={saving || loading}>
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {pickLocaleText(locale, t.fr, t.en)}
                    </option>
                  ))}
                </select>
              </label>

              {(eventType === "session" || eventType === "event" || eventType === "camp") ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>
                    {eventType === "session" ? tr("Nom de la séance", "Session name") : eventType === "camp" ? tr("Nom du stage/camp", "Camp name") : tr("Nom de l’événement", "Event name")}
                  </span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving || loading} />
                </label>
              ) : <div />}
            </div>

            {mode === "single" ? (
              <div className="grid-2">
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Début", "Start")}</span>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,170px)", gap: 8 }}>
                    <input
                      type="date"
                      value={splitLocalDateTime(startsAtLocal).date}
                      onChange={(e) => setStartsAtLocal(withLocalDate(startsAtLocal, e.target.value))}
                      disabled={saving || loading}
                    />
                    <select
                      value={splitLocalDateTime(startsAtLocal).time}
                      onChange={(e) => setStartsAtLocal(withLocalTime(startsAtLocal, e.target.value))}
                      disabled={saving || loading}
                    >
                      {QUARTER_HOURS.map((q) => (
                        <option key={`single-start-${q}`} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                {eventType === "training" ? (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Durée (min)", "Duration (min)")}</span>
                    <input type="number" min={15} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))} disabled={saving || loading} />
                  </label>
                ) : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Fin", "End")}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,170px)", gap: 8 }}>
                      <input
                        type="date"
                        value={splitLocalDateTime(endsAtLocal).date}
                        onChange={(e) => setEndsAtLocal(withLocalDate(endsAtLocal, e.target.value))}
                        disabled={saving || loading}
                      />
                      <select
                        value={splitLocalDateTime(endsAtLocal).time}
                        onChange={(e) => setEndsAtLocal(withLocalTime(endsAtLocal, e.target.value))}
                        disabled={saving || loading}
                      >
                        {QUARTER_HOURS.map((q) => (
                          <option key={`single-end-${q}`} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Jour", "Day")}</span>
                    <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={saving || loading}>
                      <option value={1}>{tr("Lundi", "Monday")}</option>
                      <option value={2}>{tr("Mardi", "Tuesday")}</option>
                      <option value={3}>{tr("Mercredi", "Wednesday")}</option>
                      <option value={4}>{tr("Jeudi", "Thursday")}</option>
                      <option value={5}>{tr("Vendredi", "Friday")}</option>
                      <option value={6}>{tr("Samedi", "Saturday")}</option>
                      <option value={0}>{tr("Dimanche", "Sunday")}</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Heure", "Time")}</span>
                    <select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} disabled={saving || loading}>
                      {QUARTER_HOURS.map((q) => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Du", "From")}</span>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={saving || loading} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Au", "To")}</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={saving || loading} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Toutes les X semaines", "Every X weeks")}</span>
                    <input type="number" min={1} max={8} value={intervalWeeks} onChange={(e) => setIntervalWeeks(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} disabled={saving || loading} />
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Durée (min)", "Duration (min)")}</span>
                  <input type="number" min={15} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))} disabled={saving || loading} />
                </label>
              </div>
            )}

            <div className="grid-2">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Lieu", "Location")}</span>
                <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={saving || loading} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Infos logistiques", "Logistics notes")}</span>
                <input value={coachNote} onChange={(e) => setCoachNote(e.target.value)} disabled={saving || loading} />
              </label>
            </div>
          </div>
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 950 }}>{tr("Cibles", "Targets")}</div>

          <div
            style={{
              border: "1px solid rgba(0,0,0,0.10)",
              borderRadius: 14,
              background: "rgba(255,255,255,0.96)",
              padding: 12,
              display: "grid",
              gap: 12,
            }}
          >
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 12,
                background: "rgba(255,255,255,0.94)",
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 900 }}>
                  {tr("Groupes", "Groups")} ({selectedGroupIds.size})
                </div>
                <button type="button" className="btn" onClick={() => setOpenTargets((prev) => ({ ...prev, groups: !prev.groups }))}>
                  {openTargets.groups ? tr("Masquer", "Hide") : tr("Sélectionner", "Select")}
                </button>
              </div>
              {openTargets.groups ? (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn" onClick={() => selectAll(setSelectedGroupIds, allGroupIds)} disabled={loading || saving}>
                      {tr("Tout sélectionner", "Select all")}
                    </button>
                    <button type="button" className="btn" onClick={() => clearAll(setSelectedGroupIds)} disabled={loading || saving}>
                      {tr("Tout désélectionner", "Deselect all")}
                    </button>
                  </div>
                  <SearchablePicker
                    label={tr("Sélection des groupes", "Group selection")}
                    options={groupOptions}
                    selected={selectedGroupIds}
                    onToggle={(id) => toggle(setSelectedGroupIds, selectedGroupIds, id)}
                    placeholder={tr("Rechercher un groupe…", "Search a group…")}
                  />
                </>
              ) : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div
                style={{
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.94)",
                  padding: 10,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>
                    {tr("Joueurs", "Players")} ({selectedPlayerIds.size})
                  </div>
                  <button type="button" className="btn" onClick={() => setOpenTargets((prev) => ({ ...prev, players: !prev.players }))} disabled={lockPlayerCoachSelection}>
                    {openTargets.players ? tr("Masquer", "Hide") : tr("Sélectionner", "Select")}
                  </button>
                </div>
                {lockPlayerCoachSelection ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                    {tr("Sélection automatique depuis les groupes choisis.", "Automatic selection from selected groups.")}
                  </div>
                ) : null}
                {openTargets.players ? (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => selectAll(setSelectedPlayerIds, allPlayerIds)} disabled={loading || saving || lockPlayerCoachSelection}>
                        {tr("Tout sélectionner", "Select all")}
                      </button>
                      <button type="button" className="btn" onClick={() => clearAll(setSelectedPlayerIds)} disabled={loading || saving || lockPlayerCoachSelection}>
                        {tr("Tout désélectionner", "Deselect all")}
                      </button>
                    </div>
                    <SearchablePicker
                      label={tr("Joueurs", "Players")}
                      options={playerOptions}
                      selected={selectedPlayerIds}
                      onToggle={(id) => toggle(setSelectedPlayerIds, selectedPlayerIds, id)}
                      disabled={lockPlayerCoachSelection}
                      placeholder={tr("Rechercher un joueur…", "Search a player…")}
                    />
                  </>
                ) : null}
              </div>

              <div
                style={{
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.94)",
                  padding: 10,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>
                    {tr("Coachs", "Coaches")} ({selectedCoachIds.size})
                  </div>
                  <button type="button" className="btn" onClick={() => setOpenTargets((prev) => ({ ...prev, coaches: !prev.coaches }))} disabled={lockPlayerCoachSelection}>
                    {openTargets.coaches ? tr("Masquer", "Hide") : tr("Sélectionner", "Select")}
                  </button>
                </div>
                {lockPlayerCoachSelection ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                    {tr("Sélection automatique depuis les groupes choisis.", "Automatic selection from selected groups.")}
                  </div>
                ) : null}
                {openTargets.coaches ? (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => selectAll(setSelectedCoachIds, allCoachIds)} disabled={loading || saving || lockPlayerCoachSelection}>
                        {tr("Tout sélectionner", "Select all")}
                      </button>
                      <button type="button" className="btn" onClick={() => clearAll(setSelectedCoachIds)} disabled={loading || saving || lockPlayerCoachSelection}>
                        {tr("Tout désélectionner", "Deselect all")}
                      </button>
                    </div>
                    <SearchablePicker
                      label={tr("Coachs", "Coaches")}
                      options={coachOptions}
                      selected={selectedCoachIds}
                      onToggle={(id) => toggle(setSelectedCoachIds, selectedCoachIds, id)}
                      disabled={lockPlayerCoachSelection}
                      placeholder={tr("Rechercher un coach…", "Search a coach…")}
                    />
                  </>
                ) : null}
              </div>

            </div>
          </div>

          {isDirectSelectionMode ? (
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 12,
                background: "rgba(255,255,255,0.96)",
                padding: 10,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 900 }}>{tr("Groupe support de l’événement", "Event support group")}</div>
              <select
                value={directSupportGroupId}
                onChange={(e) => setDirectSupportGroupId(e.target.value)}
                disabled={saving || loading || directCompatibleGroupOptions.length === 0}
              >
                <option value="">{tr("Veuillez sélectionner", "Please select")}</option>
                {directCompatibleGroupOptions.map((g) => (
                  <option key={`direct-group-${g.id}`} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
              {directCompatibleGroupOptions.length === 0 ? (
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(180,20,20,0.88)" }}>
                  {tr(
                    "Aucun groupe unique ne contient tous les joueurs et coachs sélectionnés.",
                    "No single group contains all selected players and coaches."
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.66)", fontWeight: 800 }}>
            {tr(
              "Note: les événements sont créés par groupe (pour garder la compatibilité calendrier/présences/statistiques).",
              "Note: events are created per group (to keep calendar/attendance/stats compatibility)."
            )}
          </div>
        </div>

        <div className="glass-section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", fontWeight: 800 }}>
            {loading
              ? tr("Chargement des données…", "Loading data…")
              : tr(`${clubs.length} club(s), ${groups.length} groupe(s) disponibles.`, `${clubs.length} club(s), ${groups.length} available group(s).`)}
          </div>
          <button type="button" className="cta-green" onClick={submit} disabled={loading || saving}>
            {saving ? tr("Création en cours…", "Creating…") : tr("Créer l’événement", "Create event")}
          </button>
        </div>
      </div>
    </div>
  );
}
