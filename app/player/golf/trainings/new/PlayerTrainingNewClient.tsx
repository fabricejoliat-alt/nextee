"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SessionType = "club" | "private" | "individual";

type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};

type ClubRow = { id: string; name: string | null };
type ClubMemberRow = { club_id: string };

type ClubEventRow = {
  id: string;
  group_id: string;
  club_id: string;
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type ProfileLite = { id: string; first_name: string | null; last_name: string | null };

type CoachOption = {
  id: string;
  label: string;
  roleLabel: "Coach" | "Assistant";
  isHead: boolean;
};

const TRAINING_CATEGORIES: { value: string; label: string }[] = [
  { value: "warmup_mobility", label: "Échauffement / mobilité" },
  { value: "long_game", label: "Long jeu" },
  { value: "putting", label: "Putting" },
  { value: "wedging", label: "Wedging" },
  { value: "pitching", label: "Pitching" },
  { value: "chipping", label: "Chipping" },
  { value: "bunker", label: "Bunker" },
  { value: "course", label: "Parcours" },
  { value: "mental", label: "Mental" },
  { value: "fitness", label: "Fitness" },
  { value: "other", label: "Autre" },
];

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
  const router = useRouter();
  const sp = useSearchParams();

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
  const [sessionType, setSessionType] = useState<SessionType>("club");

  const [notes, setNotes] = useState<string>("");

  // sensations
  const [motivation, setMotivation] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [satisfaction, setSatisfaction] = useState<string>("");

  // items
  const [items, setItems] = useState<TrainingItemDraft[]>([]);

  // planned event (optional)
  const [linkedEvent, setLinkedEvent] = useState<ClubEventRow | null>(null);

  // ✅ absent toggle (only for planned events)
  const [isAbsent, setIsAbsent] = useState<boolean>(false);

  // ✅ coaches (planned: display only / non-planned club: checkbox list)
  const [coachOptions, setCoachOptions] = useState<CoachOption[]>([]);
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([]);

  const totalMinutes = useMemo(() => {
    return items.reduce((sum, it) => {
      const v = Number(it.minutes);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [items]);

  const plannedMinutes = linkedEvent?.duration_minutes ?? 0;
  const inputsDisabled = busy || isAbsent;

  const plannedCoachSummary = useMemo(() => {
    if (!linkedEvent) return "";
    if (coachOptions.length === 0) return "";
    const heads = coachOptions.filter((c) => c.isHead);
    const assists = coachOptions.filter((c) => !c.isHead);

    const headNames = heads.map((c) => c.label).filter(Boolean);
    const assistNames = assists.map((c) => c.label).filter(Boolean);

    const lines: string[] = [];
    if (headNames.length > 0) lines.push(`Coach : ${headNames.join(", ")}`);
    if (assistNames.length > 0) lines.push(`Assistants : ${assistNames.join(", ")}`);
    return lines.join(" • ");
  }, [linkedEvent, coachOptions]);

  const nonPlannedCoachSummary = useMemo(() => {
    if (linkedEvent) return "";
    if (sessionType !== "club") return "";
    if (selectedCoachIds.length === 0) return "";
    const selected = coachOptions.filter((c) => selectedCoachIds.includes(c.id));
    const names = selected.map((c) => c.label).filter(Boolean);
    if (names.length === 0) return "";
    return `Coach : ${names.join(", ")}`;
  }, [linkedEvent, sessionType, coachOptions, selectedCoachIds]);

  const coachNameForSave = useMemo(() => {
    // ✅ planned: save read-only summary based on event coaches
    if (linkedEvent) {
      const heads = coachOptions.filter((c) => c.isHead).map((c) => c.label).filter((x) => x && x !== "—");
      const assists = coachOptions.filter((c) => !c.isHead).map((c) => c.label).filter((x) => x && x !== "—");
      const parts: string[] = [];
      if (heads.length) parts.push(`Coach: ${heads.join(", ")}`);
      if (assists.length) parts.push(`Assistants: ${assists.join(", ")}`);
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
  }, [linkedEvent, sessionType, coachOptions, selectedCoachIds]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!userId) return false;
    if (!startAt) return false;
    if (isAbsent) return false;

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
  }, [busy, userId, startAt, isAbsent, sessionType, clubIdForTraining, items]);

  const canSaveAbsence = useMemo(() => {
    if (!linkedEvent) return false;
    if (!userId) return false;
    if (busy) return false;
    return true;
  }, [linkedEvent, userId, busy]);

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
      roleLabel: isHead ? "Coach" : "Assistant",
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
        roleLabel: "Coach",
      };
    });
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        setError("Session invalide. Reconnecte-toi.");
        setLoading(false);
        return;
      }

      const uid = userRes.user.id;
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
          .select("id,group_id,club_id,starts_at,duration_minutes,location_text,status")
          .eq("id", clubEventId)
          .maybeSingle();

        if (eRes.error) {
          setError(eRes.error.message);
        } else if (eRes.data) {
          const ev = eRes.data as ClubEventRow;
          setLinkedEvent(ev);

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

          // ✅ planned coaches: read-only display (head + assistants)
          const opts: CoachOption[] = await loadCoachOptionsForPlannedEvent(ev);
          setCoachOptions(opts);
          setSelectedCoachIds([]); // pas utilisé en planned

          // ✅ load my current attendee status to pre-toggle "absent" if already set
          const aRes = await supabase
            .from("club_event_attendees")
            .select("status")
            .eq("event_id", ev.id)
            .eq("player_id", uid)
            .maybeSingle();

          if (!aRes.error && aRes.data?.status) {
            setIsAbsent(aRes.data.status === "absent");
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

  async function saveAbsence() {
    if (!linkedEvent) return;
    if (!canSaveAbsence) return;

    setBusy(true);
    setError(null);

    // ✅ Option A: update only (no insert) => avoids RLS INSERT issues
    const up = await supabase
      .from("club_event_attendees")
      .update({ status: "absent" })
      .eq("event_id", linkedEvent.id)
      .eq("player_id", userId);

    if (up.error) {
      setError(up.error.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    router.push("/player/golf/trainings");
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

    const mot = motivation ? Number(motivation) : null;
    const dif = difficulty ? Number(difficulty) : null;
    const sat = satisfaction ? Number(satisfaction) : null;

    const club_id = sessionType === "club" ? clubIdForTraining : null;

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

    const insertSession = await supabase
      .from("training_sessions")
      .insert({
        user_id: userId,
        start_at: dt.toISOString(),

        // ✅ planned: keep place/club consistent with event
        location_text: (linkedEvent ? (linkedEvent.location_text ?? place) : place).trim() || null,
        session_type: sessionType,
        club_id: linkedEvent ? linkedEvent.club_id : club_id,

        // ✅ save coaches names (planned: summary; non-planned club: checked)
        coach_name: coachNameForSave,

        motivation: mot,
        difficulty: dif,
        satisfaction: sat,
        notes: notes.trim() || null,

        // ✅ total minutes
        total_minutes: totalMinutes,

        // ✅ link to planned event if any
        club_event_id: linkedEvent?.id ?? null,
      })
      .select("id")
      .single();

    if (insertSession.error) {
      setError(insertSession.error.message);
      setBusy(false);
      return;
    }

    const sessionId = insertSession.data.id as string;

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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Ajouter un entraînement
              </div>

              
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                Retour
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                Mes entraînements
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}

          {sessionType === "club" && clubIds.length === 0 && !loading && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
              ⚠️ Ton compte n’est lié à aucun club actif : impossible d’enregistrer un entraînement “Club”.
            </div>
          )}
        </div>

        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div>Chargement…</div>
            ) : (
              <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
                {/* ✅ planned info + absence toggle */}
                {linkedEvent ? (
                  <div
                    style={{
                      border: "1px solid rgba(0,0,0,0.10)",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.65)",
                      padding: 12,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.80)" }}>Séance planifiée</div>
                      <div className="pill-soft">{plannedMinutes} min planifiés</div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      

                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 10,
                          border: "1px solid rgba(0,0,0,0.12)",
                          borderRadius: 999,
                          padding: "8px 12px",
                          background: isAbsent ? "rgba(180,0,0,0.08)" : "rgba(255,255,255,0.70)",
                          fontWeight: 950,
                          fontSize: 12,
                          color: "rgba(0,0,0,0.78)",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        <input type="checkbox" checked={isAbsent} onChange={(e) => setIsAbsent(e.target.checked)} disabled={busy} />
                        Je serai absent
                      </label>
                    </div>

                    {isAbsent ? (
                      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(160,0,0,0.80)" }}>
                        ⚠️ La saisie est désactivée. Clique “Enregistrer mon absence”.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>
                      Date {linkedEvent ? <span style={{ opacity: 0.7 }}>(réel)</span> : null}
                    </span>
                    <input type="date" value={startDate} onChange={(e) => updateStartDate(e.target.value)} disabled={inputsDisabled} />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Heure</span>
                    <select value={startTime} onChange={(e) => updateStartTime(e.target.value)} disabled={inputsDisabled}>
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
                    Lieu{" "}
                    {linkedEvent ? <span style={{ opacity: 0.7 }}>(planifié)</span> : <span style={{ opacity: 0.7 }}>(optionnel)</span>}
                  </span>
                  <input
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    disabled={inputsDisabled || Boolean(linkedEvent)}
                    placeholder="Ex: Practice / Putting green / Parcours"
                  />
                </label>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Type d’entraînement</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ ...chipRadioStyle, ...(sessionType === "club" ? chipRadioActive : {}), opacity: linkedEvent ? 0.7 : 1 }}>
                      <input type="radio" checked={sessionType === "club"} onChange={() => setType("club")} disabled={inputsDisabled || Boolean(linkedEvent)} />
                      <span>Entraînement Club</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(sessionType === "private" ? chipRadioActive : {}), opacity: linkedEvent ? 0.5 : 1 }}>
                      <input
                        type="radio"
                        checked={sessionType === "private"}
                        onChange={() => setType("private")}
                        disabled={inputsDisabled || Boolean(linkedEvent)}
                      />
                      <span>Cours privé</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(sessionType === "individual" ? chipRadioActive : {}), opacity: linkedEvent ? 0.5 : 1 }}>
                      <input
                        type="radio"
                        checked={sessionType === "individual"}
                        onChange={() => setType("individual")}
                        disabled={inputsDisabled || Boolean(linkedEvent)}
                      />
                      <span>Entraînement individuel</span>
                    </label>
                  </div>

                  {sessionType === "club" && (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>
                        Club {linkedEvent ? <span style={{ opacity: 0.7 }}>(planifié)</span> : null}
                      </span>
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
                      - Planned: read-only display head coach + assistants
                      - Non-planned club: checkbox list
                      - Private/Individual: nothing
                  */}
                  {showCoachSectionPlannedReadOnly ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Coach (planifié)</span>
                      <div
                        style={{
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.75)",
                          padding: "10px 12px",
                          fontWeight: 900,
                          color: "rgba(0,0,0,0.80)",
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        {coachOptions.length === 0 ? (
                          <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.65 }}>— Aucun coach renseigné sur cette séance —</div>
                        ) : (
                          <>
                            <div style={{ display: "grid", gap: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>Head coach</div>
                              <div style={{ fontSize: 13 }}>
                                {coachOptions.filter((c) => c.isHead).map((c) => c.label).filter(Boolean).join(", ") || "—"}
                              </div>
                            </div>

                            <div className="hr-soft" style={{ margin: "2px 0" }} />

                            <div style={{ display: "grid", gap: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>Assistants</div>
                              <div style={{ fontSize: 13 }}>
                                {coachOptions.filter((c) => !c.isHead).map((c) => c.label).filter(Boolean).join(", ") || "—"}
                              </div>
                            </div>

                            {plannedCoachSummary ? (
                              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{plannedCoachSummary}</div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {showCoachSectionAsCheckboxes ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Coach (optionnel)</span>

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
                            — Aucun coach trouvé dans ce club —
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
                                Tout sélectionner
                              </button>
                              <button
                                type="button"
                                className="btn"
                                disabled={inputsDisabled}
                                onClick={() => setSelectedCoachIds([])}
                              >
                                Aucun
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
                                Astuce : tu peux ne rien cocher si tu veux.
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Structure de l&apos;entraînement</div>

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
                        <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>min effectifs</span>
                      </div>
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      Ajoute un poste pour structurer ton entraînement.
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
                              <span style={fieldLabelStyle}>Poste</span>
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
                              <span style={fieldLabelStyle}>Durée</span>
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
                            <span style={fieldLabelStyle}>Note (optionnel)</span>
                            <input
                              value={it.note}
                              onChange={(e) => updateLine(idx, { note: e.target.value })}
                              disabled={inputsDisabled}
                              placeholder="Ex: focus wedging 60–80m"
                            />
                          </label>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div className="pill-soft">Poste {idx + 1}</div>
                            <button type="button" className="btn btn-danger soft" onClick={() => removeLine(idx)} disabled={inputsDisabled}>
                              Supprimer
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={addLine} disabled={inputsDisabled}>
                      + Ajouter un poste
                    </button>
                  </div>
                </div>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10, opacity: inputsDisabled ? 0.65 : 1 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Motivation avant l&apos;entraînement</span>
                    <select value={motivation} onChange={(e) => setMotivation(e.target.value)} disabled={inputsDisabled}>
                      <option value="">-</option>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={String(v)}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Difficulté de l&apos;entraînement</span>
                    <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} disabled={inputsDisabled}>
                      <option value="">-</option>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={String(v)}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Satisfaction après l&apos;entraînement</span>
                    <select value={satisfaction} onChange={(e) => setSatisfaction(e.target.value)} disabled={inputsDisabled}>
                      <option value="">-</option>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={String(v)}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="hr-soft" />

                <label style={{ display: "grid", gap: 6, opacity: inputsDisabled ? 0.65 : 1 }}>
                  <span style={fieldLabelStyle}>Remarques (optionnel)</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={inputsDisabled}
                    placeholder="Hydratation, alimentation, attitude, points clés, objectifs…"
                    style={{ minHeight: 110 }}
                  />
                </label>

                {/* ✅ action buttons */}
                {isAbsent && linkedEvent ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={saveAbsence}
                    disabled={!canSaveAbsence || busy}
                    style={{ width: "100%", background: "rgba(160,0,0,0.95)", borderColor: "rgba(160,0,0,0.95)", color: "#fff" }}
                  >
                    {busy ? "Enregistrement…" : "Enregistrer mon absence"}
                  </button>
                ) : (
                  <button
                    className="btn"
                    type="submit"
                    disabled={!canSave || busy}
                    style={{ width: "100%", background: "var(--green-dark)", borderColor: "var(--green-dark)", color: "#fff" }}
                  >
                    {busy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                )}
              </form>
            )}
          </div>
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

const chipRadioStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "rgba(255,255,255,0.70)",
  fontWeight: 900,
  fontSize: 13,
  color: "rgba(0,0,0,0.78)",
  cursor: "pointer",
  userSelect: "none",
};

const chipRadioActive: CSSProperties = {
  borderColor: "rgba(53,72,59,0.35)",
  background: "rgba(53,72,59,0.10)",
};
