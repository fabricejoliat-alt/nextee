"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type SessionType = "club" | "private" | "individual";

type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};
type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};

type ClubRow = { id: string; name: string | null };
type ClubMemberRow = { club_id: string };

type ClubEventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type ExistingSessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
};

type ExistingSessionItemRow = {
  category: string;
  minutes: number;
  note: string | null;
};

type ProfileLite = { id: string; first_name: string | null; last_name: string | null };

type CoachOption = {
  id: string;
  label: string;
  roleLabel: string;
  isHead: boolean;
};

const TRAINING_CATEGORY_VALUES = [
  "warmup_mobility",
  "long_game",
  "putting",
  "wedging",
  "pitching",
  "chipping",
  "bunker",
  "course",
  "mental",
  "fitness",
  "other",
] as const;

function buildMinuteOptions() {
  const opts: number[] = [];
  for (let m = 5; m <= 120; m += 5) opts.push(m);
  return opts;
}
const MINUTE_OPTIONS = buildMinuteOptions();

function toLocalDateTimeInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ymdToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeToQuarterHour(localValue: string) {
  if (!localValue) return localValue;
  const dt = new Date(localValue);
  if (Number.isNaN(dt.getTime())) return localValue;

  dt.setSeconds(0, 0);
  const minutes = dt.getMinutes();
  const rounded = Math.round(minutes / 15) * 15;
  dt.setMinutes(rounded);

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function buildQuarterHourOptions() {
  const opts: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) {
      opts.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return opts;
}
const QUARTER_HOUR_OPTIONS = buildQuarterHourOptions();

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export default function PlayerTrainingNewPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();

  const TRAINING_CATEGORIES: { value: string; label: string }[] = useMemo(
    () =>
      TRAINING_CATEGORY_VALUES.map((value) => ({
        value,
        label: t(`cat.${value}`),
      })),
    [t]
  );

  // ✅ support both param names
  const clubEventId = String(sp.get("club_event_id") ?? sp.get("eventId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");

  // clubs
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [clubsById, setClubsById] = useState<Record<string, ClubRow>>({});
  const [clubIdForTraining, setClubIdForTraining] = useState<string>("");

  // fields
  const [startAt, setStartAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return normalizeToQuarterHour(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  });

  const [place, setPlace] = useState<string>("");
  const [sessionType, setSessionType] = useState<SessionType>("individual");
  const [notes, setNotes] = useState<string>("");
  const [motivation, setMotivation] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [satisfaction, setSatisfaction] = useState<string>("");

  // items
  const [items, setItems] = useState<TrainingItemDraft[]>([]);

  // planned event (optional)
  const [linkedEvent, setLinkedEvent] = useState<ClubEventRow | null>(null);
  const [linkedGroupName, setLinkedGroupName] = useState<string>("");
  const [existingSessionId, setExistingSessionId] = useState<string>("");

  // ✅ coaches (planned: display only / non-planned club: checkbox list)
  const [coachOptions, setCoachOptions] = useState<CoachOption[]>([]);
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([]);

  const totalMinutes = useMemo(() => {
    return items.reduce((sum, it) => {
      const v = Number(it.minutes);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [items]);

  const inputsDisabled = busy;
  const isCoachPlannedTraining = Boolean(linkedEvent);
  const showSensationsCard = useMemo(() => {
    const ts = new Date(startAt).getTime();
    return Number.isFinite(ts) && ts < Date.now();
  }, [startAt]);

  const nonPlannedCoachSummary = useMemo(() => {
    if (linkedEvent) return "";
    if (sessionType !== "club") return "";
    if (selectedCoachIds.length === 0) return "";
    const selected = coachOptions.filter((c) => selectedCoachIds.includes(c.id));
    const names = selected.map((c) => c.label).filter(Boolean);
    if (names.length === 0) return "";
    return `${t("common.coach")} : ${names.join(", ")}`;
  }, [linkedEvent, sessionType, coachOptions, selectedCoachIds, t]);

  const coachNameForSave = useMemo(() => {
    // ✅ planned: save read-only summary based on event coaches
    if (linkedEvent) {
      const heads = coachOptions.filter((c) => c.isHead).map((c) => c.label).filter((x) => x && x !== "—");
      const assists = coachOptions.filter((c) => !c.isHead).map((c) => c.label).filter((x) => x && x !== "—");
      const parts: string[] = [];
      if (heads.length) parts.push(`${t("common.coach")}: ${heads.join(", ")}`);
      if (assists.length) parts.push(`${t("trainingNew.extraCoaches")}: ${assists.join(", ")}`);
      return parts.length ? parts.join(" • ") : null;
    }

    // ✅ non-planned club: save chosen coaches
    if (sessionType === "club") {
      if (selectedCoachIds.length === 0) return null;
      const selected = coachOptions.filter((c) => selectedCoachIds.includes(c.id));
      const names = selected.map((c) => c.label).filter((x) => x && x !== "—");
      return names.length > 0 ? names.join(", ") : null;
    }

    // private/individual: none
    return null;
  }, [linkedEvent, sessionType, coachOptions, selectedCoachIds, t]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!userId) return false;
    if (!startAt) return false;
    if (sessionType === "club" && !clubIdForTraining) return false;

    const hasValidLine = items.some((it) => it.category && Number(it.minutes) > 0);
    if (!hasValidLine) return false;

    for (const it of items) {
      if (!it.category) return false;
      if (!it.minutes.trim()) return false;
      const v = Number(it.minutes);
      if (!Number.isFinite(v) || v <= 0 || v > 120) return false;
      if (v % 5 !== 0) return false;
    }

    return true;
  }, [busy, userId, startAt, sessionType, clubIdForTraining, items]);

  const startDate = useMemo(() => {
    if (!startAt.includes("T")) return ymdToday();
    const v = startAt.slice(0, 10);
    return v || ymdToday();
  }, [startAt]);

  const startTime = useMemo(() => {
    if (!startAt.includes("T")) return "18:00";
    const v = startAt.slice(11, 16);
    return QUARTER_HOUR_OPTIONS.includes(v) ? v : "18:00";
  }, [startAt]);

  function updateStartDate(nextDate: string) {
    if (!nextDate) return;
    setStartAt(`${nextDate}T${startTime}`);
  }

  function updateStartTime(nextTime: string) {
    if (!nextTime) return;
    setStartAt(`${startDate}T${nextTime}`);
  }

  async function loadCoachOptionsForPlannedEvent(ev: ClubEventRow): Promise<CoachOption[]> {
  // 1) Try explicit coaches for this event (club_event_coaches)
  const coachesRes = await supabase
    .from("club_event_coaches")
    .select("coach_id")
    .eq("event_id", ev.id);

  let coachIds = uniq((coachesRes.data ?? []).map((r: any) => String(r.coach_id ?? "").trim())).filter(Boolean);

  // 2) Fallback: use group head coach + assistants (if event has no explicit coaches)
  if (coachIds.length === 0) {
    // head coach from coach_groups
    const gRes = await supabase
      .from("coach_groups")
      .select("head_coach_user_id")
      .eq("id", ev.group_id)
      .maybeSingle();

    const headId = String(gRes.data?.head_coach_user_id ?? "").trim();

    // assistants (and possibly also head) from coach_group_coaches
    const gcRes = await supabase
      .from("coach_group_coaches")
      .select("coach_user_id,is_head")
      .eq("group_id", ev.group_id);

    const assistants = (gcRes.data ?? [])
      .filter((r: any) => !Boolean(r.is_head))
      .map((r: any) => String(r.coach_user_id ?? "").trim())
      .filter(Boolean);

    // build final list: head first, then assistants (dedup)
    coachIds = uniq([headId, ...assistants]).filter(Boolean);
  }

  if (coachIds.length === 0) return [];

  // 3) Determine head/assistant flags (best-effort)
  const isHeadById: Record<string, boolean> = {};

  // prefer coach_groups.head_coach_user_id as "head"
  const g2Res = await supabase
    .from("coach_groups")
    .select("head_coach_user_id")
    .eq("id", ev.group_id)
    .maybeSingle();
  const headId2 = String(g2Res.data?.head_coach_user_id ?? "").trim();
  if (headId2) isHeadById[headId2] = true;

  // also read coach_group_coaches flags if present
  const groupRoleRes = await supabase
    .from("coach_group_coaches")
    .select("coach_user_id,is_head")
    .eq("group_id", ev.group_id)
    .in("coach_user_id", coachIds);

  if (!groupRoleRes.error) {
    (groupRoleRes.data ?? []).forEach((r: any) => {
      const id = String(r.coach_user_id ?? "").trim();
      if (!id) return;
      if (Boolean(r.is_head)) isHeadById[id] = true;
      else if (isHeadById[id] === undefined) isHeadById[id] = false;
    });
  }

  // ensure we have at least one head: if none marked, make first one head
  const anyHead = coachIds.some((id) => Boolean(isHeadById[id]));
  if (!anyHead && coachIds[0]) isHeadById[coachIds[0]] = true;

  // 4) Profiles for names
  const pRes = await supabase
    .from("profiles")
    .select("id,first_name,last_name")
    .in("id", coachIds);

  if (pRes.error) return [];

  const byId: Record<string, ProfileLite> = {};
  (pRes.data ?? []).forEach((p: any) => (byId[String(p.id)] = p as ProfileLite));

  // 5) Build options (head first)
  const sorted = [...coachIds].sort((a, b) => Number(Boolean(isHeadById[b])) - Number(Boolean(isHeadById[a])));

    return sorted.map((id) => {
      const p = byId[id];
      const label = p ? nameOf(p.first_name ?? null, p.last_name ?? null) : "—";
      const isHead = Boolean(isHeadById[id]);
      return {
        id,
        label,
        isHead,
        roleLabel: isHead ? t("common.coach") : t("trainingNew.extraCoach"),
      };
    });
}

  async function loadCoachOptionsForNonPlannedClub(clubId: string): Promise<CoachOption[]> {
    // ✅ Entraînement club non lié à un groupe:
    // afficher tous les coachs du club + les head coachs des groupes du club.

    const memRes = await supabase
      .from("club_members")
      .select("user_id,role,is_active")
      .eq("club_id", clubId)
      .eq("is_active", true)
      .eq("role", "coach");

    if (memRes.error) return [];

    const memberCoachIds = uniq((memRes.data ?? []).map((r: any) => String(r.user_id ?? "").trim())).filter(Boolean);

    const grpRes = await supabase
      .from("coach_groups")
      .select("head_coach_user_id")
      .eq("club_id", clubId)
      .eq("is_active", true);

    const headCoachIds = !grpRes.error
      ? uniq((grpRes.data ?? []).map((r: any) => String(r.head_coach_user_id ?? "").trim())).filter(Boolean)
      : [];

    const coachIds = uniq([...memberCoachIds, ...headCoachIds]).filter(Boolean);
    if (coachIds.length === 0) return [];

    const pRes = await supabase.from("profiles").select("id,first_name,last_name").in("id", coachIds);
    if (pRes.error) return [];

    const byId: Record<string, ProfileLite> = {};
    (pRes.data ?? []).forEach((p: any) => {
      byId[String(p.id)] = p as ProfileLite;
    });

    const sorted = [...coachIds].sort((a, b) => {
      const na = nameOf(byId[a]?.first_name ?? null, byId[a]?.last_name ?? null);
      const nb = nameOf(byId[b]?.first_name ?? null, byId[b]?.last_name ?? null);
      return na.localeCompare(nb, "fr");
    });

    return sorted.map((id) => {
      const p = byId[id];
      return {
        id,
        label: p ? nameOf(p.first_name ?? null, p.last_name ?? null) : "—",
        isHead: false,
        roleLabel: t("common.coach"),
      };
    });
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { effectiveUserId: uid } = await resolveEffectivePlayerContext();
      setUserId(uid);

      // memberships
      const memRes = await supabase.from("club_members").select("club_id").eq("user_id", uid).eq("is_active", true);
      if (memRes.error) {
        setError(memRes.error.message);
        setLoading(false);
        return;
      }

      const ids = Array.from(new Set((memRes.data ?? []).map((r: ClubMemberRow) => r.club_id))).filter(Boolean);
      setClubIds(ids);

      // load clubs for memberships
      if (ids.length > 0) {
        const clubsRes = await supabase.from("clubs").select("id,name").in("id", ids);
        if (clubsRes.error) {
          setError(clubsRes.error.message);
          setLoading(false);
          return;
        }

        const map: Record<string, ClubRow> = {};
        for (const c of clubsRes.data ?? []) map[(c as any).id] = c as ClubRow;
        setClubsById(map);

        setClubIdForTraining(ids[0]);
      } else {
        setClubsById({});
        setClubIdForTraining("");
      }

      // If clubEventId provided: load planned club event and prefill
      if (clubEventId) {
        const eRes = await supabase
          .from("club_events")
          .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,status")
          .eq("id", clubEventId)
          .maybeSingle();

        if (eRes.error) {
          setError(eRes.error.message);
        } else if (eRes.data) {
          const ev = eRes.data as ClubEventRow;
          setLinkedEvent(ev);
          setLinkedGroupName("");
          setExistingSessionId("");

          // ✅ force club session
          setSessionType("club");

          // ✅ prefill actual start from planned start
          setStartAt(normalizeToQuarterHour(toLocalDateTimeInputValue(ev.starts_at)));

          // ✅ prefill location
          setPlace(ev.location_text ?? "");

          // ✅ use event club_id
          if (ev.club_id) setClubIdForTraining(ev.club_id);

          // ✅ ensure event club exists in dropdown map (even if not in memberships)
          if (ev.club_id && !clubsById[ev.club_id]) {
            const cRes = await supabase.from("clubs").select("id,name").eq("id", ev.club_id).maybeSingle();
            if (!cRes.error && cRes.data) {
              setClubsById((prev) => ({ ...prev, [ev.club_id]: cRes.data as ClubRow }));
              if (!ids.includes(ev.club_id)) setClubIds((prev) => Array.from(new Set([...prev, ev.club_id])));
            }
          }

          if (ev.group_id) {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token ?? "";
            if (token) {
              const query = new URLSearchParams({
                ids: ev.group_id,
                child_id: uid,
              });
              const gRes = await fetch(`/api/player/group-names?${query.toString()}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              });
              const gJson = await gRes.json().catch(() => ({}));
              const groupName = String((gJson?.groups?.[0]?.name ?? "")).trim();
              if (gRes.ok && groupName) {
                setLinkedGroupName(groupName);
              }
            }
          }

          // ✅ planned coaches: read-only display (head + assistants)
          const opts: CoachOption[] = await loadCoachOptionsForPlannedEvent(ev);
          setCoachOptions(opts);
          setSelectedCoachIds([]); // pas utilisé en planned

          let prefilledFromExistingSession = false;
          const existingSessionRes = await supabase
            .from("training_sessions")
            .select("id,start_at,location_text,motivation,difficulty,satisfaction,notes")
            .eq("user_id", uid)
            .eq("club_event_id", ev.id)
            .order("created_at", { ascending: false })
            .limit(1);

          if (!existingSessionRes.error) {
            const existing = ((existingSessionRes.data ?? [])[0] ?? null) as ExistingSessionRow | null;
            if (existing?.id) {
              setExistingSessionId(existing.id);
              setStartAt(normalizeToQuarterHour(toLocalDateTimeInputValue(existing.start_at)));
              setPlace((existing.location_text ?? ev.location_text ?? "").trim());
              setMotivation(existing.motivation != null ? String(existing.motivation) : "");
              setDifficulty(existing.difficulty != null ? String(existing.difficulty) : "");
              setSatisfaction(existing.satisfaction != null ? String(existing.satisfaction) : "");
              setNotes(existing.notes ?? "");

              const existingItemsRes = await supabase
                .from("training_session_items")
                .select("category,minutes,note")
                .eq("session_id", existing.id)
                .order("created_at", { ascending: true });
              if (!existingItemsRes.error) {
                const existingRows = (existingItemsRes.data ?? []) as ExistingSessionItemRow[];
                if (existingRows.length > 0) {
                  setItems(
                    existingRows.map((r) => ({
                      category: r.category ?? "",
                      minutes: String(r.minutes ?? ""),
                      note: r.note ?? "",
                    }))
                  );
                  prefilledFromExistingSession = true;
                }
              }
            }
          }

          // ✅ prefill structure ("postes") configured by coach on planned event
          if (!prefilledFromExistingSession) {
            const structureRes = await supabase
              .from("club_event_structure_items")
              .select("category,minutes,note,position")
              .eq("event_id", ev.id)
              .order("position", { ascending: true })
              .order("created_at", { ascending: true });

            if (!structureRes.error) {
              const rows = (structureRes.data ?? []) as EventStructureItemRow[];
              if (rows.length > 0) {
                setItems(
                  rows.map((r) => ({
                    category: r.category ?? "",
                    minutes: String(r.minutes ?? ""),
                    note: r.note ?? "",
                  }))
                );
              }
            }
          }

        }
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubEventId]);

  // ✅ when NOT planned: load coaches ONLY if user is creating a "club" training
  useEffect(() => {
    (async () => {
      if (!userId) return;
      if (linkedEvent) return; // planned => coaches already loaded
      if (sessionType !== "club") {
        setCoachOptions([]);
        setSelectedCoachIds([]);
        return;
      }
      if (!clubIdForTraining) {
        setCoachOptions([]);
        setSelectedCoachIds([]);
        return;
      }

      const opts: CoachOption[] = await loadCoachOptionsForNonPlannedClub(clubIdForTraining);
      setCoachOptions(opts);

      // par défaut: sélectionner tout ce qui est dispo
      setSelectedCoachIds((prev) => {
        const allowed = new Set(opts.map((o) => o.id));
        const kept = prev.filter((id) => allowed.has(id));
        return kept.length > 0 ? kept : opts.map((o) => o.id);
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, linkedEvent?.id, sessionType, clubIdForTraining]);

  function addLine() {
    if (inputsDisabled) return;
    setItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeLine(idx: number) {
    if (inputsDisabled) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<TrainingItemDraft>) {
    if (inputsDisabled) return;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function setType(next: SessionType) {
    // if linked to an event: type forced club
    if (linkedEvent) return;

    setSessionType(next);
    if (next === "club" && !clubIdForTraining && clubIds.length > 0) {
      setClubIdForTraining(clubIds[0]);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setBusy(true);
    setError(null);

    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) {
      setError("Date/heure invalide.");
      setBusy(false);
      return;
    }

    const club_id = sessionType === "club" ? clubIdForTraining : null;
    const mot = showSensationsCard && motivation ? Number(motivation) : null;
    const dif = showSensationsCard && difficulty ? Number(difficulty) : null;
    const sat = showSensationsCard && satisfaction ? Number(satisfaction) : null;

    // ✅ if linkedEvent, mark attendee present (UPDATE only)
    if (linkedEvent) {
      const upAtt = await supabase
        .from("club_event_attendees")
        .update({ status: "present" })
        .eq("event_id", linkedEvent.id)
        .eq("player_id", userId);

      if (upAtt.error) {
        setError(upAtt.error.message);
        setBusy(false);
        return;
      }
    }

    const sessionPayload = {
      start_at: dt.toISOString(),
      location_text: (linkedEvent ? (linkedEvent.location_text ?? place) : place).trim() || null,
      session_type: sessionType,
      club_id: linkedEvent ? linkedEvent.club_id : club_id,
      coach_name: coachNameForSave,
      motivation: mot,
      difficulty: dif,
      satisfaction: sat,
      notes: showSensationsCard ? notes.trim() || null : null,
      total_minutes: totalMinutes,
      club_event_id: linkedEvent?.id ?? null,
    };

    let sessionId = "";
    if (linkedEvent && existingSessionId) {
      const updSession = await supabase
        .from("training_sessions")
        .update(sessionPayload)
        .eq("id", existingSessionId)
        .eq("user_id", userId)
        .select("id")
        .single();
      if (updSession.error) {
        setError(updSession.error.message);
        setBusy(false);
        return;
      }
      sessionId = String(updSession.data.id);

      const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
      if (delItems.error) {
        setError(delItems.error.message);
        setBusy(false);
        return;
      }
    } else {
      const insertSession = await supabase
        .from("training_sessions")
        .insert({
          user_id: userId,
          ...sessionPayload,
        })
        .select("id")
        .single();

      if (insertSession.error) {
        setError(insertSession.error.message);
        setBusy(false);
        return;
      }
      sessionId = String(insertSession.data.id);
    }

    const payload = items.map((it) => ({
      session_id: sessionId,
      category: it.category,
      minutes: Number(it.minutes),
      note: it.note.trim() || null,
    }));

    const insertItems = await supabase.from("training_session_items").insert(payload);
    if (insertItems.error) {
      setError(insertItems.error.message);
      setBusy(false);
      return;
    }

    router.push("/player/golf/trainings");
  }

  const showCoachSectionAsCheckboxes = !linkedEvent && sessionType === "club";
  const showCoachSectionPlannedReadOnly = Boolean(linkedEvent);
  const plannedClubName =
    (linkedEvent?.club_id ? clubsById[linkedEvent.club_id]?.name : null) ??
    (clubIdForTraining ? clubsById[clubIdForTraining]?.name : null) ??
    t("common.club");
  const plannedTrainingTypeLabel =
    locale === "fr" ? `Entraînement ${plannedClubName}` : `Training ${plannedClubName}`;
  const infoCardTitle = linkedEvent
    ? `${locale === "fr" ? "Entraînement" : "Training"} • ${linkedGroupName || (locale === "fr" ? "Groupe" : "Group")}`
    : `${t("common.date")} · ${t("common.time")} · ${t("common.place")}`;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {locale === "fr" ? "Éditer un entraînement" : "Edit a training"}
              </div>

              
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings?type=training">
                {t("common.back")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings?type=training">
                {t("trainings.title")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}

          {sessionType === "club" && clubIds.length === 0 && !loading && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
              {t("trainingNew.noActiveClub")}
            </div>
          )}
        </div>

        <div className="glass-section">
          {loading ? (
            <div>{t("common.loading")}</div>
          ) : (
            <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
                <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{infoCardTitle}</div>
                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("common.date")}</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => updateStartDate(e.target.value)}
                        disabled={inputsDisabled || isCoachPlannedTraining}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("common.time")}</span>
                      <select
                        value={startTime}
                        onChange={(e) => updateStartTime(e.target.value)}
                        disabled={inputsDisabled || isCoachPlannedTraining}
                      >
                        {QUARTER_HOUR_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>
                      {t("common.place")} {!linkedEvent ? <span style={{ opacity: 0.7 }}>({t("common.optional")})</span> : null}
                    </span>
                    <input
                      value={place}
                      onChange={(e) => setPlace(e.target.value)}
                      disabled={inputsDisabled || Boolean(linkedEvent)}
                      placeholder={t("trainingNew.placePlaceholder")}
                    />
                  </label>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={fieldLabelStyle}>{t("trainingNew.trainingType")}</div>
                    {linkedEvent ? (
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.70)",
                          padding: "10px 12px",
                          fontSize: 13,
                          fontWeight: 900,
                          color: "rgba(0,0,0,0.80)",
                        }}
                      >
                        {plannedTrainingTypeLabel}
                      </div>
                    ) : (
                      <select
                        value={sessionType}
                        onChange={(e) => setType(e.target.value as SessionType)}
                        disabled={inputsDisabled}
                      >
                        <option value="individual">{t("trainingDetail.typeIndividual")}</option>
                        <option value="private">{t("trainingDetail.typePrivate")}</option>
                      </select>
                    )}

                    {sessionType === "club" && (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("common.club")}</span>
                        <select
                          value={clubIdForTraining}
                          onChange={(e) => setClubIdForTraining(e.target.value)}
                          disabled={inputsDisabled || clubIds.length === 0 || Boolean(linkedEvent)}
                        >
                          <option value="">-</option>
                          {clubIds.map((id) => (
                            <option key={id} value={id}>
                              {clubsById[id]?.name ?? id}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {/* ✅ Coach section:
                        - Planned: read-only display head coach + coachs supplémentaires
                        - Non-planned club: checkbox list
                        - Private/Individual: nothing
                    */}
                    {showCoachSectionPlannedReadOnly ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("common.coach")}</span>
                        <div
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.75)",
                            padding: "10px 12px",
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          {coachOptions.length === 0 ? (
                            <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.65 }}>{t("trainingNew.noCoachOnSession")}</div>
                          ) : (
                            <>
                              <div style={{ display: "grid", gap: 8 }}>
                                {coachOptions.map((c) => {
                                  const initials = c.label
                                    .split(" ")
                                    .map((p) => p.trim())
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((p) => p[0]?.toUpperCase() ?? "")
                                    .join("") || "—";

                                  return (
                                    <div
                                      key={`planned-coach-${c.id}`}
                                      style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(0,0,0,0.10)",
                                        background: "rgba(255,255,255,0.88)",
                                        padding: "8px 10px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                        <div
                                          aria-hidden
                                          style={{
                                            width: 28,
                                            height: 28,
                                            borderRadius: "50%",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 11,
                                            fontWeight: 950,
                                            color: "rgba(16,56,34,0.95)",
                                            border: "1px solid rgba(32,99,62,0.28)",
                                            background: "rgba(53,72,59,0.14)",
                                            flex: "0 0 auto",
                                          }}
                                        >
                                          {initials}
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(0,0,0,0.84)" }} className="truncate">
                                          {c.label}
                                        </div>
                                      </div>

                                      <div
                                        className="pill-soft"
                                        style={{
                                          background: c.isHead ? "rgba(53,72,59,0.18)" : "rgba(0,0,0,0.08)",
                                          color: c.isHead ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.72)",
                                          fontWeight: 900,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {c.isHead ? "Head coach" : t("trainingNew.extraCoach")}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                            </>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {showCoachSectionAsCheckboxes ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.coachOptional")}</span>

                        <div
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.75)",
                            padding: "10px 12px",
                            display: "grid",
                            gap: 10,
                            opacity: inputsDisabled ? 0.65 : 1,
                          }}
                        >
                          {coachOptions.length === 0 ? (
                            <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>
                              {t("trainingNew.noCoachInClub")}
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={inputsDisabled}
                                  onClick={() => setSelectedCoachIds(coachOptions.map((c) => c.id))}
                                >
                                  {t("trainingNew.selectAll")}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={inputsDisabled}
                                  onClick={() => setSelectedCoachIds([])}
                                >
                                  {t("trainingNew.none")}
                                </button>
                              </div>

                              <div style={{ display: "grid", gap: 8 }}>
                                {coachOptions.map((c) => {
                                  const checked = selectedCoachIds.includes(c.id);
                                  return (
                                    <label
                                      key={c.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        padding: "10px 10px",
                                        borderRadius: 12,
                                        border: "1px solid rgba(0,0,0,0.10)",
                                        background: checked ? "rgba(53,72,59,0.10)" : "rgba(255,255,255,0.60)",
                                        cursor: inputsDisabled ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={inputsDisabled}
                                          onChange={(e) => {
                                            const next = e.target.checked;
                                            setSelectedCoachIds((prev) => {
                                              if (next) return uniq([...prev, c.id]);
                                              return prev.filter((id) => id !== c.id);
                                            });
                                          }}
                                        />
                                        <div style={{ display: "grid" }}>
                                          <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>{c.label}</div>
                                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>
                                            {c.roleLabel}
                                          </div>
                                        </div>
                                      </div>

                                      <div
                                        className="pill-soft"
                                        style={{
                                          background: "rgba(53,72,59,0.14)",
                                          fontWeight: 950,
                                        }}
                                      >
                                        {c.roleLabel}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>

                              {nonPlannedCoachSummary ? (
                                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{nonPlannedCoachSummary}</div>
                              ) : (
                                <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>
                                  {t("trainingNew.tipNoCoach")}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ) : null}

                  </div>
                </div>

                <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("trainingNew.trainingStructure")}</div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        height: 42,
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.10)",
                        background: "rgba(255,255,255,0.65)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 12px",
                        fontWeight: 950,
                        color: "rgba(0,0,0,0.78)",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span>{totalMinutes}</span>
                        <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>{t("trainingNew.actualMin")}</span>
                      </div>
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("trainingNew.addSectionHint")}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {items.map((it, idx) => (
                        <div
                          key={idx}
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.65)",
                            padding: 12,
                            display: "grid",
                            gap: 10,
                            opacity: inputsDisabled ? 0.65 : 1,
                          }}
                        >
                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("trainingNew.section")}</span>
                              <select value={it.category} onChange={(e) => updateLine(idx, { category: e.target.value })} disabled={inputsDisabled}>
                                <option value="">-</option>
                                {TRAINING_CATEGORIES.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("trainingNew.duration")}</span>
                              <select value={it.minutes} onChange={(e) => updateLine(idx, { minutes: e.target.value })} disabled={inputsDisabled}>
                                <option value="">-</option>
                                {MINUTE_OPTIONS.map((m) => (
                                  <option key={m} value={String(m)}>
                                    {m} min
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("trainingNew.noteOptional")}</span>
                            <input
                              value={it.note}
                              onChange={(e) => updateLine(idx, { note: e.target.value })}
                              disabled={inputsDisabled}
                              placeholder={t("trainingNew.notePlaceholder")}
                            />
                          </label>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div className="pill-soft">{t("trainingNew.section")} {idx + 1}</div>
                            <button type="button" className="btn btn-danger soft" onClick={() => removeLine(idx)} disabled={inputsDisabled}>
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={addLine} disabled={inputsDisabled}>
                      + {t("trainingNew.addSection")}
                    </button>
                  </div>

                  {!showSensationsCard ? (
                    <button
                      className="cta-green"
                      type="submit"
                      disabled={!canSave || busy}
                      style={{ width: "100%" }}
                    >
                      {busy ? t("trainingNew.saving") : t("common.save")}
                    </button>
                  ) : null}
                </div>

                {showSensationsCard ? (
                  <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>
                      {locale === "fr" ? "Sensations et remarques" : "Feelings and notes"}
                    </div>

                    <div style={{ display: "grid", gap: 10, opacity: inputsDisabled ? 0.65 : 1 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.motivationBefore")}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                          {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                            const val = String(v);
                            const active = motivation === val;
                            return (
                              <button
                                key={`mot-${v}`}
                                type="button"
                                onClick={() => setMotivation((prev) => (prev === val ? "" : val))}
                                disabled={inputsDisabled}
                                aria-pressed={active}
                                style={{
                                  width: "100%",
                                  height: 34,
                                  borderRadius: 10,
                                  border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                  background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                  color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                  fontWeight: 900,
                                  cursor: inputsDisabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.difficultyDuring")}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                          {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                            const val = String(v);
                            const active = difficulty === val;
                            return (
                              <button
                                key={`dif-${v}`}
                                type="button"
                                onClick={() => setDifficulty((prev) => (prev === val ? "" : val))}
                                disabled={inputsDisabled}
                                aria-pressed={active}
                                style={{
                                  width: "100%",
                                  height: 34,
                                  borderRadius: 10,
                                  border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                  background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                  color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                  fontWeight: 900,
                                  cursor: inputsDisabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.satisfactionAfter")}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                          {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                            const val = String(v);
                            const active = satisfaction === val;
                            return (
                              <button
                                key={`sat-${v}`}
                                type="button"
                                onClick={() => setSatisfaction((prev) => (prev === val ? "" : val))}
                                disabled={inputsDisabled}
                                aria-pressed={active}
                                style={{
                                  width: "100%",
                                  height: 34,
                                  borderRadius: 10,
                                  border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                  background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                  color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                  fontWeight: 900,
                                  cursor: inputsDisabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: 6, opacity: inputsDisabled ? 0.65 : 1 }}>
                      <span style={fieldLabelStyle}>{locale === "fr" ? "Remarques" : "Notes"}</span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={inputsDisabled}
                        placeholder={t("roundsNew.notesPlaceholder")}
                        style={{ minHeight: 110 }}
                      />
                    </label>

                    <button
                      className="cta-green"
                      type="submit"
                      disabled={!canSave || busy}
                      style={{ width: "100%" }}
                    >
                      {busy ? t("trainingNew.saving") : t("common.save")}
                    </button>
                  </div>
                ) : null}
              </form>
            )}
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};
