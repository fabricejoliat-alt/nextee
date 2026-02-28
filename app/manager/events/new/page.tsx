"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Repeat, CalendarPlus, Search } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";

type EventType = "training" | "interclub" | "camp" | "session" | "event";
type TargetMode = "none" | "all" | "selected";
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
  parents: UserLite[];
};

const EVENT_TYPES: Array<{ value: EventType; fr: string; en: string }> = [
  { value: "training", fr: "Entraînement", en: "Training" },
  { value: "interclub", fr: "Interclub", en: "Interclub" },
  { value: "camp", fr: "Stage", en: "Camp" },
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
    <div className="glass-card" style={{ padding: 12, display: "grid", gap: 8 }}>
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
      <div style={{ maxHeight: 180, overflow: "auto", display: "grid", gap: 6 }}>
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
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clubs, setClubs] = useState<ClubLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [players, setPlayers] = useState<UserLite[]>([]);
  const [coaches, setCoaches] = useState<UserLite[]>([]);
  const [parents, setParents] = useState<UserLite[]>([]);

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

  const [groupMode, setGroupMode] = useState<"all" | "selected">("all");
  const [playerMode, setPlayerMode] = useState<TargetMode>("none");
  const [coachMode, setCoachMode] = useState<TargetMode>("none");
  const [parentMode, setParentMode] = useState<TargetMode>("none");

  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [selectedCoachIds, setSelectedCoachIds] = useState<Set<string>>(new Set());
  const [selectedParentIds, setSelectedParentIds] = useState<Set<string>>(new Set());

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
        setParents(Array.isArray(json.parents) ? json.parents : []);
        setSelectedGroupIds(new Set(g.map((it) => it.id)));
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
  const parentOptions = useMemo(() => parents.map((p) => ({ id: p.id, label: p.name })), [parents]);

  function toggle(setter: (v: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function submit() {
    if (saving) return;
    setError(null);

    if (groupMode === "selected" && selectedGroupIds.size === 0) {
      setError(tr("Sélectionne au moins un groupe.", "Select at least one group."));
      return;
    }
    if ((eventType === "session" || eventType === "event") && !title.trim()) {
      setError(eventType === "session" ? tr("Nom de la séance requis.", "Session name is required.") : tr("Nom de l’événement requis.", "Event name is required."));
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
          mode: groupMode,
          ids: Array.from(selectedGroupIds),
        },
        playerTarget: {
          mode: playerMode,
          ids: Array.from(selectedPlayerIds),
        },
        coachTarget: {
          mode: coachMode,
          ids: Array.from(selectedCoachIds),
        },
        parentTarget: {
          mode: parentMode,
          ids: Array.from(selectedParentIds),
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
                {tr("Manager: création multi-cibles (groupes, joueurs, parents, coaches)", "Manager: multi-target event creation (groups, players, parents, coaches)")}
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
                      {locale === "en" ? t.en : t.fr}
                    </option>
                  ))}
                </select>
              </label>

              {(eventType === "session" || eventType === "event") ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>
                    {eventType === "session" ? tr("Nom de la séance", "Session name") : tr("Nom de l’événement", "Event name")}
                  </span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving || loading} />
                </label>
              ) : <div />}
            </div>

            {mode === "single" ? (
              <div className="grid-2">
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Début", "Start")}</span>
                  <input type="datetime-local" value={startsAtLocal} onChange={(e) => setStartsAtLocal(e.target.value)} disabled={saving || loading} />
                </label>
                {eventType === "training" ? (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Durée (min)", "Duration (min)")}</span>
                    <input type="number" min={15} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))} disabled={saving || loading} />
                  </label>
                ) : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Fin", "End")}</span>
                    <input type="datetime-local" value={endsAtLocal} onChange={(e) => setEndsAtLocal(e.target.value)} disabled={saving || loading} />
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

          <div className="glass-card" style={{ padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>{tr("Groupes", "Groups")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={`btn ${groupMode === "all" ? "btn-active-green" : ""}`} onClick={() => setGroupMode("all")}>{tr("Tous les groupes", "All groups")}</button>
              <button type="button" className={`btn ${groupMode === "selected" ? "btn-active-green" : ""}`} onClick={() => setGroupMode("selected")}>{tr("Groupes sélectionnés", "Selected groups")}</button>
            </div>
            {groupMode === "selected" ? (
              <SearchablePicker
                label={tr("Sélection des groupes", "Group selection")}
                options={groupOptions}
                selected={selectedGroupIds}
                onToggle={(id) => toggle(setSelectedGroupIds, selectedGroupIds, id)}
                placeholder={tr("Rechercher un groupe…", "Search a group…")}
              />
            ) : null}
          </div>

          <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}>
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button type="button" className={`btn ${playerMode === "none" ? "btn-active-dark" : ""}`} onClick={() => setPlayerMode("none")}>{tr("Joueurs: aucun", "Players: none")}</button>
                <button type="button" className={`btn ${playerMode === "all" ? "btn-active-green" : ""}`} onClick={() => setPlayerMode("all")}>{tr("Tous", "All")}</button>
                <button type="button" className={`btn ${playerMode === "selected" ? "btn-active-green" : ""}`} onClick={() => setPlayerMode("selected")}>{tr("Sélection", "Select")}</button>
              </div>
              {playerMode === "selected" ? (
                <SearchablePicker
                  label={tr("Joueurs", "Players")}
                  options={playerOptions}
                  selected={selectedPlayerIds}
                  onToggle={(id) => toggle(setSelectedPlayerIds, selectedPlayerIds, id)}
                  placeholder={tr("Rechercher un joueur…", "Search a player…")}
                />
              ) : null}
            </div>

            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button type="button" className={`btn ${coachMode === "none" ? "btn-active-dark" : ""}`} onClick={() => setCoachMode("none")}>{tr("Coaches: défaut groupe", "Coaches: group default")}</button>
                <button type="button" className={`btn ${coachMode === "all" ? "btn-active-green" : ""}`} onClick={() => setCoachMode("all")}>{tr("Tous", "All")}</button>
                <button type="button" className={`btn ${coachMode === "selected" ? "btn-active-green" : ""}`} onClick={() => setCoachMode("selected")}>{tr("Sélection", "Select")}</button>
              </div>
              {coachMode === "selected" ? (
                <SearchablePicker
                  label={tr("Coaches", "Coaches")}
                  options={coachOptions}
                  selected={selectedCoachIds}
                  onToggle={(id) => toggle(setSelectedCoachIds, selectedCoachIds, id)}
                  placeholder={tr("Rechercher un coach…", "Search a coach…")}
                />
              ) : null}
            </div>

            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button type="button" className={`btn ${parentMode === "none" ? "btn-active-dark" : ""}`} onClick={() => setParentMode("none")}>{tr("Parents: aucun", "Parents: none")}</button>
                <button type="button" className={`btn ${parentMode === "all" ? "btn-active-green" : ""}`} onClick={() => setParentMode("all")}>{tr("Tous", "All")}</button>
                <button type="button" className={`btn ${parentMode === "selected" ? "btn-active-green" : ""}`} onClick={() => setParentMode("selected")}>{tr("Sélection", "Select")}</button>
              </div>
              {parentMode === "selected" ? (
                <SearchablePicker
                  label={tr("Parents", "Parents")}
                  options={parentOptions}
                  selected={selectedParentIds}
                  onToggle={(id) => toggle(setSelectedParentIds, selectedParentIds, id)}
                  placeholder={tr("Rechercher un parent…", "Search a parent…")}
                />
              ) : null}
            </div>
          </div>

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
