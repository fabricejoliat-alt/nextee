"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Bell, CalendarClock, Mail, Pencil, PlusCircle, Search, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

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
  };
  news: NewsRow[];
};

type NewsFormState = {
  title: string;
  summary: string;
  body: string;
  status: NewsStatus;
  scheduled_for: string;
  send_notification: boolean;
  send_email: boolean;
  include_linked_parents: boolean;
  linked_club_event_id: string;
  linked_camp_id: string;
  targets: NewsTarget[];
};

const FIELD_INPUT_STYLE: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(0,0,0,0.10)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "#fff",
  minHeight: 42,
};

function emptyForm(): NewsFormState {
  return {
    title: "",
    summary: "",
    body: "",
    status: "draft",
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

function statusStyle(status: NewsStatus) {
  if (status === "published") return { background: "#dcfce7", color: "#166534" };
  if (status === "scheduled") return { background: "#dbeafe", color: "#1d4ed8" };
  if (status === "archived") return { background: "#f3f4f6", color: "#4b5563" };
  return { background: "#fef3c7", color: "#92400e" };
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
  const date = formatDateTime(option.starts_at);
  return `${option.title} • ${eventTypeLabel(option.event_type)}${date !== "—" ? ` • ${date}` : ""}`;
}

function linkedCampOptionLabel(option: LinkedCampOption) {
  const date = formatDateTime(option.created_at);
  return `${option.title}${date !== "—" ? ` • ${date}` : ""}`;
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
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupCategories, setGroupCategories] = useState<string[]>([]);
  const [ageBands, setAgeBands] = useState<AgeBandOption[]>([]);
  const [linkedEvents, setLinkedEvents] = useState<LinkedEventOption[]>([]);
  const [linkedCamps, setLinkedCamps] = useState<LinkedCampOption[]>([]);
  const [news, setNews] = useState<NewsRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [form, setForm] = useState<NewsFormState>(emptyForm);

  async function authHeaders() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function load(clubId?: string) {
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

      setClubs(Array.isArray(json.clubs) ? json.clubs : []);
      setSelectedClubId(String(json.selected_club_id ?? ""));
      setMembers(Array.isArray(json.target_options?.members) ? json.target_options.members : []);
      setGroups(Array.isArray(json.target_options?.groups) ? json.target_options.groups : []);
      setGroupCategories(Array.isArray(json.target_options?.group_categories) ? json.target_options.group_categories : []);
      setAgeBands(Array.isArray(json.target_options?.age_bands) ? json.target_options.age_bands : []);
      setLinkedEvents(Array.isArray(json.target_options?.club_events) ? json.target_options.club_events : []);
      setLinkedCamps(Array.isArray(json.target_options?.camps) ? json.target_options.camps : []);
      setNews(Array.isArray(json.news) ? json.news : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les actualités.");
      setClubs([]);
      setMembers([]);
      setGroups([]);
      setGroupCategories([]);
      setAgeBands([]);
      setLinkedEvents([]);
      setLinkedCamps([]);
      setNews([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
      body: row.body,
      status: row.status,
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
      };
      const res = await fetch(editingNewsId ? `/api/manager/news/${editingNewsId}` : "/api/manager/news", {
        method: editingNewsId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Enregistrement impossible."));

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

  async function deleteNews(newsId: string) {
    const confirmed = window.confirm("Supprimer cette actualité ?");
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/manager/news/${newsId}`, {
        method: "DELETE",
        headers,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Suppression impossible."));
      setMessage("Actualité supprimée.");
      await load(selectedClubId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Suppression impossible.");
    }
  }

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <ListLoadingBlock lines={8} />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="glass-section">
        <div className="glass-card" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Actualités
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(0,0,0,0.62)" }}>
                Module pour publier des news ciblées avec notification in-app immédiate. La programmation est déjà stockée; l’exécution automatique sera branchée dans la prochaine passe.
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={openCreateForm}>
              <PlusCircle size={16} style={{ marginRight: 6 }} />
              Nouvelle actualité
            </button>
          </div>

          <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Organisation</span>
            <select
              className="input"
              value={selectedClubId}
              onChange={(event) => {
                const nextClubId = event.target.value;
                setSelectedClubId(nextClubId);
                void load(nextClubId);
              }}
            >
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </div>

          {message ? <div style={{ color: "#166534", fontWeight: 800 }}>{message}</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div> : null}
        </div>
      </div>

      {formOpen ? (
        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 16 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {editingNewsId ? "Modifier l’actualité" : "Créer une actualité"}
            </div>

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
              <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Accroche courte</span>
              <input
                className="input"
                value={form.summary}
                onChange={(event) => setForm((previous) => ({ ...previous, summary: event.target.value }))}
                placeholder="Résumé visible dans la notification"
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Contenu</span>
              <textarea
                value={form.body}
                onChange={(event) => setForm((previous) => ({ ...previous, body: event.target.value }))}
                style={{ ...FIELD_INPUT_STYLE, minHeight: 180, resize: "vertical" }}
                placeholder="Contenu de l’actualité"
              />
            </label>

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

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Lier à un événement club</span>
                <select
                  className="input"
                  value={form.linked_club_event_id}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      linked_club_event_id: event.target.value,
                      linked_camp_id: event.target.value ? "" : previous.linked_camp_id,
                    }))
                  }
                >
                  <option value="">Aucun</option>
                  {linkedEvents.map((row) => (
                    <option key={row.id} value={row.id}>
                      {linkedEventOptionLabel(row)}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Lier à un stage/camp</span>
                <select
                  className="input"
                  value={form.linked_camp_id}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      linked_camp_id: event.target.value,
                      linked_club_event_id: event.target.value ? "" : previous.linked_club_event_id,
                    }))
                  }
                >
                  <option value="">Aucun</option>
                  {linkedCamps.map((row) => (
                    <option key={row.id} value={row.id}>
                      {linkedCampOptionLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Diffusion</div>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={form.send_notification}
                  onChange={(event) => setForm((previous) => ({ ...previous, send_notification: event.target.checked }))}
                />
                Envoyer une notification in-app
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={form.send_email}
                  onChange={(event) => setForm((previous) => ({ ...previous, send_email: event.target.checked }))}
                />
                Envoyer aussi un e-mail
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={form.include_linked_parents}
                  onChange={(event) => setForm((previous) => ({ ...previous, include_linked_parents: event.target.checked }))}
                />
                Inclure les parents liés des joueurs ciblés
              </label>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Ciblage
              </div>

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
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Tranches d’âge</div>
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
                          const checked = form.targets.some((item) => targetKey(item) === targetKey(target));
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
            </div>

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
                <button type="button" className="btn" onClick={() => setFormOpen(false)} disabled={saving}>
                  Annuler
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void submitForm()} disabled={saving}>
                  {saving ? "Enregistrement..." : editingNewsId ? "Mettre à jour" : "Créer l’actualité"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="glass-section">
        <div className="glass-card" style={{ display: "grid", gap: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            Actualités existantes
          </div>

          {news.length === 0 ? (
            <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune actualité pour le moment.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {news.map((row) => {
                const badge = statusStyle(row.status);
                const notificationCount = Number(row.last_dispatch_result?.notification_sent_count ?? 0);
                const emailCount = Number(row.last_dispatch_result?.email_sent_count ?? 0);
                return (
                  <div
                    key={row.id}
                    style={{
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 16,
                      background: "rgba(255,255,255,0.86)",
                      padding: 16,
                      display: "grid",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              borderRadius: 999,
                              padding: "7px 10px",
                              fontSize: 12,
                              fontWeight: 900,
                              background: badge.background,
                              color: badge.color,
                            }}
                          >
                            {statusLabel(row.status)}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            Créée par {row.created_by_name ?? "Manager"}
                          </span>
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "rgba(0,0,0,0.84)" }}>{row.title}</div>
                        {row.summary ? (
                          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(0,0,0,0.62)" }}>{row.summary}</div>
                        ) : null}
                        {row.linked_club_event_label || row.linked_camp_label ? (
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.56)" }}>
                            {row.linked_club_event_label
                              ? `Événement lié: ${row.linked_club_event_label}`
                              : `Stage/Camp lié: ${row.linked_camp_label}`}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="btn" onClick={() => openEditForm(row)}>
                          <Pencil size={14} style={{ marginRight: 6 }} />
                          Modifier
                        </button>
                        <button type="button" className="btn btn-danger soft" onClick={() => void deleteNews(row.id)}>
                          <Trash2 size={14} style={{ marginRight: 6 }} />
                          Supprimer
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(0,0,0,0.78)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {row.body}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(255,255,255,0.72)",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}>
                          <CalendarClock size={14} />
                          Date
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                          {row.status === "scheduled" ? formatDateTime(row.scheduled_for) : formatDateTime(row.published_at || row.created_at)}
                        </div>
                      </div>

                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(255,255,255,0.72)",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}>
                          <Bell size={14} />
                          Notification
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                          {row.send_notification ? `${notificationCount} destinataire(s)` : "Désactivée"}
                        </div>
                      </div>

                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(255,255,255,0.72)",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}>
                          <Mail size={14} />
                          E-mail
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                          {row.send_email ? `${emailCount} envoi(s)` : "Désactivé"}
                        </div>
                      </div>

                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(255,255,255,0.72)",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}>
                          <Users size={14} />
                          Parents liés
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                          {row.include_linked_parents ? "Inclus" : "Non inclus"}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {row.targets.map((target) => (
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
