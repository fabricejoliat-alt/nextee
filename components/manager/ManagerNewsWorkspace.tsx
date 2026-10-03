"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { managerContentPresentation } from "@/lib/managerContentPresentation";
import { managerLocaleTag, managerActivityLabel } from "@/lib/managerLocale";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import ManagerClubSelect from "@/components/manager/ManagerClubSelect";
import { useManagerClubChangeGuard } from "@/components/manager/useManagerClubChangeGuard";
import Link from "next/link";
import { ImagePlus, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { TiptapSimpleEditor } from "@/components/ui/TiptapSimpleEditor";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import { optimizeUploadFile } from "@/lib/clientUploadFiles";
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
  image_url: string | null;
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

type PlatformNewsRow = Pick<NewsRow, "id" | "title" | "image_url" | "summary" | "body" | "status" | "scheduled_for" | "published_at" | "created_at">;

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
  platform_news: PlatformNewsRow[];
};

type NewsFormState = {
  title: string;
  image_url: string;
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
    image_url: "",
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





function statusBadgeClass(status: NewsStatus) {
  if (status === "published") return listStyles.badgeDone;
  if (status === "scheduled") return listStyles.badgeProgress;
  if (status === "archived") return listStyles.badgeArchived;
  return listStyles.badgeDraft;
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



function toggleTarget(current: NewsTarget[], target: NewsTarget) {
  const key = targetKey(target);
  return current.some((item) => targetKey(item) === key)
    ? current.filter((item) => targetKey(item) !== key)
    : [...current, target];
}

export default function ManagerNewsWorkspace() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedClubId = searchParams.get("club") ?? "";
  const { format, count, number, errorText, ageBandLabel } = managerContentPresentation(t, locale);
  function roleLabel(role: MemberRole) {
    if (role === "player") return t("manager.content.player");
    if (role === "parent") return t("manager.content.parent");
    if (role === "coach") return t("manager.content.coach");
    return t("manager.content.manager");
  }
  function statusLabel(status: NewsStatus) {
    if (status === "published") return t("manager.content.published");
    if (status === "scheduled") return t("manager.content.scheduled");
    if (status === "archived") return t("manager.content.archivedNews");
    return t("manager.content.draft");
  }
  function formatDateTime(value: string | null | undefined) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(managerLocaleTag(locale), {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/Zurich",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  function eventTypeLabel(value: string | null) {
    return managerActivityLabel(t, value ?? "event");
  }
  function linkedEventOptionLabel(option: LinkedEventOption) {
    const date = option.starts_at ? formatDateTime(option.starts_at) : t("manager.content.unknownDate");
    const title = option.title && option.title !== "Événement" ? ` · ${option.title}` : "";
    return `${eventTypeLabel(option.event_type)}${title} · ${option.group_name ?? t("manager.content.specificGroup")} · ${date} · ${format("linkedCoach", { name: option.head_coach_name ?? t("manager.content.undefined") })}`;
  }
  function targetLabel(
    target: NewsTarget,
    members: MemberOption[],
    groups: GroupOption[],
    ageBands: AgeBandOption[]
  ) {
    if (target.target_type === "role") return format("roleTarget", { name: roleLabel(target.target_value as MemberRole) });
    if (target.target_type === "user") {
      const member = members.find((row) => row.user_id === target.target_value);
      return member ? `${member.full_name} (${roleLabel(member.role)})` : t("manager.content.user");
    }
    if (target.target_type === "group") {
      const group = groups.find((row) => row.id === target.target_value);
      return group ? format("groupTarget", { name: group.name }) : t("manager.content.group");
    }
    if (target.target_type === "group_category") return format("categoryTarget", { name: target.target_value });
    const band = ageBands.find((row) => row.key === target.target_value);
    return format("ageTarget", { name: ageBandLabel(band?.key ?? target.target_value, band?.label ?? target.target_value) });
  }

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const requestVersion = useRef(0);
  const previousRequestedClub = useRef(requestedClubId);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupCategories, setGroupCategories] = useState<string[]>([]);
  const [ageBands, setAgeBands] = useState<AgeBandOption[]>([]);
  const [linkedEvents, setLinkedEvents] = useState<LinkedEventOption[]>([]);
  const [linkedCamps, setLinkedCamps] = useState<LinkedCampOption[]>([]);
  const [groupPlayerUserIdsByGroupId, setGroupPlayerUserIdsByGroupId] = useState<Record<string, string[]>>({});
  const [groupCoachUserIdsByGroupId, setGroupCoachUserIdsByGroupId] = useState<Record<string, string[]>>({});
  const [groupIdsByCategory, setGroupIdsByCategory] = useState<Record<string, string[]>>({});
  const [news, setNews] = useState<NewsRow[]>([]);
  const [platformNews, setPlatformNews] = useState<PlatformNewsRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
  const [deletingNewsId, setDeletingNewsId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [form, setForm] = useState<NewsFormState>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  useManagerClubChangeGuard(formOpen, t("manager.content.discardNewsDraft"), saving || Boolean(deletingNewsId));

  const authHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async (clubId?: string) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadFailed(false);
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
      if (!res.ok) throw new Error(String(json?.error ?? t("manager.content.loadNewsError")));
      if (version !== requestVersion.current) return;
      if (clubId && json.selected_club_id !== clubId) throw new Error(t("manager.clubUnavailable"));

      setSelectedClubId(String(json.selected_club_id ?? ""));
      setLoadFailed(false);
      setClubs(Array.isArray(json.clubs) ? json.clubs : []);
      setMembers(Array.isArray(json.target_options?.members) ? json.target_options.members : []);
      setGroups(Array.isArray(json.target_options?.groups) ? json.target_options.groups : []);
      setGroupCategories(Array.isArray(json.target_options?.group_categories) ? json.target_options.group_categories : []);
      setAgeBands(Array.isArray(json.target_options?.age_bands) ? json.target_options.age_bands : []);
      setLinkedEvents(Array.isArray(json.target_options?.club_events) ? json.target_options.club_events : []);
      setLinkedCamps(Array.isArray(json.target_options?.camps) ? json.target_options.camps : []);
      setGroupPlayerUserIdsByGroupId(json.target_options?.group_player_user_ids_by_group_id ?? {});
      setGroupCoachUserIdsByGroupId(json.target_options?.group_coach_user_ids_by_group_id ?? {});
      setGroupIdsByCategory(json.target_options?.group_ids_by_category ?? {});
      setNews(Array.isArray(json.news) ? json.news : []);
      setPlatformNews(Array.isArray(json.platform_news) ? json.platform_news : []);
    } catch (loadError) {
      if (version !== requestVersion.current) return;
      setError(loadError instanceof Error ? loadError.message : t("manager.content.loadNewsError"));
      setLoadFailed(true);
      setMembers([]);
      setGroups([]);
      setGroupCategories([]);
      setAgeBands([]);
      setLinkedEvents([]);
      setLinkedCamps([]);
      setGroupPlayerUserIdsByGroupId({});
      setGroupCoachUserIdsByGroupId({});
      setGroupIdsByCategory({});
      setNews([]);
      setPlatformNews([]);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [authHeaders, t]);

  useEffect(() => {
    if (previousRequestedClub.current !== requestedClubId) {
      previousRequestedClub.current = requestedClubId;
      setFormOpen(false);
      setEditingNewsId(null);
      setImageFile(null);
      setImagePreview(null);
    }
    void load(requestedClubId || undefined);
    return () => { requestVersion.current += 1; };
  }, [load, requestedClubId]);

  const scopeReady = !requestedClubId || selectedClubId === requestedClubId;
  function selectClub(id: string) {
    if (id === selectedClubId || saving || deletingNewsId) return;
    if (formOpen && !window.confirm(t("manager.content.discardNewsDraft"))) return;
    setFormOpen(false);
    setEditingNewsId(null);
    setForm(emptyForm());
    setImageFile(null);
    setImagePreview(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("club", id);
    router.replace(`/manager/news?${params.toString()}`, { scroll: false });
  }

  const filteredMembers = (() => {
    const query = normalizeSearch(memberSearch);
    if (!query) return members;
    return members.filter((member) => normalizeSearch(`${member.full_name} ${roleLabel(member.role)}`).includes(query));
  })();

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
  const linkedContentValue = form.linked_camp_id
    ? `camp:${form.linked_camp_id}`
    : form.linked_club_event_id
      ? `event:${form.linked_club_event_id}`
      : "";
  const selectableEvents = useMemo(
    () => linkedEvents.filter((event) => event.event_type !== "camp"),
    [linkedEvents]
  );

  function linkActivity(value: string) {
    const [kind, id = ""] = value.split(":", 2);
    const eventId = kind === "event" ? id : "";
    const campId = kind === "camp" ? id : "";
    const activity = linkedEvents.find((item) => item.id === eventId);
    setForm((previous) => ({
      ...previous,
      linked_club_event_id: eventId,
      linked_camp_id: campId,
      targets: activity
        ? activity.target_user_ids.map((userId) => ({ target_type: "user" as const, target_value: userId }))
        : previous.targets,
    }));
  }

  function openCreateForm() {
    setEditingNewsId(null);
    setForm(emptyForm());
    setImageFile(null);
    setImagePreview(null);
    setFormOpen(true);
    setMessage(null);
    setError(null);
  }

  function openEditForm(row: NewsRow) {
    setEditingNewsId(row.id);
    setForm({
      title: row.title,
      image_url: row.image_url ?? "",
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
    setImageFile(null);
    setImagePreview(row.image_url ?? null);
    setFormOpen(true);
    setMessage(null);
    setError(null);
  }

  async function submitForm() {
    if (loadFailed || !scopeReady || !selectedClubId) {
      setError(t("manager.content.chooseOrganization"));
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const headers = await authHeaders();
      let imageUrl = form.image_url || null;
      if (imageFile) {
        const uploadData = new FormData();
        uploadData.set("club_id", selectedClubId);
        uploadData.set("image", imageFile);
        const uploadRes = await fetch("/api/manager/news/image", { method: "POST", headers, body: uploadData });
        const uploadJson = (await uploadRes.json().catch(() => ({}))) as { error?: string; image_url?: string };
        if (!uploadRes.ok || !uploadJson.image_url) throw new Error(String(uploadJson.error ?? t("manager.content.uploadError")));
        imageUrl = uploadJson.image_url;
      }
      const payload = {
        club_id: selectedClubId,
        ...form,
        image_url: imageUrl,
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
      const json = (await res.json().catch(() => ({}))) as { error?: string; dispatch?: Record<string, unknown> };
      if (!res.ok) throw new Error(String(json.error ?? t("manager.content.saveError")));

      setFormOpen(false);
      setEditingNewsId(null);
      setForm(emptyForm());
      setImageFile(null);
      setImagePreview(null);
      const failed = Number(json.dispatch?.email_failed_count ?? 0);
      const uncertain = Number(json.dispatch?.email_uncertain_count ?? 0);
      const deliveryNote = failed || uncertain
        ? ` ${format("deliveryIncomplete", { failed: number(failed), uncertain: number(uncertain) })} ${t("manager.content.deliveryRetryHelp")}`
        : json.dispatch?.notification_error ? ` ${t("manager.content.notificationFailed")}` : "";
      setMessage((editingNewsId ? t("manager.content.newsUpdated") : t("manager.content.newsCreated")) + deliveryNote);
      await load(selectedClubId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("manager.content.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteNews(row: NewsRow) {
    const confirmed = window.confirm(format("confirmDeleteNews", { name: row.title }));
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
      const json = (await res.json().catch(() => ({}))) as { error?: string; dispatch?: Record<string, unknown> };
      if (!res.ok) throw new Error(String(json.error ?? t("manager.content.deleteError")));
      setMessage(t("manager.content.newsDeleted"));
      await load(selectedClubId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("manager.content.deleteError"));
    } finally {
      setDeletingNewsId(null);
    }
  }

  return (
    <main className={styles.page}>
      <nav aria-label={t("manager.content.breadcrumb")} style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager">{t("manager.content.manager")}</Link><span aria-hidden="true" style={{ margin: "0 8px" }}>/</span><span>{t("manager.content.news")}</span>
      </nav>
      <div className={styles.topline}>
        <div><h1>{t("manager.content.news")}</h1><p className={styles.lead}>{t("manager.content.newsLead")}</p></div>
        <div className={actionStyles.topActions}>
          {clubs.length > 1 ? <ManagerClubSelect clubs={clubs} clubId={scopeReady ? selectedClubId : requestedClubId} onChange={selectClub} disabled={loading || saving || Boolean(deletingNewsId)} /> : null}
          <button type="button" className={actionStyles.primaryButton} onClick={openCreateForm} disabled={loading || loadFailed || !scopeReady || !selectedClubId}><PlusCircle size={16} />{t("manager.content.newNews")}</button>
        </div>
      </div>
      {message ? <div className={actionStyles.successAlert}>{message}</div> : null}
      {error ? <div className={actionStyles.errorAlert} role="alert">{errorText(error)}</div> : null}
      {loadFailed ? <button type="button" className={actionStyles.secondaryButton} onClick={() => void load(requestedClubId || undefined)}>{t("manager.refresh")}</button> : null}

      {formOpen && scopeReady && !loadFailed ? (
        <>
          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{editingNewsId ? t("manager.content.editNews") : t("manager.content.createNews")}</h2><p>{t("manager.content.newsFormHelp")}</p></div></div>

            <div className={newsStyles.formHeadingGrid}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.title")}</span>
                <input
                  className="input"
                  value={form.title}
                  onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
                  placeholder={t("manager.content.newsTitle")}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.status")}</span>
                <select
                  className="input"
                  value={form.status}
                  onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value as NewsStatus }))}
                >
                  <option value="draft">{t("manager.content.draft")}</option>
                  <option value="scheduled">{t("manager.content.scheduled")}</option>
                  <option value="published">{t("manager.content.publishNow")}</option>
                  <option value="archived">{t("manager.content.archive")}</option>
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.summaryOptional")}</span>
              <input
                className="input"
                value={form.summary}
                onChange={(event) => setForm((previous) => ({ ...previous, summary: event.target.value }))}
                placeholder={t("manager.content.notificationSummary")}
              />
            </label>

            <div className={newsStyles.imageField}>
              <div className={newsStyles.imageFieldHeader}>
                <div><span className={newsStyles.fieldLabel}>{t("manager.content.cover")}</span><p>{t("manager.content.coverFormat")}</p></div>
                {imagePreview ? <button type="button" className={newsStyles.removeImage} onClick={() => { setImageFile(null); setImagePreview(null); setForm((previous) => ({ ...previous, image_url: "" })); }}><X size={14} /> {t("manager.content.remove")}</button> : null}
              </div>
              {imagePreview ? <div className={newsStyles.imagePreview}><img src={imagePreview} alt={t("manager.content.coverPreview")} /></div> : <label className={newsStyles.imageDrop}><ImagePlus size={20} /><span>{t("manager.content.addImage")}</span><small>{t("manager.content.coverCrop")}</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const optimized = await optimizeUploadFile(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.84 }); setImageFile(optimized); setImagePreview(URL.createObjectURL(optimized)); }} /></label>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.contentOptional")}</span>
              <TiptapSimpleEditor
                value={form.body}
                onChange={(value) => setForm((previous) => ({ ...previous, body: value }))}
                placeholder={t("manager.content.newsContent")}
              />
            </div>

            {form.status === "scheduled" ? (
              <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.scheduleDate")}</span>
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
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.linkActivity")}</span>
                <select
                  className="input"
                  value={linkedContentValue}
                  onChange={(event) => linkActivity(event.target.value)}
                >
                  <option value="">{t("manager.content.none")}</option>
                  {linkedCamps.length ? (
                    <optgroup label={t("manager.content.camps")}>
                      {linkedCamps.map((camp) => (
                        <option key={camp.id} value={`camp:${camp.id}`}>{camp.title}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  {selectableEvents.length ? (
                    <optgroup label={t("manager.content.otherActivities")}>
                      {selectableEvents.map((row) => (
                        <option key={row.id} value={`event:${row.id}`}>
                          {linkedEventOptionLabel(row)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            </div>

          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{t("manager.content.delivery")}</h2><p>{t("manager.content.deliveryHelp")}</p></div></div>
            <div style={{ display: "grid", gap: 10 }}>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.send_notification}
                  onChange={(event) => setForm((previous) => ({ ...previous, send_notification: event.target.checked }))}
                />
                {t("manager.content.sendNotification")}
              </label>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.send_email}
                  onChange={(event) => setForm((previous) => ({ ...previous, send_email: event.target.checked }))}
                />
                {t("manager.content.sendEmail")}
              </label>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.include_linked_parents}
                  onChange={(event) => setForm((previous) => ({ ...previous, include_linked_parents: event.target.checked }))}
                />
                {t("manager.content.includeParents")}
              </label>
              <label className="user-mgmt-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.visible_on_home}
                  onChange={(event) => setForm((previous) => ({ ...previous, visible_on_home: event.target.checked }))}
                />
                {t("manager.content.showHome")}
              </label>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{t("manager.content.targeting")}</h2><p>{t("manager.content.targetingHelp")}</p></div></div>
            <fieldset className="manager-news-targeting" disabled={targetsLockedByActivity} style={{ display: "grid", gap: 14, minWidth: 0, margin: 0, padding: 0, border: 0 }}>
              {targetsLockedByActivity ? (
                <p style={{ margin: 0, color: "#778278", fontSize: 12, fontWeight: 700 }}>
                  {t("manager.content.activityTargets")}
                </p>
              ) : null}

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.wholeRoles")}</div>
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
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.groups")}</div>
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
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.groupCategories")}</div>
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
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.ageBand")}</div>
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
                        {ageBandLabel(band.key, band.label)}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{t("manager.content.individualUsers")}</div>
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
                      placeholder={t("manager.content.searchUser")}
                      style={{ border: 0, outline: 0, background: "transparent", minWidth: 220 }}
                    />
                  </label>
                </div>

                <div className={newsStyles.memberGrid}>
                  {[
                    { label: t("manager.content.players"), rows: memberGroups.players },
                    { label: t("manager.content.parents"), rows: memberGroups.parents },
                    { label: t("manager.content.coaches"), rows: memberGroups.coaches },
                    { label: t("manager.content.managers"), rows: memberGroups.managers },
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
                          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.45)" }}>{t("manager.content.noResults")}</div>
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
                  {t("manager.content.cancel")}
                </button>
                <button type="button" className={actionStyles.primaryButton} onClick={() => void submitForm()} disabled={saving}>
                  {saving ? t("manager.content.saving") : editingNewsId ? t("manager.content.update") : t("manager.content.createNews")}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {!loading && scopeReady && platformNews.length > 0 ? <section className={listStyles.panel} aria-labelledby="activitee-news-title">
        <div className={listStyles.panelHeader}><div><h2 id="activitee-news-title">{t("manager.content.platformNews")}</h2><p>{t("manager.content.platformNewsHelp")}</p></div></div>
        <div className={newsStyles.platformGrid}>{platformNews.map(row=><article className={newsStyles.platformCard} key={row.id}>{row.image_url?<img src={row.image_url} alt=""/>:null}<div><span>{formatDateTime(row.published_at||row.scheduled_for||row.created_at)}</span><h3>{row.title}</h3>{row.summary?<p>{row.summary}</p>:null}<div dangerouslySetInnerHTML={{__html:normalizeCampRichTextHtml(row.body)}}/></div></article>)}</div>
      </section>:null}

      <section className={listStyles.panel}>
        <div className={listStyles.panelHeader}>
          <div>
            <h2>{t("manager.content.newsList")}</h2>
            <p>
              {loading || !scopeReady
                ? t("manager.content.loading")
                : count("newsCount", news.length)}
            </p>
          </div>
        </div>

        {loading || !scopeReady ? (
          <ListLoadingBlock label={t("manager.content.loadingNews")} />
        ) : news.length === 0 ? (
          <div className={listStyles.empty}>{t("manager.content.noNews")}</div>
        ) : (
          <div className={listStyles.tableWrap}>
            <table className={`${listStyles.table} ${newsStyles.newsTable}`}>
              <thead>
                <tr>
                  <th>{t("manager.content.date")}</th>
                  <th>{t("manager.content.image")}</th>
                  <th>{t("manager.content.title")}</th>
                  <th>{t("manager.content.status")}</th>
                  <th>{t("manager.content.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {news.map((row) => {
                  const displayDate = row.status === "scheduled" ? row.scheduled_for : row.published_at || row.created_at;

                  return (
                    <tr key={row.id}>
                      <td data-label={t("manager.content.date")} className={newsStyles.dateCell}>
                        {formatDateTime(displayDate)}
                      </td>
                      <td data-label={t("manager.content.image")}>
                        {row.image_url ? (
                          <img className={newsStyles.tableThumbnail} src={row.image_url} alt="" />
                        ) : (
                          <span className={newsStyles.noThumbnail}>—</span>
                        )}
                      </td>
                      <td data-label={t("manager.content.title")}>
                        <div className={listStyles.titleCell}>
                          <b>{row.title}</b>
                          {Number(row.last_dispatch_result?.email_failed_count ?? 0) > 0 || Number(row.last_dispatch_result?.email_uncertain_count ?? 0) > 0 ? <small role="status">{format("deliveryIncomplete", { failed: number(Number(row.last_dispatch_result?.email_failed_count ?? 0)), uncertain: number(Number(row.last_dispatch_result?.email_uncertain_count ?? 0)) })}</small> : null}
                          {row.last_dispatch_result?.notification_error ? <small role="status">{t("manager.content.notificationFailed")}</small> : null}
                        </div>
                      </td>
                      <td data-label={t("manager.content.status")}>
                        <span className={`${listStyles.badge} ${statusBadgeClass(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td data-label={t("manager.content.actions")}>
                        <div className={listStyles.actions}>
                          <button
                            type="button"
                            className={listStyles.iconButton}
                            title={t("manager.content.edit")}
                            aria-label={format("editNamed", { name: row.title })}
                            onClick={() => openEditForm(row)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className={`${listStyles.iconButton} ${listStyles.dangerIcon}`}
                            title={t("manager.content.delete")}
                            aria-label={format("deleteNamed", { name: row.title })}
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
