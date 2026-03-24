"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { PlusCircle } from "lucide-react";
import { TiptapSimpleEditor } from "@/components/ui/TiptapSimpleEditor";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";

type ClubRow = { id: string; name: string | null };
type GroupRow = { id: string; name: string; club_id: string };
type ProfileRow = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type ClubMemberRow = { user_id: string; club_id: string; role: string | null; is_active: boolean };
type GroupPlayerRow = { group_id: string; player_user_id: string };

type CampSummary = {
  id: string;
  club_id: string;
  title: string;
  notes: string | null;
  head_coach_user_id?: string | null;
  head_coach?: ProfileRow | null;
  group_ids: string[];
  player_ids: string[];
  coach_ids: string[];
  days: Array<{
    event_id?: string | null;
    starts_at: string | null;
    ends_at: string | null;
    location_text: string | null;
    practical_info: string | null;
    coach_ids?: string[];
  }>;
};

type DayDraft = {
  event_id?: string | null;
  starts_at: string;
  ends_at: string;
  location_text: string;
  practical_info: string;
  coach_ids: string[];
};

function fullName(p?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(p?.first_name ?? "").trim();
  const last = String(p?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "—";
}

function toInputDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoToInputDateTime(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? toInputDateTime(date) : "";
}

function nextMorning(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(9, 0, 0, 0);
  return toInputDateTime(date);
}

function nextAfternoon(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(16, 0, 0, 0);
  return toInputDateTime(date);
}

export default function ManagerCampEditorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCampId = String(searchParams.get("campId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingCampId, setEditingCampId] = useState<string | null>(requestedCampId || null);
  const [availableCamps, setAvailableCamps] = useState<CampSummary[]>([]);

  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [coachMembers, setCoachMembers] = useState<ProfileRow[]>([]);
  const [playerMembers, setPlayerMembers] = useState<ProfileRow[]>([]);
  const [groupPlayerIds, setGroupPlayerIds] = useState<Record<string, string[]>>({});

  const [clubId, setClubId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [headCoachId, setHeadCoachId] = useState("");
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([]);
  const [days, setDays] = useState<DayDraft[]>([
    {
      event_id: null,
      starts_at: nextMorning(1),
      ends_at: nextAfternoon(1),
      location_text: "",
      practical_info: "",
      coach_ids: [],
    },
  ]);

  function resetForm(nextClubId?: string) {
    setEditingCampId(null);
    setTitle("");
    setNotes("");
    setSelectedGroupIds([]);
    setSelectedPlayerIds([]);
    setHeadCoachId("");
    setSelectedCoachIds([]);
    setDays([
      {
        event_id: null,
        starts_at: nextMorning(1),
        ends_at: nextAfternoon(1),
        location_text: "",
        practical_info: "",
        coach_ids: [],
      },
    ]);
    if (nextClubId) setClubId(nextClubId);
  }

  function applyCampToForm(camp: CampSummary) {
    setEditingCampId(camp.id);
    setClubId(camp.club_id);
    setTitle(camp.title);
    setNotes(normalizeCampRichTextHtml(camp.notes ?? ""));
    setSelectedGroupIds(camp.group_ids ?? []);
    setSelectedPlayerIds(camp.player_ids ?? []);
    setHeadCoachId(String(camp.head_coach_user_id ?? camp.head_coach?.id ?? ""));
    setSelectedCoachIds(camp.coach_ids ?? []);
    setDays(
      (camp.days ?? []).map((day) => ({
        event_id: day.event_id ?? null,
        starts_at: isoToInputDateTime(day.starts_at),
        ends_at: isoToInputDateTime(day.ends_at),
        location_text: day.location_text ?? "",
        practical_info: day.practical_info ?? "",
        coach_ids: day.coach_ids ?? [],
      }))
    );
  }

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadContext() {
    const { data: authRes, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authRes.user) throw new Error("Session invalide.");

    const managerMembershipsRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", authRes.user.id)
      .eq("role", "manager")
      .eq("is_active", true);
    if (managerMembershipsRes.error) throw new Error(managerMembershipsRes.error.message);

    const clubIds = Array.from(new Set((managerMembershipsRes.data ?? []).map((row: any) => String(row.club_id ?? "").trim()).filter(Boolean)));
    const clubsRes = clubIds.length > 0
      ? await supabase.from("clubs").select("id,name").in("id", clubIds).order("name", { ascending: true })
      : ({ data: [], error: null } as const);
    if (clubsRes.error) throw new Error(clubsRes.error.message);

    const clubRows: ClubRow[] = ((clubsRes.data ?? []) as ClubRow[]).filter((row) => String(row.id ?? "").trim().length > 0);
    setClubs(clubRows);
    const defaultClubId = clubRows[0]?.id ?? "";
    setClubId((current) => current || defaultClubId);

    const scopedClubIds = clubRows.map((row) => row.id);
    if (scopedClubIds.length === 0) {
      setGroups([]);
      setCoachMembers([]);
      setPlayerMembers([]);
      setGroupPlayerIds({});
      return;
    }

    const [groupsRes, clubMembersRes, groupPlayersRes] = await Promise.all([
      supabase.from("coach_groups").select("id,name,club_id").in("club_id", scopedClubIds).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("club_members").select("user_id,club_id,role,is_active").in("club_id", scopedClubIds).eq("is_active", true).in("role", ["coach", "player"]),
      supabase.from("coach_group_players").select("group_id,player_user_id"),
    ]);
    if (groupsRes.error) throw new Error(groupsRes.error.message);
    if (clubMembersRes.error) throw new Error(clubMembersRes.error.message);
    if (groupPlayersRes.error) throw new Error(groupPlayersRes.error.message);

    const nextGroups = ((groupsRes.data ?? []) as GroupRow[]).filter((row) => scopedClubIds.includes(row.club_id));
    setGroups(nextGroups);

    const members = (clubMembersRes.data ?? []) as ClubMemberRow[];
    const memberUserIds = Array.from(new Set(members.map((row) => String(row.user_id ?? "").trim()).filter(Boolean)));
    const profilesRes = memberUserIds.length > 0
      ? await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", memberUserIds)
      : ({ data: [], error: null } as const);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const profileById = new Map<string, ProfileRow>();
    ((profilesRes.data ?? []) as ProfileRow[]).forEach((profile) => profileById.set(String(profile.id), profile));

    setCoachMembers(
      members
        .filter((row) => row.role === "coach")
        .map((row) => profileById.get(String(row.user_id ?? "").trim()) ?? null)
        .filter((row): row is ProfileRow => Boolean(row))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"))
    );
    setPlayerMembers(
      members
        .filter((row) => row.role === "player")
        .map((row) => profileById.get(String(row.user_id ?? "").trim()) ?? null)
        .filter((row): row is ProfileRow => Boolean(row))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"))
    );

    const groupPlayerMap: Record<string, string[]> = {};
    ((groupPlayersRes.data ?? []) as GroupPlayerRow[]).forEach((row) => {
      if (!groupPlayerMap[row.group_id]) groupPlayerMap[row.group_id] = [];
      groupPlayerMap[row.group_id].push(String(row.player_user_id));
    });
    setGroupPlayerIds(groupPlayerMap);
  }

  async function loadCamps() {
    const headers = await authHeaders();
    const res = await fetch("/api/manager/camps", { headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(json?.error ?? "Impossible de charger les stages."));
    const nextCamps = (json?.camps ?? []) as CampSummary[];
    setAvailableCamps(nextCamps);
    setCoachMembers((current) => {
      const next = [...current];
      const seen = new Set(next.map((coach) => String(coach.id)));
      nextCamps.forEach((camp) => {
        const headCoach = camp.head_coach ?? null;
        if (!headCoach?.id) return;
        if (seen.has(String(headCoach.id))) return;
        next.push(headCoach);
        seen.add(String(headCoach.id));
      });
      return next.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadContext(), loadCamps()]);
    } catch (err: any) {
      setError(err?.message ?? "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!requestedCampId || availableCamps.length === 0) return;
    const camp = availableCamps.find((entry) => entry.id === requestedCampId);
    if (!camp) {
      setError("Stage/camp introuvable.");
      return;
    }
    applyCampToForm(camp);
  }, [requestedCampId, availableCamps]);

  const visibleGroups = useMemo(() => groups.filter((group) => group.club_id === clubId), [groups, clubId]);

  useEffect(() => {
    if (!editingCampId) {
      setSelectedGroupIds([]);
      setSelectedPlayerIds([]);
      setHeadCoachId("");
      setSelectedCoachIds([]);
    }
  }, [clubId, editingCampId]);

  useEffect(() => {
    setSelectedGroupIds((current) => current.filter((groupId) => visibleGroups.some((group) => group.id === groupId)));
  }, [visibleGroups]);

  const suggestedPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    selectedGroupIds.forEach((groupId) => {
      (groupPlayerIds[groupId] ?? []).forEach((playerId) => ids.add(playerId));
    });
    return Array.from(ids);
  }, [groupPlayerIds, selectedGroupIds]);

  useEffect(() => {
    if (suggestedPlayerIds.length === 0) return;
    setSelectedPlayerIds((current) => {
      const visibleCurrent = current.filter((playerId) => playerMembers.some((player) => player.id === playerId));
      return Array.from(new Set([...visibleCurrent, ...suggestedPlayerIds]));
    });
  }, [suggestedPlayerIds, playerMembers]);

  useEffect(() => {
    setSelectedCoachIds((current) => current.filter((coachId) => coachMembers.some((coach) => coach.id === coachId)));
    if (headCoachId && !coachMembers.some((coach) => coach.id === headCoachId)) setHeadCoachId("");
  }, [coachMembers, headCoachId]);

  function toggleValue(values: string[], value: string) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  function updateDay(index: number, patch: Partial<DayDraft>) {
    setDays((current) => current.map((day, dayIndex) => (dayIndex === index ? { ...day, ...patch } : day)));
  }

  function addDay() {
    setDays((current) => [
      ...current,
      {
        event_id: null,
        starts_at: nextMorning(current.length + 1),
        ends_at: nextAfternoon(current.length + 1),
        location_text: "",
        practical_info: "",
        coach_ids: [],
      },
    ]);
  }

  function removeDay(index: number) {
    setDays((current) => current.filter((_, dayIndex) => dayIndex !== index));
  }

  async function saveCamp() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      };
      const isEditing = Boolean(editingCampId);
      const res = await fetch(isEditing ? `/api/manager/camps/${editingCampId}` : "/api/manager/camps", {
        method: isEditing ? "PATCH" : "POST",
        headers,
        body: JSON.stringify({
          club_id: clubId,
          title,
          notes: normalizeCampRichTextHtml(notes),
          group_ids: selectedGroupIds,
          player_ids: selectedPlayerIds,
          head_coach_user_id: headCoachId,
          coach_ids: selectedCoachIds,
          days,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? (isEditing ? "Mise à jour impossible." : "Création impossible.")));
      setSuccess(isEditing ? "Stage/camp mis à jour." : "Stage/camp créé.");
      router.push("/manager/camps");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? (editingCampId ? "Mise à jour impossible." : "Création impossible."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="manager-page">
      <div className="glass-section">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div className="section-title">{editingCampId ? "Éditer un stage/camp" : "Nouveau stage/camp"}</div>
            <div className="section-subtitle">Créer un stage multi-jour avec présence par journée, coachs, structure et évaluation par jour.</div>
          </div>
          <Link href="/manager/camps" className="btn">Retour à la liste</Link>
        </div>
      </div>

      <div className="glass-section">
        <div className="glass-card" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
            <PlusCircle size={18} /> {editingCampId ? "Modifier le stage/camp" : "Configurer le stage/camp"}
          </div>

          {error ? <div className="marketplace-error">{error}</div> : null}
          {success ? (
            <div style={{ borderRadius: 12, padding: "10px 12px", background: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.24)", color: "rgba(21,128,61,1)", fontWeight: 800 }}>
              {success}
            </div>
          ) : null}

          {loading ? (
            <ListLoadingBlock label="Chargement" />
          ) : (
            <>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>Organisation</span>
                  <select className="input" value={clubId} onChange={(e) => setClubId(e.target.value)}>
                    {clubs.map((club) => (
                      <option key={club.id} value={club.id}>{club.name ?? "Club"}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>Nom du stage</span>
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Camp de printemps" />
                </label>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 800 }}>Notes générales</span>
                <TiptapSimpleEditor value={notes} onChange={setNotes} placeholder="Informations générales du stage" />
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>Groupes concernés</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {visibleGroups.map((group) => (
                    <label key={group.id} className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedGroupIds.includes(group.id)} onChange={() => setSelectedGroupIds((current) => toggleValue(current, group.id))} />
                      <span>{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>Joueurs invités</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {playerMembers.map((player) => (
                    <label key={player.id} className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedPlayerIds.includes(player.id)} onChange={() => setSelectedPlayerIds((current) => toggleValue(current, player.id))} />
                      <span>{fullName(player)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>Head coach du camp</span>
                  <select className="input" value={headCoachId} onChange={(e) => setHeadCoachId(e.target.value)}>
                    <option value="">Choisir…</option>
                    {coachMembers.map((coach) => (
                      <option key={coach.id} value={coach.id}>{fullName(coach)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>Coachs additionnels du camp</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {coachMembers.filter((coach) => coach.id !== headCoachId).map((coach) => (
                    <label key={coach.id} className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedCoachIds.includes(coach.id)} onChange={() => setSelectedCoachIds((current) => toggleValue(current, coach.id))} />
                      <span>{fullName(coach)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 900 }}>Journées du stage</div>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,0.58)", fontWeight: 700 }}>
                    Chaque journée peut avoir sa propre plage horaire, indépendamment de la limite technique des activités classiques.
                  </div>
                </div>
                {days.map((day, index) => (
                  <div key={index} className="glass-card" style={{ display: "grid", gap: 12, border: "1px solid rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>Jour {index + 1}</div>
                      {days.length > 1 ? <button type="button" className="btn" onClick={() => removeDay(index)}>Supprimer</button> : null}
                    </div>
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 800 }}>Début</span>
                        <input type="datetime-local" className="input" value={day.starts_at} onChange={(e) => updateDay(index, { starts_at: e.target.value })} />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 800 }}>Fin</span>
                        <input type="datetime-local" className="input" value={day.ends_at} onChange={(e) => updateDay(index, { ends_at: e.target.value })} />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 800 }}>Lieu</span>
                        <input className="input" value={day.location_text} onChange={(e) => updateDay(index, { location_text: e.target.value })} placeholder="Practice, parcours, autre site" />
                      </label>
                    </div>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 800 }}>Informations pratiques du jour</span>
                      <textarea className="input" rows={3} value={day.practical_info} onChange={(e) => updateDay(index, { practical_info: e.target.value })} placeholder="Rendez-vous, matériel, repas, etc." />
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontWeight: 800 }}>Coachs de cette journée</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {coachMembers.map((coach) => {
                          const checked = coach.id === headCoachId || day.coach_ids.includes(coach.id);
                          return (
                            <label key={coach.id} className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: coach.id === headCoachId ? "default" : "pointer" }}>
                              <input type="checkbox" checked={checked} disabled={coach.id === headCoachId} onChange={() => updateDay(index, { coach_ids: toggleValue(day.coach_ids, coach.id) })} />
                              <span>{fullName(coach)}{coach.id === headCoachId ? " • head coach" : ""}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <button type="button" className="btn" onClick={addDay}>Ajouter une journée</button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => router.push("/manager/camps")} disabled={saving}>Annuler</button>
                  <button type="button" className="btn" onClick={() => void saveCamp()} disabled={saving || !clubId || !title || !headCoachId || selectedGroupIds.length === 0 || selectedPlayerIds.length === 0 || days.length === 0}>
                    {saving ? (editingCampId ? "Enregistrement…" : "Création…") : editingCampId ? "Enregistrer les modifications" : "Créer le stage/camp"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
