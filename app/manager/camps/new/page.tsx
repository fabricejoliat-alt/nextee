/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ImagePlus,
  Plus,
  Save,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { TiptapSimpleEditor } from "@/components/ui/TiptapSimpleEditor";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import { isSelectableCampGroup } from "@/lib/campsManagement";
import { optimizeUploadFile } from "@/lib/clientUploadFiles";
import EventCriteriaSelector from "@/components/evaluations/EventCriteriaSelector";
import styles from "../Camps.module.css";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
type Group = { id: string; name: string; club_id: string; club_season_id: string | null };
type Attendance =
  | "expected"
  | "present"
  | "absent"
  | "excused"
  | "not_registered";
type Day = {
  event_id?: string | null;
  starts_at: string;
  ends_at: string;
  location_text: string;
  practical_info: string;
  coach_ids: string[];
  responsible_coach_id: string;
  evaluation_enabled: boolean;
  evaluation_criterion_ids: string[];
  evaluation?: { required: number; completed: number };
};
type Registration = {
  registration_status: "invited" | "registered" | "declined";
  day_status_by_day_index: Record<string, Attendance>;
};
type Option = {
  id?: string | null;
  name: string;
  description: string;
  is_active: boolean;
  applies_to_all_days: boolean;
  day_indexes: number[];
  capacity: number | null;
  allows_quantity: boolean;
  input_type: "checkbox" | "yes_no" | "select" | "radio";
  choices: string[];
  internal_note: string;
  assigns_to_all_participants: boolean;
  player_assignments: Array<{
    player_id: string;
    quantity: number;
    note?: string | null;
    selected_value?: string | null;
  }>;
};
type Camp = {
  id: string;
  club_id: string;
  title: string;
  notes: string | null;
  image_url: string | null;
  status: string;
  capacity: number | null;
  head_coach_user_id: string | null;
  group_ids: string[];
  player_ids: string[];
  coach_ids: string[];
  player_registrations: Array<{
    player_id: string;
    registration_status: Registration["registration_status"];
    day_status_by_day_index: Record<string, Attendance>;
  }>;
  days: Array<Day & { responsible_coach_id?: string | null }>;
  options: Option[];
};

const pad = (value: number) => String(value).padStart(2, "0");
function localInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function defaultDate(offset = 1, hour = 9) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return localInput(date);
}
function fromIso(value?: string | null) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? localInput(date) : "";
}
function shortDate(value?: string | null) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("fr-CH").format(date)
    : "Date à définir";
}
function fullName(profile?: Profile | null) {
  return (
    `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "—"
  );
}
function initials(profile?: Profile | null) {
  return (
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() ||
    "?"
  );
}
function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
function isAvailableCampGroup(group: Group) {
  const name = String(group.name ?? "").trim();
  return Boolean(group.club_season_id) && !name.startsWith("__ARCHIVE_") && isSelectableCampGroup(name);
}
function emptyOption(): Option {
  return {
    id: null,
    name: "",
    description: "",
    is_active: true,
    applies_to_all_days: true,
    day_indexes: [],
    capacity: null,
    allows_quantity: false,
    input_type: "checkbox",
    choices: [],
    internal_note: "",
    assigns_to_all_participants: true,
    player_assignments: [],
  };
}
function emptyDay(index = 0): Day {
  return {
    event_id: null,
    starts_at: defaultDate(index + 1, 9),
    ends_at: defaultDate(index + 1, 16),
    location_text: "",
    practical_info: "",
    coach_ids: [],
    responsible_coach_id: "",
    evaluation_enabled: false,
    evaluation_criterion_ids: [],
  };
}

function addOneDay(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  date.setDate(date.getDate() + 1);
  return localInput(date);
}

function dayAfter(previous: Day | undefined, index: number): Day {
  const fallback = emptyDay(index);
  if (!previous) return fallback;

  return {
    ...fallback,
    starts_at: addOneDay(previous.starts_at) || fallback.starts_at,
    ends_at: addOneDay(previous.ends_at) || fallback.ends_at,
    location_text: previous.location_text,
    practical_info: previous.practical_info,
    responsible_coach_id: previous.responsible_coach_id,
  };
}

function Avatar({ profile }: { profile?: Profile | null }) {
  return (
    <span className={styles.avatar}>
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" />
      ) : (
        initials(profile)
      )}
    </span>
  );
}

export default function CampEditorPage() {
  const router = useRouter();
  const params = useSearchParams();
  const campId = String(params.get("campId") ?? "");
  const duplicateId = String(params.get("duplicateId") ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clubId, setClubId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [players, setPlayers] = useState<Profile[]>([]);
  const [coaches, setCoaches] = useState<Profile[]>([]);
  const [groupPlayers, setGroupPlayers] = useState<Record<string, string[]>>(
    {},
  );
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const [headCoachId, setHeadCoachId] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [registrations, setRegistrations] = useState<
    Record<string, Registration>
  >({});
  const [options, setOptions] = useState<Option[]>([]);

  async function authHeaders(json = false) {
    const { data } = await supabase.auth.getSession();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    };
  }
  function hydrate(camp: Camp, duplicate: boolean) {
    setClubId(camp.club_id);
    setTitle(duplicate ? `${camp.title} — copie` : camp.title);
    setNotes(normalizeCampRichTextHtml(camp.notes ?? ""));
    setImageUrl(camp.image_url ?? "");
    setImageFile(null);
    setImagePreview(camp.image_url ?? null);
    setCapacity(camp.capacity ?? null);
    setGroupIds(camp.group_ids ?? []);
    setPlayerIds(camp.player_ids ?? []);
    setCoachIds(camp.coach_ids ?? []);
    setHeadCoachId(camp.head_coach_user_id ?? "");
    setDays(
      (camp.days ?? []).map((day) => ({
        ...day,
        event_id: duplicate ? null : day.event_id,
        starts_at: fromIso(day.starts_at),
        ends_at: fromIso(day.ends_at),
        location_text: day.location_text ?? "",
        practical_info: day.practical_info ?? "",
        responsible_coach_id:
          day.responsible_coach_id ?? camp.head_coach_user_id ?? "",
        evaluation_enabled: Boolean(day.evaluation_enabled),
        evaluation_criterion_ids: Array.isArray(day.evaluation_criterion_ids) ? day.evaluation_criterion_ids : [],
      })),
    );
    setRegistrations(
      Object.fromEntries(
        (camp.player_registrations ?? []).map((registration) => [
          registration.player_id,
          {
            registration_status: registration.registration_status ?? "invited",
            day_status_by_day_index: registration.day_status_by_day_index ?? {},
          },
        ]),
      ),
    );
    setOptions(
      (camp.options ?? []).map((option) => ({
        ...option,
        id: duplicate ? null : option.id,
        name: option.name ?? "",
        description: option.description ?? "",
        input_type: option.input_type ?? "checkbox",
        choices: Array.isArray(option.choices) ? option.choices : [],
        internal_note: option.internal_note ?? "",
        day_indexes: option.day_indexes ?? [],
        player_assignments: option.player_assignments ?? [],
        assigns_to_all_participants: (camp.player_ids ?? []).every((playerId) =>
          (option.player_assignments ?? []).some(
            (assignment) => assignment.player_id === playerId,
          ),
        ),
      })),
    );
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw new Error("Session invalide.");
        const memberships = await supabase
          .from("club_members")
          .select("club_id,user_id,role,is_active")
          .eq("is_active", true);
        if (memberships.error) throw new Error(memberships.error.message);
        const managerClubIds = unique(
          (memberships.data ?? [])
            .filter(
              (row: any) =>
                row.user_id === auth.user.id && row.role === "manager",
            )
            .map((row: any) => String(row.club_id)),
        );
        if (!managerClubIds.length)
          throw new Error("Aucun club manager disponible.");
        const activeClubId = managerClubIds[0];
        setClubId(activeClubId);
        const memberRows = (memberships.data ?? []).filter(
          (row: any) =>
            row.club_id === activeClubId &&
            ["player", "coach"].includes(row.role),
        );
        const userIds = unique(
          memberRows.map((row: any) => String(row.user_id)),
        );
        const [profilesRes, groupsRes, groupPlayersRes, campsRes] =
          await Promise.all([
            userIds.length
              ? supabase
                  .from("profiles")
                  .select("id,first_name,last_name,avatar_url")
                  .in("id", userIds)
              : Promise.resolve({ data: [], error: null }),
            supabase
              .from("coach_groups")
              .select("id,name,club_id,club_season_id")
              .eq("club_id", activeClubId)
              .eq("is_active", true)
              .order("name"),
            supabase
              .from("coach_group_players")
              .select("group_id,player_user_id"),
            fetch("/api/manager/camps", {
              headers: await authHeaders(),
              cache: "no-store",
            }).then(async (response) => ({
              response,
              payload: await response.json().catch(() => ({})),
            })),
          ]);
        if (profilesRes.error || groupsRes.error || groupPlayersRes.error)
          throw new Error(
            profilesRes.error?.message ??
              groupsRes.error?.message ??
              groupPlayersRes.error?.message,
          );
        if (!campsRes.response.ok)
          throw new Error(
            String(
              campsRes.payload?.error ?? "Impossible de charger les stages.",
            ),
          );
        const profileMap = new Map(
          (profilesRes.data ?? []).map((profile: any) => [
            String(profile.id),
            profile as Profile,
          ]),
        );
        setPlayers(
          memberRows
            .filter((row: any) => row.role === "player")
            .map((row: any) => profileMap.get(String(row.user_id)))
            .filter(Boolean) as Profile[],
        );
        setCoaches(
          memberRows
            .filter((row: any) => row.role === "coach")
            .map((row: any) => profileMap.get(String(row.user_id)))
            .filter(Boolean) as Profile[],
        );
        setGroups(
          ((groupsRes.data ?? []) as Group[]).filter(isAvailableCampGroup),
        );
        const mapping: Record<string, string[]> = {};
        (groupPlayersRes.data ?? []).forEach((row: any) => {
          (mapping[String(row.group_id)] ??= []).push(
            String(row.player_user_id),
          );
        });
        setGroupPlayers(mapping);
        const requested = campId || duplicateId;
        if (requested) {
          const camp = (campsRes.payload?.camps ?? []).find(
            (entry: Camp) => entry.id === requested,
          );
          if (!camp) throw new Error("Stage introuvable.");
          hydrate(camp, Boolean(duplicateId));
        }
      } catch (cause: any) {
        setError(cause?.message ?? "Erreur de chargement.");
      } finally {
        setLoading(false);
      }
    })();
  }, [campId, duplicateId]);

  useEffect(() => {
    setRegistrations((current) =>
      Object.fromEntries(
        playerIds.map((playerId) => [
          playerId,
          current[playerId] ?? {
            registration_status: "invited",
            day_status_by_day_index: {},
          },
        ]),
      ),
    );
  }, [playerIds]);

  useEffect(() => {
    setOptions((current) =>
      current.map((option) => {
        if (!option.assigns_to_all_participants) return option;
        const player_assignments = playerIds.map(
          (player_id) =>
            option.player_assignments.find(
              (assignment) => assignment.player_id === player_id,
            ) ?? { player_id, quantity: 1 },
        );
        const unchanged =
          player_assignments.length === option.player_assignments.length &&
          player_assignments.every(
            (assignment, index) =>
              assignment.player_id === option.player_assignments[index]?.player_id &&
              assignment.quantity === option.player_assignments[index]?.quantity,
          );
        return unchanged ? option : { ...option, player_assignments };
      }),
    );
  }, [playerIds]);
  function toggle(values: string[], value: string) {
    return values.includes(value)
      ? values.filter((entry) => entry !== value)
      : [...values, value];
  }
  function toggleGroup(groupId: string) {
    const selected = !groupIds.includes(groupId);
    setGroupIds((current) => toggle(current, groupId));
    if (selected)
      setPlayerIds((current) =>
        unique([...current, ...(groupPlayers[groupId] ?? [])]),
      );
  }
  function syncGroups() {
    setPlayerIds((current) =>
      unique([...current, ...groupIds.flatMap((id) => groupPlayers[id] ?? [])]),
    );
  }
  function updateDay(index: number, patch: Partial<Day>) {
    setDays((current) =>
      current.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    );
  }
  function move<T>(values: T[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= values.length) return values;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  function updateOption(index: number, patch: Partial<Option>) {
    setOptions((current) =>
      current.map((option, i) =>
        i === index ? { ...option, ...patch } : option,
      ),
    );
  }
  function addOption() {
    setOptions((current) => [
      ...current,
      {
        ...emptyOption(),
        player_assignments: playerIds.map((player_id) => ({
          player_id,
          quantity: 1,
        })),
      },
    ]);
  }
  function optionAssignment(option: Option, playerId: string) {
    return option.player_assignments.find(
      (assignment) => assignment.player_id === playerId,
    );
  }

  async function save(status: "draft" | "scheduled") {
    setSaving(true);
    setError(null);
    try {
      if (!title.trim()) throw new Error("Le nom du stage est requis.");
      let uploadedImageUrl = imageUrl || null;
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.set("club_id", clubId);
        uploadData.set("image", imageFile);
        const uploadResponse = await fetch("/api/manager/camps/image", {
          method: "POST",
          headers: await authHeaders(),
          body: uploadData,
        });
        const uploadPayload = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok || !uploadPayload?.image_url) {
          throw new Error(String(uploadPayload?.error ?? "Upload de l’image impossible."));
        }
        uploadedImageUrl = String(uploadPayload.image_url);
      }
      const validDays = days.filter((day) => day.starts_at && day.ends_at);
      options.forEach((option, index) => {
        if (!String(option.name ?? "").trim())
          throw new Error(`Le nom de l’option ${index + 1} est requis.`);
        if (!option.applies_to_all_days && option.day_indexes.length === 0)
          throw new Error(
            `Sélectionnez au moins une journée pour l’option « ${String(option.name ?? "").trim()} ».`,
          );
        if ((option.input_type === "select" || option.input_type === "radio") && option.choices.filter((choice) => choice.trim()).length < 2)
          throw new Error(`Ajoutez au moins deux choix pour l’option « ${String(option.name ?? "").trim()} ».`);
      });
      if (status === "scheduled") {
        if (!headCoachId) throw new Error("Sélectionnez un head coach.");
        if (!groupIds.length && !playerIds.length)
          throw new Error("Ajoutez au moins un groupe ou un junior.");
        if (!validDays.length) throw new Error("Ajoutez au moins une journée.");
        const keys = new Set<string>();
        validDays.forEach((day, index) => {
          if (new Date(day.ends_at) <= new Date(day.starts_at))
            throw new Error(
              `L’heure de fin de la journée ${index + 1} doit être postérieure à l’heure de début.`,
            );
          const key = `${day.starts_at}|${day.ends_at}|${String(day.location_text ?? "").trim().toLowerCase()}`;
          if (keys.has(key))
            throw new Error("Deux journées identiques ont été détectées.");
          keys.add(key);
        });
      }
      const body = {
        club_id: clubId,
        title: title.trim(),
        notes: normalizeCampRichTextHtml(notes),
        image_url: uploadedImageUrl,
        capacity,
        status,
        group_ids: groupIds,
        player_ids: playerIds,
        coach_ids: coachIds,
        head_coach_user_id: headCoachId,
        days: status === "draft" ? validDays : days,
        options: options.map((option) => ({
          id: option.id,
          name: option.name,
          description: option.description,
          is_active: option.is_active,
          applies_to_all_days: option.applies_to_all_days,
          day_indexes: option.day_indexes,
          capacity: option.capacity,
          allows_quantity: option.allows_quantity,
          input_type: option.input_type,
          choices: option.choices.map((choice) => choice.trim()).filter(Boolean),
          internal_note: option.internal_note,
          player_assignments: option.player_assignments,
        })),
        player_registrations: playerIds.map((playerId) => ({
          player_id: playerId,
          ...(registrations[playerId] ?? {
            registration_status: "invited",
            day_status_by_day_index: {},
          }),
        })),
      };
      const editing = Boolean(campId && !duplicateId);
      const response = await fetch(
        editing ? `/api/manager/camps/${campId}` : "/api/manager/camps",
        {
          method: editing ? "PATCH" : "POST",
          headers: await authHeaders(true),
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(String(payload?.error ?? "Enregistrement impossible."));
      router.push(`/manager/camps/${payload.camp_id}`);
      router.refresh();
    } catch (cause: any) {
      setError(cause?.message ?? "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const selectedPlayers = useMemo(
    () =>
      playerIds
        .map((id) => players.find((player) => player.id === id))
        .filter(Boolean) as Profile[],
    [playerIds, players],
  );
  const optionAssignments = options.reduce(
    (sum, option) => sum + option.player_assignments.length,
    0,
  );
  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
        <Link href="/manager/camps">Stages</Link>
        <ChevronRight size={13} />
        <span>{campId && !duplicateId ? "Modifier" : "Créer"}</span>
      </nav>
      <div className={styles.topline}>
        <div>
          <h1>
            {campId && !duplicateId ? "Modifier le stage" : "Créer un stage"}
          </h1>
        </div>
      </div>
      {error ? (
        <div className={styles.alertError} role="alert">
          {error}
        </div>
      ) : null}
      {loading ? (
        <section className={styles.panel}>
          <ListLoadingBlock label="Préparation du formulaire…" />
        </section>
      ) : (
        <>
          <section className={styles.panel} style={{ order: 1 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Informations générales</h2>
              </div>
            </div>
            <div className={styles.grid2}>
              <label className={styles.field}>
                <span>
                  Nom du stage <i className={styles.required}>*</i>
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Stage de printemps"
                />
              </label>
              <label className={styles.field}>
                <span>Capacité maximale</span>
                <input
                  type="number"
                  min={1}
                  value={capacity ?? ""}
                  onChange={(event) =>
                    setCapacity(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                  placeholder="Sans limite"
                />
              </label>
            </div>
            <div className={styles.imageField}>
              <div className={styles.imageFieldHeader}>
                <div>
                  <span>Image du stage</span>
                  <p>Format 16:9 · JPG, PNG ou WebP · 8 Mo maximum</p>
                </div>
                {imagePreview ? (
                  <button
                    type="button"
                    className={styles.removeImage}
                    onClick={() => {
                      setImageFile(null);
                      setImageUrl("");
                      setImagePreview(null);
                    }}
                  >
                    <X size={14} />
                    Retirer
                  </button>
                ) : null}
              </div>
              {imagePreview ? (
                <label className={styles.imagePreview}>
                  <img src={imagePreview} alt="Aperçu du stage" />
                  <span>Remplacer l’image</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const optimized = await optimizeUploadFile(file, {
                        maxWidth: 1920,
                        maxHeight: 1080,
                        quality: 0.84,
                      });
                      setImageFile(optimized);
                      setImagePreview(URL.createObjectURL(optimized));
                    }}
                  />
                </label>
              ) : (
                <label className={styles.imageDrop}>
                  <ImagePlus size={22} />
                  <span>Ajouter une image</span>
                  <small>Elle sera recadrée proprement en 16:9.</small>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const optimized = await optimizeUploadFile(file, {
                        maxWidth: 1920,
                        maxHeight: 1080,
                        quality: 0.84,
                      });
                      setImageFile(optimized);
                      setImagePreview(URL.createObjectURL(optimized));
                    }}
                  />
                </label>
              )}
            </div>
            <div className={styles.richTextField}>
              <span>Présentation et notes générales</span>
              <TiptapSimpleEditor
                value={notes}
                onChange={setNotes}
                placeholder="Objectifs, matériel à prévoir, informations pratiques…"
              />
            </div>
          </section>

          <section className={styles.panel} style={{ order: 2 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Journées</h2>
                <p>
                  Ajoutez et réordonnez les journées. Chaque journée devient une
                  activité compatible avec le calendrier.
                </p>
              </div>
              <button
                className={styles.secondary}
                type="button"
                onClick={() =>
                  setDays((current) => [
                    ...current,
                    dayAfter(current.at(-1), current.length),
                  ])
                }
              >
                <Plus size={15} />
                Ajouter une journée
              </button>
            </div>
            <div className={styles.stack}>
              {days.map((day, index) => (
                <article
                  className={styles.dayCard}
                  key={`${day.event_id ?? "new"}-${index}`}
                >
                  <div className={styles.cardHead}>
                    <div>
                      <h3>Journée {index + 1}</h3>
                      <span className={styles.muted}>
                        {day.evaluation_enabled
                          ? "Évaluation prévue"
                          : "Sans évaluation"}
                      </span>
                    </div>
                    <div className={styles.cardTools}>
                      <button
                        className={styles.iconButton}
                        type="button"
                        disabled={index === 0}
                        onClick={() =>
                          setDays((current) => move(current, index, -1))
                        }
                        aria-label="Monter la journée"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className={styles.iconButton}
                        type="button"
                        disabled={index === days.length - 1}
                        onClick={() =>
                          setDays((current) => move(current, index, 1))
                        }
                        aria-label="Descendre la journée"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className={`${styles.iconButton} ${styles.dangerIcon}`}
                        type="button"
                        disabled={days.length === 1}
                        onClick={() =>
                          setDays((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                        title="Supprimer"
                        aria-label="Supprimer la journée"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className={styles.grid3}>
                    <label className={styles.field}>
                      <span>
                        Début <i className={styles.required}>*</i>
                      </span>
                      <input
                        type="datetime-local"
                        value={day.starts_at}
                        onChange={(event) =>
                          updateDay(index, { starts_at: event.target.value })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>
                        Fin <i className={styles.required}>*</i>
                      </span>
                      <input
                        type="datetime-local"
                        value={day.ends_at}
                        onChange={(event) =>
                          updateDay(index, { ends_at: event.target.value })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Lieu</span>
                      <input
                        value={day.location_text}
                        onChange={(event) =>
                          updateDay(index, {
                            location_text: event.target.value,
                          })
                        }
                        placeholder="Practice, parcours…"
                      />
                    </label>
                  </div>
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      <span>Coach responsable</span>
                      <select
                        value={day.responsible_coach_id || headCoachId}
                        onChange={(event) =>
                          updateDay(index, {
                            responsible_coach_id: event.target.value,
                          })
                        }
                      >
                        <option value="">Choisir…</option>
                        {coaches.map((coach) => (
                          <option key={coach.id} value={coach.id}>
                            {fullName(coach)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Notes de la journée</span>
                      <input
                        value={day.practical_info}
                        onChange={(event) =>
                          updateDay(index, {
                            practical_info: event.target.value,
                          })
                        }
                        placeholder="Rendez-vous, repas, matériel…"
                      />
                    </label>
                  </div>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={day.evaluation_enabled}
                      onChange={(event) => {
                        if (
                          !event.target.checked &&
                          Number(day.evaluation?.completed ?? 0) > 0 &&
                          !window.confirm(
                            "Des évaluations existent déjà pour cette journée. Elles seront conservées mais la journée ne sera plus proposée à l’évaluation. Continuer ?",
                          )
                        )
                          return;
                        updateDay(index, {
                          evaluation_enabled: event.target.checked,
                        });
                      }}
                    />
                    <span>Journée à évaluer</span>
                  </label>
                  {day.evaluation_enabled ? (
                    <EventCriteriaSelector clubId={clubId} eventType="camp" selectedIds={day.evaluation_criterion_ids ?? []} onChange={(ids) => updateDay(index, { evaluation_criterion_ids: ids })} disabled={saving} />
                  ) : null}
                  <div>
                    <span className={styles.muted}>Coachs additionnels</span>
                    <div className={styles.pillRow}>
                      {coaches
                        .filter(
                          (coach) =>
                            coach.id !==
                            (day.responsible_coach_id || headCoachId),
                        )
                        .map((coach) => (
                          <label className={styles.check} key={coach.id}>
                            <input
                              type="checkbox"
                              checked={day.coach_ids.includes(coach.id)}
                              onChange={() =>
                                updateDay(index, {
                                  coach_ids: toggle(day.coach_ids, coach.id),
                                })
                              }
                            />
                            <span>{fullName(coach)}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel} style={{ order: 3 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Participants</h2>
                <p>
                  Les juniors ajoutés depuis un groupe sont photographiés dans
                  le stage et ne changeront pas silencieusement par la suite.
                </p>
              </div>
              <button
                type="button"
                className={styles.secondary}
                onClick={syncGroups}
              >
                <UserPlus size={15} />
                Synchroniser les groupes
              </button>
            </div>
            <div className={styles.stack}>
              <div className={styles.selectionBlock}>
                <div className={styles.sectionTitle}>
                  <h3>Groupes</h3>
                  <p>Seuls les groupes actifs créés depuis la gestion des groupes sont proposés.</p>
                </div>
                {groups.length === 0 ? <div className={styles.empty}>Aucun groupe standard disponible pour cette saison.</div> : <div className={styles.tableWrap}>
                  <table className={`${styles.peopleTable} ${styles.groupSelectionTable}`}>
                    <thead><tr><th>Groupe</th><th>Juniors</th><th>Sélection</th></tr></thead>
                    <tbody>{groups.map((group) => <tr key={group.id}>
                      <td><b>{group.name}</b></td>
                      <td>{groupPlayers[group.id]?.length ?? 0}</td>
                      <td><label className={styles.check}><input type="checkbox" checked={groupIds.includes(group.id)} onChange={() => toggleGroup(group.id)} /><span>{groupIds.includes(group.id) ? "Sélectionné" : "Ajouter"}</span></label></td>
                    </tr>)}</tbody>
                  </table>
                </div>}
              </div>
              <div className={styles.divider} />
              <div className={styles.tableWrap}>
                <table className={styles.peopleTable}>
                  <thead>
                    <tr>
                      <th aria-label="Avatar"></th>
                      <th>Junior</th>
                      <th>Sélection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((player) => (
                      <tr key={player.id}>
                        <td>
                          <Avatar profile={player} />
                        </td>
                        <td>
                          <b>{fullName(player)}</b>
                        </td>
                        <td>
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={playerIds.includes(player.id)}
                              onChange={() =>
                                setPlayerIds((current) =>
                                  toggle(current, player.id),
                                )
                              }
                            />
                            <span>
                              {playerIds.includes(player.id)
                                ? "Ajouté"
                                : "Ajouter"}
                            </span>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className={styles.panel} style={{ order: 4 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Encadrement</h2>
                <p>
                  Définissez le head coach du stage et les coachs additionnels
                  disponibles pour les journées.
                </p>
              </div>
            </div>
            <label className={styles.field}>
              <span>
                Head coach{" "}
                {days.length ? <i className={styles.required}>*</i> : null}
              </span>
              <select
                value={headCoachId}
                onChange={(event) => {
                  const id = event.target.value;
                  setHeadCoachId(id);
                  setDays((current) =>
                    current.map((day) => ({
                      ...day,
                      responsible_coach_id: day.responsible_coach_id || id,
                    })),
                  );
                }}
              >
                <option value="">Choisir…</option>
                {coaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {fullName(coach)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className={styles.sectionTitle}>
                <h3>Coachs additionnels</h3>
              </div>
              <div className={styles.pillRow}>
                {coaches
                  .filter((coach) => coach.id !== headCoachId)
                  .map((coach) => (
                    <label className={styles.check} key={coach.id}>
                      <input
                        type="checkbox"
                        checked={coachIds.includes(coach.id)}
                        onChange={() =>
                          setCoachIds((current) => toggle(current, coach.id))
                        }
                      />
                      <span>{fullName(coach)}</span>
                    </label>
                  ))}
              </div>
            </div>
          </section>

          <section className={styles.panel} style={{ order: 6 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Participations et présences</h2>
                <p>
                  Une ligne par junior et une colonne par journée. Les statuts
                  utilisent le système de présence existant.
                </p>
              </div>
            </div>
            {selectedPlayers.length === 0 ? (
              <div className={styles.empty}>
                Ajoutez des juniors pour configurer leurs participations.
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.matrix}>
                  <thead>
                    <tr>
                      <th>Junior</th>
                      <th>Inscription</th>
                      {days.map((_, index) => (
                        <th key={index}>Jour {index + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPlayers.map((player) => {
                      const registration = registrations[player.id] ?? {
                        registration_status: "invited",
                        day_status_by_day_index: {},
                      };
                      return (
                        <tr key={player.id}>
                          <td>
                            <div className={styles.person}>
                              <Avatar profile={player} />
                              <b>{fullName(player)}</b>
                            </div>
                          </td>
                          <td>
                            <select
                              value={registration.registration_status}
                              onChange={(event) =>
                                setRegistrations((current) => ({
                                  ...current,
                                  [player.id]: {
                                    ...registration,
                                    registration_status: event.target
                                      .value as Registration["registration_status"],
                                  },
                                }))
                              }
                            >
                              <option value="invited">Invité</option>
                              <option value="registered">Inscrit</option>
                              <option value="declined">Refusé</option>
                            </select>
                          </td>
                          {days.map((_, dayIndex) => (
                            <td key={dayIndex}>
                              <select
                                disabled={
                                  registration.registration_status !==
                                  "registered"
                                }
                                value={
                                  registration.registration_status ===
                                  "registered"
                                    ? (registration.day_status_by_day_index[
                                        String(dayIndex)
                                      ] ?? "expected")
                                    : "not_registered"
                                }
                                onChange={(event) =>
                                  setRegistrations((current) => ({
                                    ...current,
                                    [player.id]: {
                                      ...registration,
                                      day_status_by_day_index: {
                                        ...registration.day_status_by_day_index,
                                        [String(dayIndex)]: event.target
                                          .value as Attendance,
                                      },
                                    },
                                  }))
                                }
                              >
                                <option value="expected">Prévu</option>
                                <option value="present">Présent</option>
                                <option value="excused">Absent excusé</option>
                                <option value="absent">
                                  Absent non excusé
                                </option>
                                <option value="not_registered">
                                  Non inscrit
                                </option>
                              </select>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.panel} style={{ order: 5 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Options facultatives</h2>
                <p>
                  Créez une option valable pour tout le stage, comme « Je
                  dispose d’un abonnement de transport », ou une option limitée
                  à certaines journées. Aucun calcul de facturation n’est
                  effectué.
                </p>
              </div>
              <button
                className={styles.secondary}
                type="button"
                onClick={addOption}
              >
                <Plus size={15} />
                Ajouter une option
              </button>
            </div>
            {options.length === 0 ? (
              <div className={styles.empty}>Aucune option configurée.</div>
            ) : (
              <div className={styles.stack}>
                {options.map((option, index) => (
                  <article
                    className={styles.optionCard}
                    key={`${option.id ?? "new"}-${index}`}
                  >
                    <div className={styles.cardHead}>
                      <h3>Option {index + 1}</h3>
                      <div className={styles.cardTools}>
                        <button
                          className={styles.iconButton}
                          type="button"
                          disabled={!index}
                          onClick={() =>
                            setOptions((current) => move(current, index, -1))
                          }
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className={styles.iconButton}
                          type="button"
                          disabled={index === options.length - 1}
                          onClick={() =>
                            setOptions((current) => move(current, index, 1))
                          }
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          className={`${styles.iconButton} ${styles.dangerIcon}`}
                          type="button"
                          title="Supprimer"
                          aria-label="Supprimer l’option"
                          onClick={() =>
                            setOptions((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className={styles.grid2}>
                      <label className={styles.field}>
                        <span>
                          Nom <i className={styles.required}>*</i>
                        </span>
                        <input
                          value={option.name}
                          onChange={(event) =>
                            updateOption(index, { name: event.target.value })
                          }
                          placeholder="Je dispose d’un abonnement de transport"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Capacité maximale</span>
                        <input
                          type="number"
                          min={1}
                          value={option.capacity ?? ""}
                          onChange={(event) =>
                            updateOption(index, {
                              capacity: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Description</span>
                        <input
                          value={option.description}
                          onChange={(event) =>
                            updateOption(index, {
                              description: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Type de réponse</span>
                        <select
                          value={option.input_type}
                          onChange={(event) => {
                            const inputType = event.target.value as Option["input_type"];
                            updateOption(index, {
                              input_type: inputType,
                              choices: inputType === "checkbox" || inputType === "select" || inputType === "radio"
                                ? (option.choices.length ? option.choices : ["Choix 1", "Choix 2"])
                                : [],
                              allows_quantity: inputType === "checkbox" ? option.allows_quantity : false,
                              assigns_to_all_participants: false,
                              player_assignments: inputType === "checkbox" ? option.player_assignments : [],
                            });
                          }}
                        >
                          <option value="checkbox">Case à cocher</option>
                          <option value="yes_no">Oui / Non</option>
                          <option value="select">Liste déroulante</option>
                          <option value="radio">Boutons radio</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>Note interne</span>
                        <input
                          value={option.internal_note}
                          onChange={(event) =>
                            updateOption(index, {
                              internal_note: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Portée de l’option</span>
                        <select
                          value={
                            option.applies_to_all_days
                              ? "camp"
                              : "selected_days"
                          }
                          onChange={(event) =>
                            updateOption(index, {
                              applies_to_all_days:
                                event.target.value === "camp",
                              day_indexes:
                                event.target.value === "camp"
                                  ? []
                                  : option.day_indexes,
                            })
                          }
                        >
                          <option value="camp">Option de stage</option>
                          <option value="selected_days">
                            Option par journée
                          </option>
                        </select>
                      </label>
                    </div>
                    {option.input_type === "checkbox" || option.input_type === "select" || option.input_type === "radio" ? (
                      <label className={styles.field}>
                        <span>Choix proposés · un par ligne{option.input_type === "checkbox" ? " · facultatif" : ""}</span>
                        <textarea
                          rows={Math.max(3, option.choices.length)}
                          value={option.choices.join("\n")}
                          onChange={(event) => {
                            const choices = event.target.value.split("\n");
                            updateOption(index, {
                              choices,
                              allows_quantity: choices.some((choice) => choice.trim()) ? false : option.allows_quantity,
                              assigns_to_all_participants: choices.some((choice) => choice.trim()) ? false : option.assigns_to_all_participants,
                              player_assignments: choices.some((choice) => choice.trim()) ? [] : option.player_assignments,
                            });
                          }}
                          placeholder={"Matériel inclus\nJe prends mon matériel"}
                        />
                      </label>
                    ) : null}
                    <div className={styles.pillRow}>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={option.is_active}
                          onChange={(event) =>
                            updateOption(index, {
                              is_active: event.target.checked,
                            })
                          }
                        />
                        <span>Option active</span>
                      </label>
                      {option.input_type === "checkbox" && !option.choices.some((choice) => choice.trim()) ? <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={option.allows_quantity}
                          onChange={(event) =>
                            updateOption(index, {
                              allows_quantity: event.target.checked,
                            })
                          }
                        />
                        <span>Quantité par participant</span>
                      </label> : null}
                    </div>
                    {!option.applies_to_all_days ? (
                      <div className={styles.stack}>
                        <div className={styles.sectionTitle}>
                          <h3>Journées concernées</h3>
                          <p>
                            Sélectionnez au moins une journée pour cette option.
                          </p>
                        </div>
                        <div className={styles.pillRow}>
                          {days.map((day, dayIndex) => (
                            <label className={styles.check} key={dayIndex}>
                              <input
                                type="checkbox"
                                checked={option.day_indexes.includes(dayIndex)}
                                onChange={() =>
                                  updateOption(index, {
                                    day_indexes: option.day_indexes.includes(
                                      dayIndex,
                                    )
                                      ? option.day_indexes.filter(
                                          (value) => value !== dayIndex,
                                        )
                                      : [...option.day_indexes, dayIndex],
                                  })
                                }
                              />
                              <span>
                                Jour {dayIndex + 1} · {shortDate(day.starts_at)}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {option.input_type === "checkbox" && !option.choices.some((choice) => choice.trim()) ? <div className={styles.assignmentBlock}>
                      <div className={styles.sectionTitle}>
                        <h3>Attribution aux juniors</h3>
                        <p>
                          {option.player_assignments.reduce(
                            (sum, entry) => sum + entry.quantity,
                            0,
                          )}{" "}
                          sélection(s)
                          {option.capacity
                            ? ` · ${Math.max(0, option.capacity - option.player_assignments.reduce((sum, entry) => sum + entry.quantity, 0))} restante(s)`
                          : ""}
                        </p>
                      </div>
                      <div className={`${styles.pillRow} ${styles.assignmentChoices}`}>
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            checked={option.assigns_to_all_participants}
                            onChange={(event) =>
                              updateOption(index, {
                                assigns_to_all_participants:
                                  event.target.checked,
                                player_assignments: event.target.checked
                                  ? selectedPlayers.map((player) =>
                                      optionAssignment(option, player.id) ?? {
                                        player_id: player.id,
                                        quantity: 1,
                                      },
                                    )
                                  : [],
                              })
                            }
                          />
                          <span>Tous les participants</span>
                        </label>
                      </div>
                      <div className={`${styles.pillRow} ${styles.assignmentChoices}`}>
                        {selectedPlayers.map((player) => {
                          const assignment = optionAssignment(
                            option,
                            player.id,
                          );
                          return (
                            <label className={styles.check} key={player.id}>
                              <input
                                type="checkbox"
                                checked={Boolean(assignment)}
                                onChange={() =>
                                  updateOption(index, {
                                    assigns_to_all_participants: false,
                                    player_assignments: assignment
                                      ? option.player_assignments.filter(
                                          (entry) =>
                                            entry.player_id !== player.id,
                                        )
                                      : [
                                          ...option.player_assignments,
                                          { player_id: player.id, quantity: 1 },
                                        ],
                                  })
                                }
                              />
                              <span>{fullName(player)}</span>
                              {assignment && option.allows_quantity ? (
                                <input
                                  aria-label={`Quantité pour ${fullName(player)}`}
                                  style={{ width: 54, height: 30 }}
                                  type="number"
                                  min={1}
                                  value={assignment.quantity}
                                  onChange={(event) =>
                                    updateOption(index, {
                                      player_assignments:
                                        option.player_assignments.map(
                                          (entry) =>
                                            entry.player_id === player.id
                                              ? {
                                                  ...entry,
                                                  quantity: Math.max(
                                                    1,
                                                    Number(
                                                      event.target.value,
                                                    ) || 1,
                                                  ),
                                                }
                                              : entry,
                                        ),
                                    })
                                  }
                                />
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </div> : <div className={styles.sectionTitle}>
                      <h3>Réponse du joueur</h3>
                      <p>Le joueur renseignera cette option depuis sa page Stages après son inscription.</p>
                    </div>}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={styles.panel} style={{ order: 7 }}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Récapitulatif</h2>
                <p>Vérifiez la configuration avant de planifier le stage.</p>
              </div>
            </div>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span>Journées</span>
                <b>{days.length}</b>
              </div>
              <div className={styles.summaryItem}>
                <span>Participants</span>
                <b>
                  {playerIds.length}
                  {capacity ? ` / ${capacity}` : ""}
                </b>
              </div>
              <div className={styles.summaryItem}>
                <span>Encadrement</span>
                <b>
                  {headCoachId ? 1 + coachIds.length : coachIds.length} coach(s)
                </b>
              </div>
              <div className={styles.summaryItem}>
                <span>Journées évaluables</span>
                <b>{days.filter((day) => day.evaluation_enabled).length}</b>
              </div>
              <div className={styles.summaryItem}>
                <span>Options</span>
                <b>{options.length}</b>
              </div>
              <div className={styles.summaryItem}>
                <span>Attributions d’options</span>
                <b>{optionAssignments}</b>
              </div>
            </div>
            {capacity != null && playerIds.length > capacity ? (
              <div className={styles.alertWarning}>
                La capacité du stage est dépassée de{" "}
                {playerIds.length - capacity} place(s).
              </div>
            ) : null}
          </section>
          <div className={styles.stickyActions} style={{ order: 8 }}>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondary}
                disabled={saving}
                onClick={() => void save("draft")}
              >
                <Save size={15} />
                {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={saving}
                onClick={() => void save("scheduled")}
              >
                <Save size={15} />
                {saving ? "Enregistrement…" : "Planifier le stage"}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
