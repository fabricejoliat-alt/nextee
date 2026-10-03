"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowLeft, Save } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerActivityLabel, managerFormat, managerLocaleTag } from "@/lib/managerLocale";
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

const EVENT_TYPES: EventType[] = ["competition", "training", "interclub", "camp", "session", "event"];
const COMPETITION_LEVEL_OPTIONS: CompetitionLevel[] = ["internal", "club", "regional", "national", "international"];

const COMPETITION_CATEGORY_OPTIONS: Array<{ value: CompetitionCategory; label: string }> = [
  { value: "u10", label: "U10" },
  { value: "u12", label: "U12" },
  { value: "u14", label: "U14" },
  { value: "u16", label: "U16" },
  { value: "u18", label: "U18" },
  { value: "all", label: "Tous" },
];

function nowLocalDatetime() {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
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
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
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
          aria-label={placeholder}
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
        {filtered.length === 0 ? <div style={{ fontSize: 12, color: "#666" }}>{t("manager.activityForm.empty")}</div> : null}
      </div>
    </div>
  );
}

export default function ManagerEventCreatePage() {
  const { locale, t } = useI18n();
  const tr = (key: string) => t(`manager.activityForm.${key}`);
  const fmt = (key: string, values: Record<string, string | number>) => managerFormat(t, `manager.activityForm.${key}`, values);
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingEventId = String(searchParams.get("event") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const inFlight = useRef(false);
  const attempt = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const locked = loading || saving || uncertain || Boolean(savedId) || loadFailed;

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
  const [reminderMessage, setReminderMessage] = useState("");
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
    const version = ++loadVersion.current;
    const controller = new AbortController();
    setLoadFailed(false); setSnapshot(null); setUncertain(false); setSavedId(null); setSaving(false);
    attempt.current = null; inFlight.current = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error("session");

        const res = await fetch("/api/manager/events/create", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store", signal: controller.signal,
        });
        const json = (await res.json().catch(() => ({}))) as Partial<CreateDataResponse> & { error?: string };
        if (!res.ok || !Array.isArray(json.clubs) || !Array.isArray(json.groups) || !Array.isArray(json.players) || !Array.isArray(json.coaches)) throw new Error("load");
        if (version !== loadVersion.current) return;

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
            cache: "no-store", signal: controller.signal,
          });
          const editJson = await editRes.json().catch(() => ({}));
          if (!editRes.ok || !editJson.snapshot || editJson.event?.id !== editingEventId) throw new Error("load");
          if (version !== loadVersion.current) return;
          setSnapshot(editJson.snapshot);
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
          setReminderMessage(String(reminder?.message_template ?? ""));
          setReminderMessageTouched(Boolean(reminder));
        }
      } catch {
        if (version !== loadVersion.current) return;
        setError("load"); setLoadFailed(true);
      } finally {
        if (version === loadVersion.current) setLoading(false);
      }
    })();
    return () => { loadVersion.current = version + 1; controller.abort(); };
  }, [editingEventId]);

  const groupOptions = useMemo(
    () =>
      groups
        .map((g) => ({
          id: g.id,
          label: `${g.name ?? t("manager.activityForm.group")}${g.head_coach_name ? ` (${g.head_coach_name})` : ""}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, managerLocaleTag(locale))),
    [groups, t, locale]
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
          label: `${player.name} · ${age == null ? t("manager.activityForm.birthMissing") : managerFormat(t, "manager.activityForm.age", { age, year })}`,
        };
      });
  }, [players, competitionPlayers, eventType, startsAtLocal, t]);
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
    if (eventType !== "competition" || locked) return;
    setMode("single");
    if (!reminderMessageTouched) setReminderMessage(fmt("reminderDefault", { name: title.trim() || "{competition_name}" }));
  // The default follows the interface language; an edited message remains unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, reminderMessageTouched, title, locale, locked]);

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
    if (inFlight.current || loading || loadFailed || savedId || (editingEventId && uncertain)) return;
    setError(null);

    const groupSelected = selectedGroupIds.size > 0;
    if (!attempt.current) {
      const directPlayerCoachSelection = isDirectSelectionMode;

      if (eventType === "competition") {
        if (!competitionClubId) {
          setError("forbidden");
          return;
        }
        if (!title.trim()) {
          setError("title_required");
          return;
        }
        const competitionStart = splitLocalDateTime(startsAtLocal).date;
        const competitionEnd = splitLocalDateTime(endsAtLocal).date;
        if (!competitionStart || !competitionEnd) {
          setError("invalid_competition_dates");
          return;
        }
        if (competitionEnd < competitionStart) {
          setError("invalid_competition_dates");
          return;
        }
        const yearCheck = competitionTournamentYear(competitionStart, competitionEnd);
        if (yearCheck.error) {
          setError("invalid_competition_dates");
          return;
        }
        if (!isHttpUrl(externalRegistrationUrl)) {
          setError("invalid_competition");
          return;
        }
        if (selectedPlayerIds.size === 0) {
          setError("invalid_assignments");
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
            setError("invalid_reminder");
            return;
          }
          if (!reminderMessage.trim()) {
            setError("invalid_reminder");
            return;
          }
        }
      } else if (!groupSelected && !directPlayerCoachSelection) {
        setError("invalid_assignments");
        return;
      }
      if ((eventType === "session" || eventType === "event" || eventType === "camp") && !title.trim()) {
        setError("title_required");
        return;
      }
      if (mode === "series" && endDate < startDate) {
        setError("invalid_recurrence");
        return;
      }

      if (mode === "single" && eventType !== "competition") {
        const start = new Date(startsAtLocal), end = new Date(endsAtLocal);
        if (!Number.isFinite(start.getTime()) || (eventType !== "training" && (!Number.isFinite(end.getTime()) || end <= start))) { setError("invalid_event"); return; }
      }
      if ((eventType === "training" || mode === "series") && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 300)) { setError("invalid_event"); return; }
    }
    inFlight.current = true;
    const version = loadVersion.current;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("session");

      if (version !== loadVersion.current) return;
      if (!attempt.current) {
        const targetGroupIds = groupSelected ? Array.from(selectedGroupIds) : [];
        const competitionStartDate = splitLocalDateTime(startsAtLocal).date;
        const competitionEndDate = splitLocalDateTime(endsAtLocal).date;
        const body = {
          requestId: crypto.randomUUID(),
          ...(editingEventId ? { snapshot } : {}),
          mode,
          eventType,
          title: title.trim() || null,
          startsAt: eventType === "competition" ? competitionBoundaryIso(competitionStartDate, "start") : mode === "single" ? new Date(startsAtLocal).toISOString() : null,
          endsAt: eventType === "competition" ? competitionBoundaryIso(competitionEndDate, "end") : mode === "single" && eventType !== "training" ? new Date(endsAtLocal).toISOString() : null,
          competitionStartDate: eventType === "competition" ? competitionStartDate : null,
          competitionEndDate: eventType === "competition" ? competitionEndDate : null,
          durationMinutes,
          locationText: locationText.trim() || null,
          coachNote: coachNote.trim() || null,
          requiresEvaluation: ["training", "camp"].includes(eventType) && requiresEvaluation,
          evaluationCriterionIds: ["training", "camp"].includes(eventType) && requiresEvaluation ? evaluationCriterionIds : [],
          competitionClubId: eventType === "competition" ? competitionClubId : null,
          competitionLevel: eventType === "competition" ? competitionLevel : null,
          competitionCategory: eventType === "competition" ? competitionCategory : null,
          externalRegistrationUrl: eventType === "competition" ? externalRegistrationUrl.trim() || null : null,
          competitionNote: eventType === "competition" ? competitionNote.trim() || null : null,
          reminder: {
            enabled: eventType === "competition" && reminderEnabled,
            scheduledFor: eventType === "competition" && reminderEnabled && reminderAtLocal ? new Date(reminderAtLocal).toISOString() : null,
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

        attempt.current = JSON.stringify(body);
      }
      const res = await fetch(
        editingEventId ? `/api/manager/events/${encodeURIComponent(editingEventId)}` : "/api/manager/events/create",
        {
        method: editingEventId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: attempt.current,
      });

      const json = await res.json().catch(() => ({}));
      if (version !== loadVersion.current) return;
      if (!res.ok) {
        if (json.outcome === "rejected" && !uncertain) { attempt.current = null; setUncertain(false); setError(json.error || "invalid_event"); return; }
        throw new Error("unconfirmed");
      }
      if (json.ok !== true || typeof json.firstEventId !== "string" || !json.firstEventId) throw new Error("unconfirmed");
      setSavedId(json.firstEventId); setUncertain(false);
      if (json.notificationWarning || json.replayed) { setError("notification"); return; }
      router.push(`/manager/calendar?event=${encodeURIComponent(json.firstEventId)}`);
      router.refresh();
    } catch {
      if (version !== loadVersion.current) return;
      if (attempt.current) { setUncertain(true); setError(editingEventId ? "editUnconfirmed" : "unconfirmed"); }
      else setError("session");
    } finally {
      if (version === loadVersion.current) { inFlight.current = false; setSaving(false); }
    }
  }

  return (
    <main className={styles.page}>
      <nav aria-label={tr("breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>
        {tr("breadcrumb")}
      </nav>
      <div className={styles.topline}>
        <div>
          <h1>{editingEventId ? tr("editTitle") : tr("title")}</h1>
          {eventType !== "competition" ? (
            <p className={styles.lead}>{tr("lead")}</p>
          ) : null}
        </div>
        <Link className={actionStyles.backButton} href="/manager/calendar"><ArrowLeft size={16} />{tr("back")}</Link>
      </div>
      {savedId ? <Link className={actionStyles.backButton} href={`/manager/calendar?event=${encodeURIComponent(savedId)}`}>{tr("viewSaved")}</Link> : null}
      {error ? <div className={actionStyles.errorAlert} role="alert">{tr(`error.${error}`) === `manager.activityForm.error.${error}` ? tr("error.invalid_request") : tr(`error.${error}`)}</div> : null}
      {loadFailed || ["competition_conflict", "editUnconfirmed", "event_cancelled"].includes(error ?? "") ? <button type="button" className="btn" onClick={() => window.location.reload()}>{tr("reload")}</button> : null}

        <section className={`${styles.quickPanel} manager-activity-form`}>
          <div className={styles.sectionHeading}><div><h2>{tr("details")}</h2><p>{tr("required")}</p></div></div>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("type")}</span>
              <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} disabled={locked || Boolean(editingEventId)}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {managerActivityLabel(t, type)}
                  </option>
                ))}
              </select>
            </label>

            {eventType !== "competition" ? <fieldset style={{ display: "grid", gap: 7, padding: 0, border: 0, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 900, color: "#53675a" }}>{tr("recurrence")}</legend>
              <div className="mode-radio-group" role="radiogroup" aria-label={tr("recurrence")}>
                <label className={`mode-radio-option ${mode === "single" ? "is-active" : ""}`}><input type="radio" disabled={locked} name="event-mode" checked={mode === "single"} onChange={() => setMode("single")} /><span>{tr("single")}</span></label>
                <label className={`mode-radio-option ${mode === "series" ? "is-active" : ""}`}><input type="radio" disabled={locked} name="event-mode" checked={mode === "series"} onChange={() => setMode("series")} /><span>{tr("series")}</span></label>
              </div>
            </fieldset> : null}

            <div className="grid-2">
              {(eventType === "session" || eventType === "event" || eventType === "camp" || eventType === "competition") ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>
                    {eventType === "competition" ? tr("competitionName") : eventType === "session" ? tr("sessionName") : eventType === "camp" ? tr("campName") : tr("eventName")}
                  </span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} required={eventType === "competition"} />
                </label>
              ) : <div />}
            </div>

            {eventType === "competition" && clubs.length > 1 ? <label style={{ display: "grid", gap: 6 }}><span>{tr("club")}</span><select value={competitionClubId} disabled={locked || Boolean(editingEventId)} onChange={event => { setCompetitionClubId(event.target.value); setSelectedCoachIds(new Set()); }} >{clubs.map(club => <option key={club.id} value={club.id}>{club.name || club.id}</option>)}</select></label> : null}
            {eventType === "competition" ? (
              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("level")}</span>
                  <select value={competitionLevel} onChange={(event) => setCompetitionLevel(event.target.value as CompetitionLevel)} disabled={locked}>
                    {COMPETITION_LEVEL_OPTIONS.map((option) => <option key={option} value={option}>{tr(option === "club" ? "clubLevel" : option)}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("category")}</span>
                  <select value={competitionCategory} onChange={(event) => setCompetitionCategory(event.target.value as CompetitionCategory)} disabled={locked}>
                    {COMPETITION_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "all" ? tr("allAges") : option.label}</option>)}
                  </select>
                </label>
              </div>
            ) : null}

            {mode === "single" ? (
              <div className="grid-2">
                <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{eventType === "competition" ? tr("startDate") : tr("start")}</span>
                  <div style={{ display: "grid", gridTemplateColumns: eventType === "competition" ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,170px)", gap: 8 }}>
                    <input
                      type="date"
                      value={splitLocalDateTime(startsAtLocal).date}
                      onChange={(e) => setStartsAtLocal(withLocalDate(startsAtLocal, e.target.value))}
                      disabled={locked}
                    />
                    {eventType !== "competition" ? <select
                      value={splitLocalDateTime(startsAtLocal).time}
                      onChange={(e) => setStartsAtLocal(withLocalTime(startsAtLocal, e.target.value))}
                      disabled={locked}
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
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("duration")}</span>
                    <input type="number" min={15} max={300} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))} disabled={locked} />
                  </label>
                ) : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{eventType === "competition" ? tr("endDate") : tr("end")}</span>
                    <div style={{ display: "grid", gridTemplateColumns: eventType === "competition" ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,170px)", gap: 8 }}>
                      <input
                        type="date"
                        value={splitLocalDateTime(endsAtLocal).date}
                        onChange={(e) => setEndsAtLocal(withLocalDate(endsAtLocal, e.target.value))}
                        disabled={locked}
                      />
                      {eventType !== "competition" ? <select
                        value={splitLocalDateTime(endsAtLocal).time}
                        onChange={(e) => setEndsAtLocal(withLocalTime(endsAtLocal, e.target.value))}
                        disabled={locked}
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
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("day")}</span>
                    <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={locked}>
                      <option value={1}>{tr("monday")}</option>
                      <option value={2}>{tr("tuesday")}</option>
                      <option value={3}>{tr("wednesday")}</option>
                      <option value={4}>{tr("thursday")}</option>
                      <option value={5}>{tr("friday")}</option>
                      <option value={6}>{tr("saturday")}</option>
                      <option value={0}>{tr("sunday")}</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("time")}</span>
                    <select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} disabled={locked}>
                      {QUARTER_HOURS.map((q) => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("from")}</span>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={locked} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("to")}</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={locked} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("interval")}</span>
                    <input type="number" min={1} max={8} value={intervalWeeks} onChange={(e) => setIntervalWeeks(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} disabled={locked} />
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("duration")}</span>
                  <input type="number" min={15} max={300} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))} disabled={locked} />
                </label>
              </div>
            )}

            <div className="grid-2">
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("location")}</span>
                <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={locked} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>{eventType === "competition" ? tr("externalLink") : tr("logistics")}</span>
                {eventType === "competition" ? (
                  <input type="url" inputMode="url" placeholder="https://…" value={externalRegistrationUrl} onChange={(event) => setExternalRegistrationUrl(event.target.value)} disabled={locked} />
                ) : (
                  <input value={coachNote} onChange={(e) => setCoachNote(e.target.value)} disabled={locked} />
                )}
              </label>
            </div>
            {eventType === "competition" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("note")}</span>
                <textarea rows={4} value={competitionNote} onChange={(event) => setCompetitionNote(event.target.value)} disabled={locked} />
              </label>
            ) : ["training", "camp"].includes(eventType) ? <label className="user-mgmt-checkbox-label">
              <input type="checkbox" checked={requiresEvaluation} onChange={(event) => setRequiresEvaluation(event.target.checked)} disabled={locked} />
              <span><b>{tr("evaluation")}</b></span>
            </label> : null}
            {["training", "camp"].includes(eventType) && requiresEvaluation ? (
              evaluationClubId ? <EventCriteriaSelector clubId={evaluationClubId} eventType={eventType} selectedIds={evaluationCriterionIds} onChange={setEvaluationCriterionIds} disabled={locked} /> : <div className={actionStyles.errorAlert}>{tr("criteriaScope")}</div>
            ) : null}
          </div>
        </section>

        {eventType === "competition" ? (
          <section className={styles.quickPanel} style={{ display: "grid", gap: 14 }}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>{tr("reminderTitle")}</h2>
                <p>{tr("reminderHelp")}</p>
              </div>
            </div>
            {reminderLocked ? (
              <div className={actionStyles.successAlert}>{tr("reminderLocked")}</div>
            ) : null}
            <label className="user-mgmt-checkbox-label">
              <input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} disabled={locked || reminderLocked} />
              <span><b>{tr("scheduleReminder")}</b></span>
            </label>
            {reminderEnabled ? (
              <div style={{ display: "grid", gap: 12 }}>
                <fieldset style={{ display: "grid", gap: 7, padding: 0, border: 0, margin: 0 }}>
                  <legend style={{ fontSize: 12, fontWeight: 900, color: "#53675a" }}>{tr("sendDate")}</legend>
                  <div className="mode-radio-group" role="radiogroup" aria-label={tr("reminderDate")}>
                    {([[
                      "1d", "oneDay",
                    ], ["3d", "threeDays"], ["1w", "oneWeek"], ["custom", "customDate"]] as const).map(([value, label]) => (
                      <label key={value} className={`mode-radio-option ${reminderShortcut === value ? "is-active" : ""}`}>
                        <input type="radio" name="reminder-shortcut" checked={reminderShortcut === value} onChange={() => setReminderShortcut(value)} disabled={locked || reminderLocked} />
                        <span>{tr(label)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("sendTime")}</span>
                    <input style={{ minWidth: 0, width: "100%" }} type="datetime-local" value={reminderAtLocal} onChange={(event) => { setReminderShortcut("custom"); setReminderAtLocal(event.target.value); }} disabled={locked || reminderLocked} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("channel")}</span>
                    <select value={reminderChannel} onChange={(event) => setReminderChannel(event.target.value as ReminderChannel)} disabled={locked || reminderLocked}>
                      <option value="in_app">{tr("inApp")}</option>
                      <option value="email">{tr("email")}</option>
                      <option value="both">{tr("both")}</option>
                    </select>
                  </label>
                </div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("reminderText")}</span>
                  <textarea rows={4} value={reminderMessage} onChange={(event) => { setReminderMessageTouched(true); setReminderMessage(event.target.value); }} disabled={locked || reminderLocked} />
                </label>
                <div style={{ fontSize: 11, lineHeight: 1.55, color: "#667268", overflowWrap: "anywhere" }}>
                  {tr("variables")} <code>{"{competition_name}"}</code>, <code>{"{start_date}"}</code>, <code>{"{end_date}"}</code>, <code>{"{level}"}</code>, <code>{"{category}"}</code>, <code>{"{external_registration_url}"}</code>.
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={styles.quickPanel} style={{ display: "grid", gap: 12 }}>
          <div className={styles.sectionHeading}><div><h2>{tr("participants")}</h2><p>{eventType === "competition" ? tr("competitionSelectionHelp") : tr("participantHelp")}</p></div></div>

            {eventType === "competition" ? (
              <div className={actionStyles.successAlert} role="status">
                <b>{fmt(editingEventId ? "savedPlayers" : "autoPlayers", { count: editingEventId ? selectedPlayerIds.size : automaticPlayerIds.size })}</b>{" "}
                <span>{editingEventId ? tr("noRecalculate") : fmt("autoPlayersHelp", { category: competitionCategory === "all" ? tr("allAges") : competitionCategory.toUpperCase(), year: splitLocalDateTime(startsAtLocal).date.slice(0, 4) || "—" })}</span>
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
                  {tr("groups")} ({selectedGroupIds.size})
                </div>
                <button type="button" className="btn" onClick={() => setOpenTargets((prev) => ({ ...prev, groups: !prev.groups }))}>
                  {openTargets.groups ? tr("hide") : tr("select")}
                </button>
              </div>
              {openTargets.groups ? (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn" onClick={() => selectAll(setSelectedGroupIds, allGroupIds)} disabled={locked}>
                      {tr("selectAll")}
                    </button>
                    <button type="button" className="btn" onClick={() => clearAll(setSelectedGroupIds)} disabled={locked}>
                      {tr("clearAll")}
                    </button>
                  </div>
                  <SearchablePicker
                    disabled={locked}
                    label={tr("groupSelection")}
                    options={groupOptions}
                    selected={selectedGroupIds}
                    onToggle={(id) => toggle(setSelectedGroupIds, selectedGroupIds, id)}
                    placeholder={tr("searchGroup")}
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
                    {eventType === "competition" ? tr("finalSelection") : tr("players")} ({selectedPlayerIds.size})
                  </div>
                  <button type="button" className="btn" onClick={() => setOpenTargets((prev) => ({ ...prev, players: !prev.players }))} disabled={locked || lockPlayerCoachSelection}>
                    {openTargets.players ? tr("hide") : tr("select")}
                  </button>
                </div>
                {lockPlayerCoachSelection ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                    {tr("automaticSelection")}
                  </div>
                ) : null}
                {openTargets.players ? (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => selectAll(setSelectedPlayerIds, playerOptions.map((option) => option.id))} disabled={locked || lockPlayerCoachSelection}>
                        {tr("selectAll")}
                      </button>
                      <button type="button" className="btn" onClick={() => clearAll(setSelectedPlayerIds)} disabled={locked || lockPlayerCoachSelection}>
                        {tr("clearAll")}
                      </button>
                    </div>
                    <SearchablePicker
                      label={tr("players")}
                      options={playerOptions}
                      selected={selectedPlayerIds}
                      onToggle={(id) => toggle(setSelectedPlayerIds, selectedPlayerIds, id)}
                      disabled={locked || lockPlayerCoachSelection}
                      placeholder={tr("searchPlayer")}
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
                    {tr("coaches")} ({selectedCoachIds.size}){eventType === "competition" ? tr("optional") : ""}
                  </div>
                  <button type="button" className="btn" onClick={() => setOpenTargets((prev) => ({ ...prev, coaches: !prev.coaches }))} disabled={locked || lockPlayerCoachSelection}>
                    {openTargets.coaches ? tr("hide") : tr("select")}
                  </button>
                </div>
                {lockPlayerCoachSelection ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                    {tr("automaticSelection")}
                  </div>
                ) : null}
                {openTargets.coaches ? (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => selectAll(setSelectedCoachIds, allCoachIds)} disabled={locked || lockPlayerCoachSelection}>
                        {tr("selectAll")}
                      </button>
                      <button type="button" className="btn" onClick={() => clearAll(setSelectedCoachIds)} disabled={locked || lockPlayerCoachSelection}>
                        {tr("clearAll")}
                      </button>
                    </div>
                    <SearchablePicker
                      label={tr("coaches")}
                      options={coachOptions}
                      selected={selectedCoachIds}
                      onToggle={(id) => toggle(setSelectedCoachIds, selectedCoachIds, id)}
                      disabled={locked || lockPlayerCoachSelection}
                      placeholder={tr("searchCoach")}
                    />
                  </>
                ) : null}
              </div>

            </div>
          {isDirectSelectionMode ? <div className={actionStyles.successAlert} role="status">{eventType === "competition" ? tr("competitionUse") : tr("privateGroup")}</div> : null}
        </section>

        <section className={styles.quickPanel} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", fontWeight: 800 }}>
            {loading
              ? tr("loading")
              : fmt("counts", { clubs: clubs.length, groups: groups.length })}
          </div>
          <button type="button" className={actionStyles.primaryButton} onClick={submit} disabled={loading || saving || loadFailed || Boolean(savedId) || Boolean(editingEventId && uncertain)}>
            <Save size={16} />{uncertain && !editingEventId ? tr("verify") : saving ? (editingEventId ? tr("saving") : tr("creating")) : (editingEventId ? tr("save") : tr("create"))}
          </button>
        </section>
    </main>
  );
}
