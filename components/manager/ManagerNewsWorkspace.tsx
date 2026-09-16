"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, PlusCircle, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { TiptapSimpleEditor } from "@/components/ui/TiptapSimpleEditor";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import listStyles from "@/app/manager/camps/Camps.module.css";
import newsStyles from "@/components/manager/ManagerNewsWorkspace.module.css";

type NewsStatus = "draft" | "scheduled" | "published" | "archived";
type NewsTargetType = "role" | "user" | "group" | "group_category" | "age_band";
type MemberRole = "manager" | "coach" | "player" | "parent";

type NewsTarget = {
  target_type: NewsTargetType;
  target_value: string;
};

type ClubOption = {
  id: string;
  name: string;
};

type MemberOption = {
  user_id: string;
  role: MemberRole;
  full_name: string;
  birth_date: string | null;
};

type GroupOption = {
  id: string;
  name: string;
};

type LinkedEventOption = {
  id: string;
  title: string;
  event_type: string | null;
  starts_at: string | null;
  target_user_ids: string[];
  group_name: string | null;
  head_coach_name: string | null;
};

type LinkedCampOption = {
  id: string;
  title: string;
  created_at: string | null;
  status: string | null;
};

type AgeBandOption = {
  key: string;
  label: string;
};

type NewsRow = {
  id: string;
  club_id: string;
  title: string;
  summary: string | null;
  body: string;
  status: NewsStatus;
  visible_on_home: boolean;
  scheduled_for: string | null;
  published_at: string | null;
  send_notification: boolean;
  send_email: boolean;
  include_linked_parents: boolean;
  last_notification_sent_at: string | null;
  last_email_sent_at: string | null;
  last_dispatch_result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  linked_club_event_id: string | null;
  linked_camp_id: string | null;
  linked_club_event_label: string | null;
  linked_camp_label: string | null;
  targets: NewsTarget[];
};

type BootstrapResponse = {
  clubs: ClubOption[];
  selected_club_id: string;
  target_options: {
    clubs: ClubOption[];
    members: MemberOption[];
    groups: GroupOption[];
    group_categories: string[];
    age_bands: AgeBandOption[];
    club_events: LinkedEventOption[];
    camps: LinkedCampOption[];
    group_player_user_ids_by_group_id: Record<string, string[]>;
    group_coach_user_ids_by_group_id: Record<string, string[]>;
    group_ids_by_category: Record<string, string[]>;
  };
  news: NewsRow[];
};

type NewsFormState = {
  title: string;
  summary: string;
  body: string;
  status: NewsStatus;
  visible_on_home: boolean;
  scheduled_for: string;
  send_notification: boolean;
  send_email: boolean;
  include_linked_parents: boolean;
  linked_club_event_id: string;
  linked_camp_id: string;
  targets: NewsTarget[];
};

function emptyForm(): NewsFormState {
  return {
    title: "",
    summary: "",
    body: "",
    status: "draft",
    visible_on_home: false,
    scheduled_for: "",
    send_notification: true,
    send_email: false,
    include_linked_parents: false,
    linked_club_event_id: "",
    linked_camp_id: "",
    targets: [],
  };
}

function roleLabel(role: MemberRole) {
  if (role === "player") return "Joueur";
  if (role === "parent") return "Parent";
  if (role === "coach") return "Coach";
  return "Manager";
}

function statusLabel(status: NewsStatus) {
  if (status === "published") return "Publiée";
  if (status === "scheduled") return "Programmée";
  if (status === "archived") return "Archivée";
  return "Brouillon";
}

function statusBadgeClass(status: NewsStatus) {
  if (status === "published") return listStyles.badgeDone;
  if (status === "scheduled") return listStyles.badgeProgress;
  if (status === "archived") return listStyles.badgeArchived;
  return listStyles.badgeDraft;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function eventTypeLabel(value: string | null) {
  if (value === "training") return "Entraînement";
  if (value === "interclub") return "Interclub";
  if (value === "camp") return "Stage/Camp";
  if (value === "session") return "Séance";
  if (value === "event") return "Événement";
  return "Événement";
}

function linkedEventOptionLabel(option: LinkedEventOption) {
  const date = option.starts_at ? formatDateTime(option.starts_at) : "Date inconnue";
  const title = option.title && option.title !== "Événement" ? ` · ${option.title}` : "";
  return `${eventTypeLabel(option.event_type)}${title} · ${option.group_name ?? "Groupe spécifique"} · ${date} · Coach: ${option.head_coach_name ?? "Non défini"}`;
}

function toDatetimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (raw: number) => String(raw).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function ageBandKeyFromBirthDate(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDelta = now.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) age -= 1;
  if (age <= 10) return "u10";
  if (age <= 12) return "u12";
  if (age <= 14) return "u14";
  if (age <= 16) return "u16";
  if (age <= 18) return "u18";
  return "adult";
}

function targetKey(target: NewsTarget) {
  return `${target.target_type}:${target.target_value}`;
}

function targetLabel(
  target: NewsTarget,
  members: MemberOption[],
  groups: GroupOption[],
  ageBands: AgeBandOption[]
) {
  if (target.target_type === "role") return `Role: ${roleLabel(target.target_value as MemberRole)}`;
  if (target.target_type === "user") {
    const member = members.find((row) => row.user_id === target.target_value);
    return member ? `${member.full_name} (${roleLabel(member.role)})` : "Utilisateur";
  }
  if (target.target_type === "group") {
    const group = groups.find((row) => row.id === target.target_value);
    return group ? `Groupe: ${group.name}` : "Groupe";
  }
  if (target.target_type === "group_category") return `Catégorie: ${target.target_value}`;
  const band = ageBands.find((row) => row.key === target.target_value);
  return band ? `Âge: ${band.label}` : `Âge: ${target.target_value}`;
}

function toggleTarget(current: NewsTarget[], target: NewsTarget) {
  const key = targetKey(target);
  return current.some((item) => targetKey(item) === key)
    ? current.filter((item) => targetKey(item) !== key)
    : [...current, target];
}

export default function ManagerNewsWorkspace() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupCategories, setGroupCategories] = useState<string[]>([]);
  const [ageBands, setAgeBands] = useState<AgeBandOption[]>([]);
  const [linkedEvents, setLinkedEvents] = useState<LinkedEventOption[]>([]);
  const [groupPlayerUserIdsByGroupId, setGroupPlayerUserIdsByGroupId] = useState<Record<string, string[]>>({});
  const [groupCoachUserIdsByGroupId, setGroupCoachUserIdsByGroupId] = useState<Record<string, string[]>>({});
  const [groupIdsByCategory, setGroupIdsByCategory] = useState<Record<string, string[]>>({});
  const [news, setNews] = useState<NewsRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
  const [deletingNewsId, setDeletingNewsId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [form, setForm] = useState<NewsFormState>(emptyForm);

  const authHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async (clubId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const query = clubId ? `?club_id=${encodeURIComponent(clubId)}` : "";
      const res = await fetch(`/api/manager/news${query}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as BootstrapResponse & { error?: string };
      if (!res.ok) throw new Error(String(json?.error ?? "Impossible de charger les actualités."));

      setSelectedClubId(String(json.selected_club_id ?? ""));
      setMembers(Array.isArray(json.target_options?.members) ? json.target_options.members : []);
      setGroups(Array.isArray(json.target_options?.groups) ? json.target_options.groups : []);
      setGroupCategories(Array.isArray(json.target_options?.group_categories) ? json.target_options.group_categories : []);
      setAgeBands(Array.isArray(json.target_options?.age_bands) ? json.target_options.age_bands : []);
      setLinkedEvents(Array.isArray(json.target_options?.club_events) ? json.target_options.club_events : []);
      setGroupPlayerUserIdsByGroupId(json.target_options?.group_player_user_ids_by_group_id ?? {});
      setGroupCoachUserIdsByGroupId(json.target_options?.group_coach_user_ids_by_group_id ?? {});
      setGroupIdsByCategory(json.target_options?.group_ids_by_category ?? {});
      setNews(Array.isArray(json.news) ? json.news : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les actualités.");
      setMembers([]);
      setGroups([]);
      setGroupCategories([]);
      setAgeBands([]);
      setLinkedEvents([]);
      setGroupPlayerUserIdsByGroupId({});
      setGroupCoachUserIdsByGroupId({});
      setGroupIdsByCategory({});
      setNews([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredMembers = useMemo(() => {
    const query = normalizeSearch(memberSearch);
    if (!query) return members;
    return members.filter((member) => normalizeSearch(`${member.full_name} ${roleLabel(member.role)}`).includes(query));
  }, [memberSearch, members]);

  const memberGroups = useMemo(() => {
    return {
      players: filteredMembers.filter((member) => member.role === "player"),
      parents: filteredMembers.filter((member) => member.role === "parent"),
      coaches: filteredMembers.filter((member) => member.role === "coach"),
      managers: filteredMembers.filter((member) => member.role === "manager"),
    };
  }, [filteredMembers]);

  const indirectlySelectedUserIds = useMemo(() => {
    const selected = new Set<string>();
    const selectedRoles = new Set(
      form.targets.filter((target) => target.target_type === "role").map((target) => target.target_value)
    );
    const selectedGroupIds = new Set(
      form.targets.filter((target) => target.target_type === "group").map((target) => target.target_value)
    );
    const selectedCategoryValues = form.targets
      .filter((target) => target.target_type === "group_category")
      .map((target) => target.target_value);
    const selectedAgeBands = new Set(
      form.targets.filter((target) => target.target_type === "age_band").map((target) => target.target_value)
    );

    for (const category of selectedCategoryValues) {
      for (const groupId of groupIdsByCategory[category] ?? []) selectedGroupIds.add(groupId);
    }

    for (const groupId of selectedGroupIds) {
      for (const userId of groupPlayerUserIdsByGroupId[groupId] ?? []) selected.add(userId);
      for (const userId of groupCoachUserIdsByGroupId[groupId] ?? []) selected.add(userId);
    }

    if (selectedRoles.size > 0) {
      for (const member of members) {
        if (selectedRoles.has(member.role)) selected.add(member.user_id);
      }
    }

    if (selectedAgeBands.size > 0) {
      for (const member of members) {
        if (member.role !== "player") continue;
        const band = ageBandKeyFromBirthDate(member.birth_date);
        if (band && selectedAgeBands.has(band)) selected.add(member.user_id);
      }
    }

    return selected;
  }, [form.targets, groupIdsByCategory, groupPlayerUserIdsByGroupId, groupCoachUserIdsByGroupId, members]);

  const linkedActivity = useMemo(
    () => linkedEvents.find((event) => event.id === form.linked_club_event_id) ?? null,
    [form.linked_club_event_id, linkedEvents]
  );
  const targetsLockedByActivity = Boolean(linkedActivity);

  function linkActivity(eventId: string) {
    const activity = linkedEvents.find((item) => item.id === eventId);
    setForm((previous) => ({
      ...previous,
      linked_club_event_id: eventId,
      linked_camp_id: "",
      targets: activity
        ? activity.target_user_ids.map((userId) => ({ target_type: "user" as const, target_value: userId }))
        : previous.targets,
    }));
  }

  function openCreateForm() {
    setEditingNewsId(null);
    setForm(emptyForm());
    setFormOpen(true);
    setMessage(null);
    setError(null);
  }

  function openEditForm(row: NewsRow) {
    setEditingNewsId(row.id);
    setForm({
      title: row.title,
      summary: row.summary ?? "",
      body: normalizeCampRichTextHtml(row.body),
      status: row.status,
      visible_on_home: row.visible_on_home,
      scheduled_for: toDatetimeLocal(row.scheduled_for),
      send_notification: row.send_notification,
      send_email: row.send_email,
      include_linked_parents: row.include_linked_parents,
      linked_club_event_id: row.linked_club_event_id ?? "",
      linked_camp_id: row.linked_camp_id ?? "",
      targets: row.targets,
    });
    setFormOpen(true);
    setMessage(null);
    setError(null);
  }

  async function submitForm() {
    if (!selectedClubId) {
      setError("Choisis une organisation.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const headers = await authHeaders();
      const payload = {
        club_id: selectedClubId,
        ...form,
        body: normalizeCampRichTextHtml(form.body),
      };
      const res = await fetch(editingNewsId ? `/api/manager/news/${editingNewsId}` : "/api/manager/news", {
        method: editingNewsId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(String(json.error ?? "Enregistrement impossible."));

      setFormOpen(false);
      setEditingNewsId(null);
      setForm(emptyForm());
      setMessage(editingNewsId ? "Actualité mise à jour." : "Actualité créée.");
      await load(selectedClubId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNews(row: NewsRow) {
    const confirmed = window.confirm(`Supprimer l’actualité « ${row.title} » ?`);
    if (!confirmed) return;

    setDeletingNewsId(row.id);
    setError(null);
    setMessage(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/manager/news/${row.id}`, {
        method: "DELETE",
        headers,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(String(json.error ?? "Suppression impossible."));
      setMessage("Actualité supprimée.");
      await load(selectedClubId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Suppression impossible.");
    } finally {
      setDeletingNewsId(null);
    }
  }

  return (
    <main className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager">Manager</Link><span aria-hidden="true" style={{ margin: "0 8px" }}>/</span><span>Actualités</span>
      </nav>
      <div className={styles.topline}>
        <div><h1>Actualités</h1><p className={styles.lead}>Créez et diffusez des informations ciblées à votre club.</p></div>
        <button type="button" className={actionStyles.primaryButton} onClick={openCreateForm}><PlusCircle size={16} />Nouvelle actualité</button>
      </div>
      {message ? <div className={actionStyles.successAlert}>{message}</div> : null}
      {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}

      {formOpen ? (
        <>
          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{editingNewsId ? "Modifier l’actualité" : "Créer l’actualité"}</h2><p>Rédigez le contenu et associez, si besoin, une activité planifiée.</p></div></div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(220px,280px)", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Titre</span>
                <input
                  className="input"
                  value={form.title}
                  onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
                  placeholder="Titre de l’actualité"
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Statut</span>
                <select
                  className="input"
                  value={form.status}
                  onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value as NewsStatus }))}
                >
                  <option value="draft">Brouillon</option>
                  <option value="scheduled">Programmée</option>
                  <option value="published">Publier maintenant</option>
                  <option value="archived">Archiver</option>
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Accroche courte (optionnel)</span>
              <input
                className="input"
                value={form.summary}
                onChange={(event) => setForm((previous) => ({ ...previous, summary: event.target.value }))}
                placeholder="Résumé visible dans la notification"
              />
            </label>

            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Contenu (optionnel)</span>
              <TiptapSimpleEditor
                value={form.body}
                onChange={(value) => setForm((previous) => ({ ...previous, body: value }))}
                placeholder="Contenu de l’actualité"
              />
            </div>

            {form.status === "scheduled" ? (
              <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Date de programmation</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.scheduled_for}
                  onChange={(event) => setForm((previous) => ({ ...previous, scheduled_for: event.target.value }))}
                />
              </label>
            ) : null}

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Lier à une activité planifiée</span>
                <select
                  className="input"
                  value={form.linked_club_event_id}
                  onChange={(event) => linkActivity(event.target.value)}
                >
                  <option value="">Aucun</option>
                  {linkedEvents.map((row) => (
                    <option key={row.id} value={row.id}>
                      {linkedEventOptionLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>Diffusion</h2><p>Choisissez les canaux d’envoi et la visibilité de cette actualité.</p></div></div>
            <div style={{ display: "grid", gap: 10 }}>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.send_notification}
                  onChange={(event) => setForm((previous) => ({ ...previous, send_notification: event.target.checked }))}
                />
                Envoyer une notification dans l’application
              </label>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.send_email}
                  onChange={(event) => setForm((previous) => ({ ...previous, send_email: event.target.checked }))}
                />
                Envoyer un e-mail de notification
              </label>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.include_linked_parents}
                  onChange={(event) => setForm((previous) => ({ ...previous, include_linked_parents: event.target.checked }))}
                />
                Inclure les parents liés des joueurs ciblés
              </label>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.visible_on_home}
                  onChange={(event) => setForm((previous) => ({ ...previous, visible_on_home: event.target.checked }))}
                />
                Afficher sur l’accueil
              </label>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>Ciblage</h2><p>Sélectionnez les rôles, groupes ou personnes qui recevront cette actualité.</p></div></div>
            <fieldset className="manager-news-targeting" disabled={targetsLockedByActivity} style={{ display: "grid", gap: 14, minWidth: 0, margin: 0, padding: 0, border: 0 }}>
              {targetsLockedByActivity ? (
                <p style={{ margin: 0, color: "#778278", fontSize: 12, fontWeight: 700 }}>
                  Les cibles correspondent aux joueurs et coachs de l’activité liée.
                </p>
              ) : null}

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Rôles entiers</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {(["player", "parent", "coach", "manager"] as MemberRole[]).map((role) => {
                    const target = { target_type: "role" as const, target_value: role };
                    const checked = form.targets.some((item) => targetKey(item) === targetKey(target));
                    return (
                      <label
                        key={role}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 999,
                          padding: "8px 12px",
                          background: checked ? "rgba(34,197,94,0.12)" : "#fff",
                          fontWeight: 800,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((previous) => ({ ...previous, targets: toggleTarget(previous.targets, target) }))
                          }
                        />
                        {roleLabel(role)}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Groupes</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {groups.map((group) => {
                    const target = { target_type: "group" as const, target_value: group.id };
                    const checked = form.targets.some((item) => targetKey(item) === targetKey(target));
                    return (
                      <label
                        key={group.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 999,
                          padding: "8px 12px",
                          background: checked ? "rgba(59,130,246,0.10)" : "#fff",
                          fontWeight: 800,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((previous) => ({ ...previous, targets: toggleTarget(previous.targets, target) }))
                          }
                        />
                        {group.name}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Catégories de groupe</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {groupCategories.map((category) => {
                    const target = { target_type: "group_category" as const, target_value: category };
                    const checked = form.targets.some((item) => targetKey(item) === targetKey(target));
                    return (
                      <label
                        key={category}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 999,
                          padding: "8px 12px",
                          background: checked ? "rgba(168,85,247,0.10)" : "#fff",
                          fontWeight: 800,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((previous) => ({ ...previous, targets: toggleTarget(previous.targets, target) }))
                          }
                        />
                        {category}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Tranche d’âge</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {ageBands.map((band) => {
                    const target = { target_type: "age_band" as const, target_value: band.key };
                    const checked = form.targets.some((item) => targetKey(item) === targetKey(target));
                    return (
                      <label
                        key={band.key}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 999,
                          padding: "8px 12px",
                          background: checked ? "rgba(245,158,11,0.14)" : "#fff",
                          fontWeight: 800,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((previous) => ({ ...previous, targets: toggleTarget(previous.targets, target) }))
                          }
                        />
                        {band.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Utilisateurs individuels</div>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      border: "1px solid rgba(0,0,0,0.10)",
                      borderRadius: 12,
                      padding: "8px 10px",
                      background: "#fff",
                    }}
                  >
                    <Search size={14} />
                    <input
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="Rechercher un utilisateur"
                      style={{ border: 0, outline: 0, background: "transparent", minWidth: 220 }}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
                  {[
                    { label: "Joueurs", rows: memberGroups.players },
                    { label: "Parents", rows: memberGroups.parents },
                    { label: "Coachs", rows: memberGroups.coaches },
                    { label: "Managers", rows: memberGroups.managers },
                  ].map((group) => (
                    <div
                      key={group.label}
                      style={{
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 14,
                        background: "rgba(255,255,255,0.8)",
                        padding: 12,
                        display: "grid",
                        gap: 10,
                        alignContent: "start",
                        minHeight: 180,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{group.label}</div>
                      <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                        {group.rows.map((member) => {
                          const target = { target_type: "user" as const, target_value: member.user_id };
                          const checked =
                            form.targets.some((item) => targetKey(item) === targetKey(target)) ||
                            indirectlySelectedUserIds.has(member.user_id);
                          return (
                            <label key={member.user_id} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setForm((previous) => ({ ...previous, targets: toggleTarget(previous.targets, target) }))
                                }
                              />
                              <span>{member.full_name}</span>
                            </label>
                          );
                        })}
                        {group.rows.length === 0 ? (
                          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.45)" }}>Aucun résultat</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </fieldset>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {form.targets.map((target) => (
                  <span
                    key={targetKey(target)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 999,
                      padding: "7px 10px",
                      background: "rgba(0,0,0,0.06)",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {targetLabel(target, members, groups, ageBands)}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={actionStyles.secondaryButton} onClick={() => setFormOpen(false)} disabled={saving}>
                  Annuler
                </button>
                <button type="button" className={actionStyles.primaryButton} onClick={() => void submitForm()} disabled={saving}>
                  {saving ? "Enregistrement..." : editingNewsId ? "Mettre à jour" : "Créer l’actualité"}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section className={listStyles.panel}>
        <div className={listStyles.panelHeader}>
          <div>
            <h2>Liste des actualités</h2>
            <p>
              {loading
                ? "Chargement..."
                : `${news.length} actualité${news.length > 1 ? "s" : ""} affichée${news.length > 1 ? "s" : ""}.`}
            </p>
          </div>
        </div>

        {loading ? (
          <ListLoadingBlock label="Chargement des actualités..." />
        ) : news.length === 0 ? (
          <div className={listStyles.empty}>Aucune actualité pour le moment.</div>
        ) : (
          <div className={listStyles.tableWrap}>
            <table className={`${listStyles.table} ${newsStyles.newsTable}`}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Titre</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {news.map((row) => {
                  const displayDate = row.status === "scheduled" ? row.scheduled_for : row.published_at || row.created_at;

                  return (
                    <tr key={row.id}>
                      <td data-label="Date" className={newsStyles.dateCell}>
                        {formatDateTime(displayDate)}
                      </td>
                      <td data-label="Titre">
                        <div className={listStyles.titleCell}>
                          <b>{row.title}</b>
                        </div>
                      </td>
                      <td data-label="Statut">
                        <span className={`${listStyles.badge} ${statusBadgeClass(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td data-label="Actions">
                        <div className={listStyles.actions}>
                          <button
                            type="button"
                            className={listStyles.iconButton}
                            title="Modifier"
                            aria-label={`Modifier ${row.title}`}
                            onClick={() => openEditForm(row)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className={`${listStyles.iconButton} ${listStyles.dangerIcon}`}
                            title="Supprimer"
                            aria-label={`Supprimer ${row.title}`}
                            disabled={deletingNewsId === row.id}
                            onClick={() => void deleteNews(row)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
