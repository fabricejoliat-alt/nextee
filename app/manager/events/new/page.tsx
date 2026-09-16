"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, ArrowLeft, Save } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { supabase } from "@/lib/supabaseClient";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import EventCriteriaSelector from "@/components/evaluations/EventCriteriaSelector";
import {
  competitionAgeInYear,
  competitionBoundaryIso,
  competitionTournamentYear,
  isHttpUrl,
  selectCompetitionPlayerIds,
  type CompetitionCategory,
  type CompetitionLevel,
  type ReminderChannel,
} from "@/lib/competitions";

type EventType = "training" | "interclub" | "camp" | "session" | "event" | "competition";
type CreateMode = "single" | "series";

type ClubLite = { id: string; name: string | null };
type GroupLite = {
  id: string;
  name: string | null;
  club_id: string;
  head_coach_name: string | null;
};
type UserLite = { id: string; club_id: string; name: string; birth_date: string | null };

type CreateDataResponse = {
  clubs: ClubLite[];
  groups: GroupLite[];
  players: UserLite[];
  coaches: UserLite[];
  group_players?: Array<{ group_id: string; player_id: string }>;
  group_coaches?: Array<{ group_id: string; coach_id: string }>;
};

const EVENT_TYPES: Array<{ value: EventType; fr: string; en: string }> = [
  { value: "competition", fr: "Compétition", en: "Competition" },
  { value: "training", fr: "Entraînement", en: "Training" },
  { value: "interclub", fr: "Interclub", en: "Interclub" },
  { value: "camp", fr: "Stage/Camp", en: "Camp" },
  { value: "session", fr: "Séance", en: "Session" },
  { value: "event", fr: "Événement", en: "Event" },
];

const COMPETITION_LEVEL_OPTIONS: Array<{ value: CompetitionLevel; label: string }> = [
  { value: "internal", label: "Tournoi interne" },
  { value: "club", label: "Tournoi Club" },
  { value: "regional", label: "Régional" },
  { value: "national", label: "National" },
  { value: "international", label: "International" },
];

const COMPETITION_CATEGORY_OPTIONS: Array<{ value: CompetitionCategory; label: string }> = [
  { value: "u10", label: "U10" },
  { value: "u12", label: "U12" },
  { value: "u14", label: "U14" },
  { value: "u16", label: "U16" },
  { value: "u18", label: "U18" },
  { value: "all", label: "Tous" },
];

const COMPETITION_CATEGORY_LABELS = Object.fromEntries(
  COMPETITION_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CompetitionCategory, string>;

function nowLocalDatetime() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocalDatetime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoToCompetitionDate(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T00:00`;
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

function reminderDateBefore(startDate: string, daysBefore: number) {
  const date = new Date(`${startDate}T09:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - daysBefore);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`;
}

function defaultReminderMessage(name: string) {
  const safeName = name.trim() || "{competition_name}";
  return `Rappel : n’oublie pas de t’inscrire à la compétition “${safeName}” sur la plateforme externe.`;
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
          <label key={o.id} className="user-mgmt-checkbox-label" style={{ fontSize: 12 }}>
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
  const searchParams = useSearchParams();
  const editingEventId = String(searchParams.get("event") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clubs, setClubs] = useState<ClubLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [players, setPlayers] = useState<UserLite[]>([]);
  const [coaches, setCoaches] = useState<UserLite[]>([]);

  const [mode, setMode] = useState<CreateMode>("single");
  const [eventType, setEventType] = useState<EventType>("competition");
  const [title, setTitle] = useState("");
  const [locationText, setLocationText] = useState("");
  const [coachNote, setCoachNote] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [requiresEvaluation, setRequiresEvaluation] = useState(false);
  const [evaluationCriterionIds, setEvaluationCriterionIds] = useState<string[]>([]);
  const [competitionClubId, setCompetitionClubId] = useState("");
  const [competitionLevel, setCompetitionLevel] = useState<CompetitionLevel>("club");
  const [competitionCategory, setCompetitionCategory] = useState<CompetitionCategory>("all");
  const [externalRegistrationUrl, setExternalRegistrationUrl] = useState("");
  const [competitionNote, setCompetitionNote] = useState("");
  const [automaticPlayerIds, setAutomaticPlayerIds] = useState<Set<string>>(new Set());
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderShortcut, setReminderShortcut] = useState<"1d" | "3d" | "1w" | "custom">("3d");
  const [reminderAtLocal, setReminderAtLocal] = useState("");
  const [reminderChannel, setReminderChannel] = useState<ReminderChannel>("in_app");
  const [reminderMessage, setReminderMessage] = useState(defaultReminderMessage(""));
  const [reminderMessageTouched, setReminderMessageTouched] = useState(false);
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);

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
        const loadedClubs = Array.isArray(json.clubs) ? json.clubs : [];
        setClubs(loadedClubs);
        setCompetitionClubId((current) => current || loadedClubs[0]?.id || "");
        setGroups(g);
        setPlayers(Array.isArray(json.players) ? json.players : []);
        setCoaches(Array.isArray(json.coaches) ? json.coaches : []);
        setGroupPlayersLinks(Array.isArray(json.group_players) ? json.group_players : []);
        setGroupCoachesLinks(Array.isArray(json.group_coaches) ? json.group_coaches : []);
        setSelectedGroupIds(new Set());
        setSelectedPlayerIds(new Set());
        setSelectedCoachIds(new Set());

        if (editingEventId) {
          const editRes = await fetch(`/api/manager/events/${encodeURIComponent(editingEventId)}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const editJson = await editRes.json().catch(() => ({}));
          if (!editRes.ok) throw new Error(String(editJson?.error ?? "Chargement de la compétition impossible."));
          const event = editJson.event ?? {};
          setEventType("competition");
          setMode("single");
          setTitle(String(event.title ?? ""));
          setCompetitionClubId(String(event.club_id ?? ""));
          setCompetitionLevel(String(event.competition_level ?? "club") as CompetitionLevel);
          setCompetitionCategory(String(event.competition_category ?? "all") as CompetitionCategory);
          setStartsAtLocal(isoToCompetitionDate(String(event.starts_at)));
          setEndsAtLocal(isoToCompetitionDate(String(event.ends_at)));
          setLocationText(String(event.location_text ?? ""));
          setExternalRegistrationUrl(String(event.external_registration_url ?? ""));
          setCompetitionNote(String(event.competition_note ?? ""));
          const savedPlayerIds = Array.isArray(editJson.player_ids) ? editJson.player_ids.map(String) : [];
          setSelectedPlayerIds(new Set(savedPlayerIds));
          setAutomaticPlayerIds(new Set());
          setSelectedCoachIds(new Set(Array.isArray(editJson.coach_ids) ? editJson.coach_ids.map(String) : []));
          const reminder = editJson.reminder ?? null;
          setReminderEnabled(Boolean(reminder));
          setReminderStatus(reminder ? String(reminder.status ?? "pending") : null);
          setReminderShortcut("custom");
          setReminderAtLocal(reminder?.scheduled_for ? isoToLocalDatetime(String(reminder.scheduled_for)) : "");
          setReminderChannel(String(reminder?.channel ?? "in_app") as ReminderChannel);
          setReminderMessage(String(reminder?.message_template ?? defaultReminderMessage(String(event.title ?? ""))));
          setReminderMessageTouched(Boolean(reminder));
        }
      } catch (e: any) {
        setError(e?.message ?? tr("Erreur inattendue.", "Unexpected error."));
      } finally {
        setLoading(false);
      }
    })();
  }, [locale, editingEventId]);

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

  const competitionPlayers = useMemo(
    () => players.filter((player) => player.club_id === competitionClubId),
    [players, competitionClubId],
  );
  const playerOptions = useMemo(() => {
    const source = eventType === "competition" ? competitionPlayers : players;
    const seen = new Set<string>();
    return source
      .filter((player) => {
        if (seen.has(player.id)) return false;
        seen.add(player.id);
        return true;
      })
      .map((player) => {
        if (eventType !== "competition") return { id: player.id, label: player.name };
        const year = Number(splitLocalDateTime(startsAtLocal).date.slice(0, 4));
        const age = competitionAgeInYear(player.birth_date, year);
        return {
          id: player.id,
          label: `${player.name}${age == null ? " · date de naissance non renseignée" : ` · ${age} ans en ${year}`}`,
        };
      });
  }, [players, competitionPlayers, eventType, startsAtLocal]);
  const coachOptions = useMemo(() => {
    const source = eventType === "competition"
      ? coaches.filter((coach) => coach.club_id === competitionClubId)
      : coaches;
    const seen = new Set<string>();
    return source.filter((coach) => {
      if (seen.has(coach.id)) return false;
      seen.add(coach.id);
      return true;
    }).map((coach) => ({ id: coach.id, label: coach.name }));
  }, [coaches, competitionClubId, eventType]);
  const allGroupIds = useMemo(() => groupOptions.map((g) => g.id), [groupOptions]);
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
  const lockPlayerCoachSelection = eventType !== "competition" && selectedGroupIds.size > 0;
  const isDirectSelectionMode = selectedGroupIds.size === 0 && selectedPlayerIds.size > 0 && (selectedCoachIds.size > 0 || eventType === "competition");
  const evaluationClubId = useMemo(() => {
    const ids = new Set<string>();
    if (selectedGroupIds.size) groups.filter((group) => selectedGroupIds.has(group.id)).forEach((group) => ids.add(group.club_id));
    else players.filter((player) => selectedPlayerIds.has(player.id)).forEach((player) => ids.add(player.club_id));
    return ids.size === 1 ? Array.from(ids)[0] : "";
  }, [groups, players, selectedGroupIds, selectedPlayerIds]);

  useEffect(() => {
    if (eventType === "competition") return;
    const nextPlayers = new Set<string>();
    const nextCoaches = new Set<string>();
    selectedGroupIds.forEach((gid) => {
      (playerIdsByGroupId.get(gid) ?? new Set()).forEach((id) => nextPlayers.add(id));
      (coachIdsByGroupId.get(gid) ?? new Set()).forEach((id) => nextCoaches.add(id));
    });
    setSelectedPlayerIds(nextPlayers);
    setSelectedCoachIds(nextCoaches);
  }, [selectedGroupIds, playerIdsByGroupId, coachIdsByGroupId, eventType]);

  useEffect(() => {
    if (eventType !== "competition" || editingEventId) return;
    const startDate = splitLocalDateTime(startsAtLocal).date;
    const endDate = splitLocalDateTime(endsAtLocal).date;
    const yearCheck = competitionTournamentYear(startDate, endDate);
    if (!yearCheck.year) {
      setAutomaticPlayerIds(new Set());
      setSelectedPlayerIds(new Set());
      return;
    }
    const eligible = selectCompetitionPlayerIds(
      competitionPlayers.map((player) => ({ id: player.id, birthDate: player.birth_date })),
      yearCheck.year,
      competitionCategory,
    );
    setAutomaticPlayerIds(new Set(eligible));
    setSelectedPlayerIds(new Set(eligible));
    setSelectedGroupIds(new Set());
  }, [competitionCategory, competitionPlayers, editingEventId, endsAtLocal, eventType, startsAtLocal]);

  useEffect(() => {
    if (eventType !== "competition") return;
    setMode("single");
    if (!reminderMessageTouched) setReminderMessage(defaultReminderMessage(title));
  }, [eventType, reminderMessageTouched, title]);

  useEffect(() => {
    if (eventType !== "competition" || reminderShortcut === "custom") return;
    const startDate = splitLocalDateTime(startsAtLocal).date;
    const days = reminderShortcut === "1d" ? 1 : reminderShortcut === "3d" ? 3 : 7;
    setReminderAtLocal(reminderDateBefore(startDate, days));
  }, [eventType, reminderShortcut, startsAtLocal]);

  const reminderLocked = Boolean(editingEventId && reminderStatus && reminderStatus !== "pending");

  useEffect(() => {
    if (!lockPlayerCoachSelection) return;
    setOpenTargets((prev) => ({ ...prev, players: false, coaches: false }));
  }, [lockPlayerCoachSelection]);

  useEffect(() => {
    if (eventType !== "competition") return;
    setOpenTargets((current) => ({ ...current, groups: false, players: true }));
  }, [eventType]);

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

    if (eventType === "competition") {
      if (!competitionClubId) {
        setError("Aucun club actif n’est disponible pour créer cette compétition.");
        return;
      }
      if (!title.trim()) {
        setError("Le nom de la compétition est obligatoire.");
        return;
      }
      const competitionStart = splitLocalDateTime(startsAtLocal).date;
      const competitionEnd = splitLocalDateTime(endsAtLocal).date;
      if (!competitionStart || !competitionEnd) {
        setError("Les dates de début et de fin sont obligatoires.");
        return;
      }
      if (competitionEnd < competitionStart) {
        setError("La date de fin doit être après la date de début.");
        return;
      }
      const yearCheck = competitionTournamentYear(competitionStart, competitionEnd);
      if (yearCheck.error) {
        setError(yearCheck.error);
        return;
      }
      if (!isHttpUrl(externalRegistrationUrl)) {
        setError("Le lien d’inscription externe doit être une URL HTTP ou HTTPS valide.");
        return;
      }
      if (selectedPlayerIds.size === 0) {
        setError("Sélectionnez au moins un joueur pour afficher la compétition dans son agenda.");
        return;
      }
      if (reminderEnabled && !reminderLocked) {
        const reminderDate = new Date(reminderAtLocal);
        const competitionStartsAt = competitionBoundaryIso(competitionStart, "start");
        if (
          !reminderAtLocal ||
          Number.isNaN(reminderDate.getTime()) ||
          reminderDate.getTime() <= Date.now() ||
          !competitionStartsAt ||
          reminderDate >= new Date(competitionStartsAt)
        ) {
          setError("Le rappel doit être planifié dans le futur et avant le début de la compétition.");
          return;
        }
        if (!reminderMessage.trim()) {
          setError("Le texte du rappel est obligatoire.");
          return;
        }
      }
    } else if (!groupSelected && !directPlayerCoachSelection) {
      setError(
        tr(
          "Sélectionne au moins un groupe, ou bien au moins un joueur et un coach.",
          "Select at least one group, or at least one player and one coach."
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

      const targetGroupIds = groupSelected ? Array.from(selectedGroupIds) : [];
      const competitionStartDate = splitLocalDateTime(startsAtLocal).date;
      const competitionEndDate = splitLocalDateTime(endsAtLocal).date;
      const body = {
        mode,
        eventType,
        title: title.trim() || null,
        startsAt: eventType === "competition" ? competitionBoundaryIso(competitionStartDate, "start") : startsAtLocal,
        endsAt: eventType === "competition" ? competitionBoundaryIso(competitionEndDate, "end") : endsAtLocal,
        competitionStartDate: eventType === "competition" ? competitionStartDate : null,
        competitionEndDate: eventType === "competition" ? competitionEndDate : null,
        durationMinutes,
        locationText: locationText.trim() || null,
        coachNote: coachNote.trim() || null,
        requiresEvaluation,
        evaluationCriterionIds: requiresEvaluation ? evaluationCriterionIds : [],
        competitionClubId: eventType === "competition" ? competitionClubId : null,
        competitionLevel: eventType === "competition" ? competitionLevel : null,
        competitionCategory: eventType === "competition" ? competitionCategory : null,
        externalRegistrationUrl: eventType === "competition" ? externalRegistrationUrl.trim() || null : null,
        competitionNote: eventType === "competition" ? competitionNote.trim() || null : null,
        reminder: {
          enabled: eventType === "competition" && reminderEnabled,
          scheduledFor: reminderEnabled && reminderAtLocal ? new Date(reminderAtLocal).toISOString() : null,
          channel: reminderEnabled ? reminderChannel : null,
          messageTemplate: reminderEnabled ? reminderMessage.trim() : null,
  },
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

      const res = await fetch(
        editingEventId ? `/api/manager/events/${encodeURIComponent(editingEventId)}` : "/api/manager/events/create",
        {
        method: editingEventId ? "PATCH" : "POST",
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
    <main className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>
        {tr("Gestion des activités / Nouvelle activité", "Activity management / New activity")}
      </nav>
      <div className={styles.topline}>
        <div>
          <h1>{editingEventId ? "Modifier la compétition" : tr("Ajouter une activité", "Add activity")}</h1>
          {eventType !== "competition" ? (
            <p className={styles.lead}>{tr("Planifiez une activité pour un ou plusieurs groupes, ou sélectionnez directement les juniors et coachs.", "Plan an activity for one or more groups, or select juniors and coaches directly.")}</p>
          ) : null}
        </div>
        <Link className={actionStyles.backButton} href="/manager/calendar"><ArrowLeft size={16} />{tr("Retour aux activités", "Back to activities")}</Link>
      </div>
      {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}

        <section className={`${styles.quickPanel} manager-activity-form`}>
          <div className={styles.sectionHeading}><div><h2>{tr("Informations de l’activité", "Activity details")}</h2><p>{tr("Les champs marqués d’un astérisque sont requis.", "Fields marked with an asterisk are required.")}</p></div></div>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Type d’activité", "Activity type")}</span>
              <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} disabled={saving || loading || Boolean(editingEventId)}>
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {pickLocaleText(locale, t.fr, t.en)}
                  </option>
                ))}
              </select>
            </label>

            {eventType !== "competition" ? <fieldset style={{ display: "grid", gap: 7, padding: 0, border: 0, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 900, color: "#53675a" }}>{tr("Récurrence", "Recurrence")}</legend>
              <div className="mode-radio-group" role="radiogroup" aria-label={tr("Récurrence", "Recurrence")}>
                <label className={`mode-radio-option ${mode === "single" ? "is-active" : ""}`}><input type="radio" name="event-mode" checked={mode === "single"} onChange={() => setMode("single")} /><span>{tr("Unique", "Single")}</span></label>
                <label className={`mode-radio-option ${mode === "series" ? "is-active" : ""}`}><input type="radio" name="event-mode" checked={mode === "series"} onChange={() => setMode("series")} /><span>{tr("Récurrent", "Recurring")}</span></label>
              </div>
            </fieldset> : null}

            <div className="grid-2">
              {(eventType === "session" || eventType === "event" || eventType === "camp" || eventType === "competition") ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>
                    {eventType === "competition" ? "Nom de la compétition *" : eventType === "session" ? tr("Nom de la séance", "Session name") : eventType === "camp" ? tr("Nom du stage/camp", "Camp name") : tr("Nom de l’événement", "Event name")}
                  </span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving || loading} required={eventType === "competition"} />
                </label>
              ) : <div />}
            </div>

            {eventType === "competition" ? (
              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>Niveau *</span>
                  <select value={competitionLevel} onChange={(event) => setCompetitionLevel(event.target.value as CompetitionLevel)} disabled={saving || loading}>
                    {COMPETITION_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>Catégorie d’âge *</span>
                  <select value={competitionCategory} onChange={(event) => setCompetitionCategory(event.target.value as CompetitionCategory)} disabled={saving || loading}>
                    {COMPETITION_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            ) : null}

            {mode === "single" ? (
              <div className="grid-2">
                <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{eventType === "competition" ? "Date de début *" : tr("Début", "Start")}</span>
                  <div style={{ display: "grid", gridTemplateColumns: eventType === "competition" ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,170px)", gap: 8 }}>
                    <input
                      type="date"
                      value={splitLocalDateTime(startsAtLocal).date}
                      onChange={(e) => setStartsAtLocal(withLocalDate(startsAtLocal, e.target.value))}
                      disabled={saving || loading}
                    />
                    {eventType !== "competition" ? <select
                      value={splitLocalDateTime(startsAtLocal).time}
                      onChange={(e) => setStartsAtLocal(withLocalTime(startsAtLocal, e.target.value))}
                      disabled={saving || loading}
                    >
                      {QUARTER_HOURS.map((q) => (
                        <option key={`single-start-${q}`} value={q}>
                          {q}
                        </option>
                      ))}
                    </select> : null}
                  </div>
                </label>
                {eventType === "training" ? (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Durée (min)", "Duration (min)")}</span>
                    <input type="number" min={15} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))} disabled={saving || loading} />
                  </label>
                ) : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{eventType === "competition" ? "Date de fin *" : tr("Fin", "End")}</span>
                    <div style={{ display: "grid", gridTemplateColumns: eventType === "competition" ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,170px)", gap: 8 }}>
                      <input
                        type="date"
                        value={splitLocalDateTime(endsAtLocal).date}
                        onChange={(e) => setEndsAtLocal(withLocalDate(endsAtLocal, e.target.value))}
                        disabled={saving || loading}
                      />
                      {eventType !== "competition" ? <select
                        value={splitLocalDateTime(endsAtLocal).time}
                        onChange={(e) => setEndsAtLocal(withLocalTime(endsAtLocal, e.target.value))}
                        disabled={saving || loading}
                      >
                        {QUARTER_HOURS.map((q) => (
                          <option key={`single-end-${q}`} value={q}>
                            {q}
                          </option>
                        ))}
                      </select> : null}
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
                <span style={{ fontSize: 12, fontWeight: 900 }}>{eventType === "competition" ? "Lien d’inscription externe" : tr("Infos logistiques", "Logistics notes")}</span>
                {eventType === "competition" ? (
                  <input type="url" inputMode="url" placeholder="https://…" value={externalRegistrationUrl} onChange={(event) => setExternalRegistrationUrl(event.target.value)} disabled={saving || loading} />
                ) : (
                  <input value={coachNote} onChange={(e) => setCoachNote(e.target.value)} disabled={saving || loading} />
                )}
              </label>
            </div>
            {eventType === "competition" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>Remarque / commentaire</span>
                <textarea rows={4} value={competitionNote} onChange={(event) => setCompetitionNote(event.target.value)} disabled={saving || loading} />
              </label>
            ) : <label className="user-mgmt-checkbox-label">
              <input type="checkbox" checked={requiresEvaluation} onChange={(event) => setRequiresEvaluation(event.target.checked)} disabled={saving || loading} />
              <span><b>{tr("Activité à évaluer", "Activity to evaluate")}</b></span>
            </label>}
            {eventType !== "competition" && requiresEvaluation ? (
              evaluationClubId ? <EventCriteriaSelector clubId={evaluationClubId} eventType={eventType} selectedIds={evaluationCriterionIds} onChange={setEvaluationCriterionIds} disabled={saving || loading} /> : <div className={actionStyles.errorAlert}>Sélectionnez des participants d’un seul club pour choisir les critères personnalisés.</div>
            ) : null}
          </div>
        </section>

        {eventType === "competition" ? (
          <section className={styles.quickPanel} style={{ display: "grid", gap: 14 }}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Rappel d’inscription externe</h2>
                <p>Le rappel est envoyé une seule fois aux joueurs sélectionnés et à leurs parents liés.</p>
              </div>
            </div>
            {reminderLocked ? (
              <div className={actionStyles.successAlert}>Ce rappel a déjà été traité ({reminderStatus}) et ne peut plus être modifié.</div>
            ) : null}
            <label className="user-mgmt-checkbox-label">
              <input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} disabled={saving || loading || reminderLocked} />
              <span><b>Programmer un rappel</b></span>
            </label>
            {reminderEnabled ? (
              <div style={{ display: "grid", gap: 12 }}>
                <fieldset style={{ display: "grid", gap: 7, padding: 0, border: 0, margin: 0 }}>
                  <legend style={{ fontSize: 12, fontWeight: 900, color: "#53675a" }}>Date d’envoi</legend>
                  <div className="mode-radio-group" role="radiogroup" aria-label="Date du rappel">
                    {([[
                      "1d", "1 jour avant",
                    ], ["3d", "3 jours avant"], ["1w", "1 semaine avant"], ["custom", "Date personnalisée"]] as const).map(([value, label]) => (
                      <label key={value} className={`mode-radio-option ${reminderShortcut === value ? "is-active" : ""}`}>
                        <input type="radio" name="reminder-shortcut" checked={reminderShortcut === value} onChange={() => setReminderShortcut(value)} disabled={reminderLocked} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>Date et heure d’envoi *</span>
                    <input type="datetime-local" value={reminderAtLocal} onChange={(event) => { setReminderShortcut("custom"); setReminderAtLocal(event.target.value); }} disabled={saving || loading || reminderLocked} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>Canal *</span>
                    <select value={reminderChannel} onChange={(event) => setReminderChannel(event.target.value as ReminderChannel)} disabled={saving || loading || reminderLocked}>
                      <option value="in_app">Notification dans l’application</option>
                      <option value="email">E-mail</option>
                      <option value="both">Notification et e-mail</option>
                    </select>
                  </label>
                </div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>Texte du rappel *</span>
                  <textarea rows={4} value={reminderMessage} onChange={(event) => { setReminderMessageTouched(true); setReminderMessage(event.target.value); }} disabled={saving || loading || reminderLocked} />
                </label>
                <div style={{ fontSize: 11, lineHeight: 1.55, color: "#667268" }}>
                  Variables disponibles : <code>{"{competition_name}"}</code>, <code>{"{start_date}"}</code>, <code>{"{end_date}"}</code>, <code>{"{level}"}</code>, <code>{"{category}"}</code>, <code>{"{external_registration_url}"}</code>.
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={styles.quickPanel} style={{ display: "grid", gap: 12 }}>
          <div className={styles.sectionHeading}><div><h2>{tr("Participants", "Participants")}</h2><p>{eventType === "competition" ? "La catégorie propose automatiquement des joueurs. Vous pouvez ensuite modifier librement la sélection finale." : tr("Choisissez des groupes ou une sélection spécifique de juniors et coachs.", "Choose groups or a specific selection of juniors and coaches.")}</p></div></div>

            {eventType === "competition" ? (
              <div className={actionStyles.successAlert} role="status">
                <b>{editingEventId ? `${selectedPlayerIds.size} joueur${selectedPlayerIds.size > 1 ? "s" : ""} dans la sélection enregistrée` : `${automaticPlayerIds.size} joueur${automaticPlayerIds.size > 1 ? "s" : ""} trouvé${automaticPlayerIds.size > 1 ? "s" : ""} automatiquement`}</b>
                <span>{editingEventId ? ". La catégorie n’est pas recalculée automatiquement après la création." : ` pour ${COMPETITION_CATEGORY_LABELS[competitionCategory]} en ${splitLocalDateTime(startsAtLocal).date.slice(0, 4) || "—"}. Les joueurs sans date de naissance ne sont pas inclus automatiquement.`}</span>
              </div>
            ) : null}

            {eventType !== "competition" ? <div
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
            </div> : null}

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
                    {eventType === "competition" ? "Sélection finale" : tr("Joueurs", "Players")} ({selectedPlayerIds.size})
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
                      <button type="button" className="btn" onClick={() => selectAll(setSelectedPlayerIds, playerOptions.map((option) => option.id))} disabled={loading || saving || lockPlayerCoachSelection}>
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
                    {tr("Coachs", "Coaches")} ({selectedCoachIds.size}){eventType === "competition" ? " · facultatif" : ""}
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
          {isDirectSelectionMode ? <div className={actionStyles.successAlert} role="status">{eventType === "competition" ? "La sélection finale sera figée à la création. Elle sert uniquement à l’agenda et aux notifications, sans inscription ni contrôle de présence dans ActiviTee." : tr("Une sélection spécifique crée automatiquement un groupe privé pour cette activité. Les présences, le calendrier et les évaluations restent ainsi associés à l’activité.", "A specific selection automatically creates a private group for this activity. Attendance, calendar and evaluations remain linked to it.")}</div> : null}
        </section>

        <section className={styles.quickPanel} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", fontWeight: 800 }}>
            {loading
              ? tr("Chargement des données…", "Loading data…")
              : tr(`${clubs.length} club(s), ${groups.length} groupe(s) disponibles.`, `${clubs.length} club(s), ${groups.length} available group(s).`)}
          </div>
          <button type="button" className={actionStyles.primaryButton} onClick={submit} disabled={loading || saving}>
            <Save size={16} />{saving ? (editingEventId ? "Enregistrement…" : tr("Création en cours…", "Creating…")) : (editingEventId ? "Enregistrer la compétition" : tr("Créer l’activité", "Create activity"))}
          </button>
        </section>
    </main>
  );
}
