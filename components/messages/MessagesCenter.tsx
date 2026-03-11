"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock, ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { MessageCircle, Plus, Send } from "lucide-react";

type Props = {
  homeHref: string;
  titleFr: string;
  titleEn: string;
  titleDe?: string;
  titleIt?: string;
  hideTeamCoachThreadInList?: boolean;
};

type Thread = {
  id: string;
  organization_id: string;
  thread_type: "organization" | "group" | "event" | "player";
  player_thread_scope?: "direct" | "team" | string | null;
  title: string;
  display_title?: string;
  group_id?: string | null;
  group_name?: string;
  player_id?: string | null;
  group_categories?: string[];
  participant_names?: string[];
  event_id?: string | null;
  is_locked: boolean;
  unread_count: number;
  updated_at: string;
  me?: { can_post?: boolean; last_read_at?: string | null; is_archived?: boolean } | null;
  last_message?: {
    body: string;
    created_at: string;
    sender_user_id: string;
  } | null;
};

type ThreadMessage = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
};

type CatalogGroup = { id: string; name: string | null; categories?: string[] };
type CatalogEvent = {
  id: string;
  title: string | null;
  starts_at: string | null;
  event_type: string | null;
  group_id?: string | null;
  group_name?: string | null;
};
type CatalogPlayer = { id: string; full_name: string; username: string | null };
const THREAD_TYPES: Array<{ value: Thread["thread_type"]; fr: string; en: string }> = [
  { value: "organization", fr: "Organisation", en: "Organization" },
  { value: "group", fr: "Groupe", en: "Group" },
  { value: "event", fr: "Événement", en: "Event" },
  { value: "player", fr: "Joueur", en: "Player" },
];

export default function MessagesCenter({
  homeHref,
  titleFr,
  titleEn,
  titleDe,
  titleIt,
  hideTeamCoachThreadInList = false,
}: Props) {
  const { locale } = useI18n();
  const searchParams = useSearchParams();
  const tr = (fr: string, en: string, de?: string, it?: string) => {
    if (locale === "fr") return fr;
    if (locale === "de") return de ?? en;
    if (locale === "it") return it ?? en;
    return en;
  };

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [activeThreadParticipantNames, setActiveThreadParticipantNames] = useState<string[]>([]);
  const [composerText, setComposerText] = useState("");
  const [meId, setMeId] = useState("");
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [viewerRole, setViewerRole] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogGroups, setCatalogGroups] = useState<CatalogGroup[]>([]);
  const [catalogEvents, setCatalogEvents] = useState<CatalogEvent[]>([]);
  const [catalogPlayers, setCatalogPlayers] = useState<CatalogPlayer[]>([]);
  const [newType, setNewType] = useState<Thread["thread_type"]>("player");
  const [newTitle, setNewTitle] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [newEventId, setNewEventId] = useState("");
  const [newPlayerId, setNewPlayerId] = useState("");
  const [parentOfByGuardianId, setParentOfByGuardianId] = useState<Record<string, string>>({});
  const [threadFilter, setThreadFilter] = useState<"all" | "event" | "group" | "player">("all");
  const [archivedFilter, setArchivedFilter] = useState<"active" | "archived">("active");
  const [threadCounts, setThreadCounts] = useState<{ active: number; archived: number }>({ active: 0, archived: 0 });
  const threadIdsRef = useRef<Set<string>>(new Set());

  function upsertIncomingMessage(msg: ThreadMessage, markAsMine = false) {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return next;
    });

    setThreads((prev) => {
      const next = prev.map((t) => {
        if (t.id !== msg.thread_id) return t;
        const isActive = activeThreadId === msg.thread_id;
        const unread = isActive || markAsMine || msg.sender_user_id === meId ? 0 : (t.unread_count ?? 0) + 1;
        return {
          ...t,
          last_message: {
            body: msg.body,
            created_at: msg.created_at,
            sender_user_id: msg.sender_user_id,
          },
          updated_at: msg.created_at,
          unread_count: unread,
        };
      });
      return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    });
  }

  useEffect(() => {
    threadIdsRef.current = new Set(threads.map((t) => String(t.id)));
  }, [threads]);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadThreads(
    orgId: string,
    preselectId?: string,
    preselectEventId?: string,
    roleOverride?: string
  ) {
    const headers = await authHeader();
    const qs = new URLSearchParams({ organization_id: orgId });
    if (preselectId) qs.set("include_thread_id", preselectId);
    if (archivedFilter === "archived") qs.set("archived", "true");
    const res = await fetch(`/api/messages/threads?${qs.toString()}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? tr("Erreur de chargement.", "Loading error."));
    const rawList = (json?.threads ?? []) as Thread[];
    const effectiveRole = String(roleOverride ?? viewerRole ?? "").trim().toLowerCase();
    const list = rawList.filter((t) => {
      if (hideTeamCoachThreadInList) {
        const scope = String(t.player_thread_scope ?? "direct");
        if (t.thread_type === "player" && scope === "team") return false;
      }

      // Player inbox should not show support-team direct threads by default.
      // Keep the explicitly opened thread visible when coming from Encadrement.
      if (effectiveRole === "player" && t.thread_type === "player") {
        if (preselectId && t.id === preselectId) return true;
        if (activeThreadId && t.id === activeThreadId) return true;
        return false;
      }
      return true;
    });
    setThreads(list);
    setThreadCounts({
      active: Number(json?.counts?.active ?? 0),
      archived: Number(json?.counts?.archived ?? 0),
    });

    const nextId =
      (preselectId && list.some((t) => t.id === preselectId) && preselectId) ||
      (preselectEventId &&
        list.find((t) => t.thread_type === "event" && String(t.event_id ?? "") === preselectEventId)?.id) ||
      (activeThreadId && list.some((t) => t.id === activeThreadId) && activeThreadId) ||
      list[0]?.id ||
      "";
    setActiveThreadId(nextId);
  }

  async function loadMessages(threadId: string, mode: "replace" | "older" = "replace") {
    if (!threadId) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }

    setMessagesLoading(true);
    try {
      const headers = await authHeader();
      const oldest = messages[messages.length - 1]?.created_at;
      const qs = new URLSearchParams({ limit: "50" });
      if (mode === "older" && oldest) qs.set("before", oldest);

      const res = await fetch(`/api/messages/threads/${threadId}/messages?${qs.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? tr("Erreur de chargement.", "Loading error."));

      const chunk = ((json?.messages ?? []) as ThreadMessage[]).slice().reverse();
      setHasOlderMessages(chunk.length >= 50);

      if (mode === "older") {
        setMessages((prev) => [...chunk, ...prev]);
      } else {
        setMessages(chunk);
      }

      const ids = Array.from(new Set(chunk.map((m) => m.sender_user_id).filter(Boolean)));
      const missing = ids.filter((id) => !profilesById[id]);
      if (missing.length > 0) {
        const profRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username")
          .in("id", missing);
        if (!profRes.error) {
          const next = { ...profilesById };
          for (const row of profRes.data ?? []) {
            next[String(row.id)] = row as ProfileLite;
          }
          setProfilesById(next);
        }
      }

      const thread = threads.find((t) => t.id === threadId);
      if ((thread?.unread_count ?? 0) > 0) {
        await fetch(`/api/messages/threads/${threadId}/read`, { method: "POST", headers });
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread_count: 0 } : t)));
      }
    } catch (e: any) {
      setError(e?.message ?? tr("Erreur de chargement.", "Loading error."));
    } finally {
      setMessagesLoading(false);
    }
  }

  async function loadCatalog(orgId: string) {
    setCatalogLoading(true);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/messages/catalog?organization_id=${encodeURIComponent(orgId)}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? tr("Erreur de chargement.", "Loading error."));
      setCatalogGroups((json?.groups ?? []) as CatalogGroup[]);
      setCatalogEvents(
        ((json?.events ?? []) as CatalogEvent[]).slice().sort((a, b) => {
          const aTs = a.starts_at ? new Date(a.starts_at).getTime() : Number.POSITIVE_INFINITY;
          const bTs = b.starts_at ? new Date(b.starts_at).getTime() : Number.POSITIVE_INFINITY;
          return aTs - bTs;
        })
      );
      setCatalogPlayers((json?.players ?? []) as CatalogPlayer[]);
    } catch (e: any) {
      setError(e?.message ?? tr("Erreur de chargement.", "Loading error."));
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [authRes, meRes] = await Promise.all([supabase.auth.getUser(), authHeader().then((h) => fetch("/api/auth/me", { method: "GET", headers: h, cache: "no-store" }))]);
        const uid = authRes.data.user?.id ?? "";
        setMeId(uid);

        const meJson = await meRes.json().catch(() => ({}));
        const orgId = String(meJson?.membership?.club_id ?? "").trim();
        const membershipRole = String(meJson?.membership?.role ?? "");
        setViewerRole(membershipRole);
        const targetEventId = String(searchParams.get("event_id") ?? "").trim();
        const targetThreadIdFromQuery = String(searchParams.get("thread_id") ?? "").trim();
        if (!orgId) {
          setOrganizationId("");
          setThreads([]);
          return;
        }
        setOrganizationId(orgId);
        let targetThreadId = targetThreadIdFromQuery;
        if (!targetThreadId && targetEventId) {
          const headers = await authHeader();
          const threadRes = await fetch(`/api/messages/event-thread?event_id=${encodeURIComponent(targetEventId)}`, {
            method: "GET",
            headers,
            cache: "no-store",
          });
          const threadJson = await threadRes.json().catch(() => ({}));
          if (threadRes.ok) targetThreadId = String(threadJson?.thread_id ?? "");
        }
        await loadThreads(orgId, targetThreadId || undefined, targetEventId || undefined, membershipRole);
      } catch (e: any) {
        setError(e?.message ?? tr("Erreur de chargement.", "Loading error."));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      setActiveThreadParticipantNames([]);
      return;
    }
    void loadMessages(activeThreadId, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  useEffect(() => {
    (async () => {
      if (!activeThreadId) {
        setActiveThreadParticipantNames([]);
        return;
      }

      const initial = (threads.find((t) => t.id === activeThreadId)?.participant_names ?? [])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean);
      if (initial.length > 0) setActiveThreadParticipantNames(initial);

      try {
        const headers = await authHeader();
        const res = await fetch(`/api/messages/threads/${encodeURIComponent(activeThreadId)}/participants`, {
          method: "GET",
          headers,
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const fullNames = ((json?.participant_full_names ?? []) as string[])
          .map((v) => String(v ?? "").trim())
          .filter(Boolean);
        setActiveThreadParticipantNames(fullNames);
      } catch {
        // keep existing names when participant lookup fails
      }
    })();
  }, [activeThreadId, threads]);

  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`messages-live:${organizationId}:${meId || "anon"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "thread_messages" },
        async (payload) => {
          const row = payload.new as any;
          const threadId = String(row?.thread_id ?? "");
          if (!threadId) return;
          const threadKnown = threadIdsRef.current.has(threadId);
          const incoming: ThreadMessage = {
            id: String(row?.id ?? ""),
            thread_id: threadId,
            sender_user_id: String(row?.sender_user_id ?? ""),
            body: String(row?.body ?? ""),
            created_at: String(row?.created_at ?? new Date().toISOString()),
          };
          if (!threadKnown) {
            await loadThreads(organizationId, threadId);
            // Retry once for eventual consistency between realtime event and list query.
            window.setTimeout(() => {
              void loadThreads(organizationId, threadId);
            }, 800);
          }
          upsertIncomingMessage(incoming);

          if (activeThreadId && threadId === activeThreadId && incoming.sender_user_id !== meId) {
            const headers = await authHeader();
            await fetch(`/api/messages/threads/${threadId}/read`, { method: "POST", headers });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, activeThreadId, meId, archivedFilter]);

  useEffect(() => {
    if (!organizationId || !activeThreadId) return;
    const timer = window.setInterval(async () => {
      try {
        const headers = await authHeader();
        const res = await fetch(`/api/messages/threads/${activeThreadId}/messages?limit=1`, {
          method: "GET",
          headers,
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const latest = (json?.messages?.[0] ?? null) as any;
        if (!latest?.id) return;
        const latestId = String(latest.id);
        const hasLocally = messages.some((m) => m.id === latestId);
        if (!hasLocally) {
          await loadMessages(activeThreadId, "replace");
          await loadThreads(organizationId, activeThreadId);
        }
      } catch {
        // Silent fallback polling.
      }
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, activeThreadId, messages, archivedFilter]);

  useEffect(() => {
    if (!organizationId) return;
    void loadThreads(organizationId, activeThreadId || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, archivedFilter]);

  useEffect(() => {
    if (!organizationId) return;
    const timer = window.setInterval(async () => {
      try {
        await loadThreads(organizationId, activeThreadId || undefined);
      } catch {
        // Silent fallback polling for thread list updates.
      }
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, activeThreadId, archivedFilter]);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId]);
  const activeThreadHeader = useMemo(() => {
    if (!activeThread) return { line1: "", line2: "" };
    const rawTitle = String(activeThread.display_title || activeThread.title || "").trim();
    if (activeThread.thread_type !== "event") {
      return { line1: rawTitle, line2: "" };
    }
    const parts = rawTitle.split("•").map((p) => p.trim()).filter(Boolean);
    const line1 = parts[0] || rawTitle;
    const groupName = String(activeThread.group_name ?? "").trim();
    const line2 = groupName || parts[1] || "";
    return { line1, line2 };
  }, [activeThread]);
  const filteredThreads = useMemo(
    () => (threadFilter === "all" ? threads : threads.filter((t) => t.thread_type === threadFilter)),
    [threads, threadFilter]
  );
  const canPost = Boolean(activeThread?.me?.can_post) && !activeThread?.is_locked;
  const canArchiveForMe = ["player", "coach", "manager"].includes(viewerRole);

  function personLabel(userId: string) {
    if (!userId) return tr("Utilisateur", "User");
    if (userId === meId) return tr("Moi", "Me");
    const p = profilesById[userId];
    if (!p) return userId.slice(0, 8);
    const fullName = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    return fullName || p.username || userId.slice(0, 8);
  }

  function personParentSuffix(userId: string) {
    const childName = parentOfByGuardianId[userId];
    if (!childName) return "";
    return `(${tr("parent de", "parent of")} ${childName})`;
  }

  function fmtDate(iso?: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function eventTypeLabel(v?: string | null) {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "camp") return tr("Stage/Camp", "Camp");
    if (v === "interclub") return tr("Interclub", "Interclub");
    if (v === "session") return tr("Séance", "Session");
    return tr("Événement", "Event");
  }

  useEffect(() => {
    (async () => {
      const senderIds = Array.from(new Set(messages.map((m) => String(m.sender_user_id ?? "")).filter(Boolean)));
      if (senderIds.length === 0) {
        setParentOfByGuardianId({});
        return;
      }

      const linksRes = await supabase
        .from("player_guardians")
        .select("guardian_user_id,player_id,can_view")
        .in("guardian_user_id", senderIds)
        .or("can_view.is.null,can_view.eq.true");
      if (linksRes.error) return;

      const links = (linksRes.data ?? []) as Array<{
        guardian_user_id: string | null;
        player_id: string | null;
        can_view: boolean | null;
      }>;
      if (links.length === 0) {
        setParentOfByGuardianId({});
        return;
      }

      const playerIds = Array.from(new Set(links.map((l) => String(l.player_id ?? "")).filter(Boolean)));
      const missingPlayerIds = playerIds.filter((id) => !profilesById[id]);
      if (missingPlayerIds.length > 0) {
        const profRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username")
          .in("id", missingPlayerIds);
        if (!profRes.error) {
          const next = { ...profilesById };
          for (const row of profRes.data ?? []) {
            next[String(row.id)] = row as ProfileLite;
          }
          setProfilesById(next);
        }
      }

      const byGuardian = new Map<string, string[]>();
      for (const l of links) {
        const gid = String(l.guardian_user_id ?? "").trim();
        const pid = String(l.player_id ?? "").trim();
        if (!gid || !pid) continue;
        const prev = byGuardian.get(gid) ?? [];
        if (!prev.includes(pid)) prev.push(pid);
        byGuardian.set(gid, prev);
      }

      const nextMap: Record<string, string> = {};
      for (const [gid, childIds] of byGuardian.entries()) {
        let chosenChildId = childIds[0] ?? "";
        if (
          activeThread?.thread_type === "player" &&
          String(activeThread.player_id ?? "").trim() &&
          childIds.includes(String(activeThread.player_id))
        ) {
          chosenChildId = String(activeThread.player_id);
        }
        if (!chosenChildId) continue;
        const p = profilesById[chosenChildId];
        const childName = p
          ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.username || chosenChildId.slice(0, 8)
          : chosenChildId.slice(0, 8);
        nextMap[gid] = childName;
      }
      setParentOfByGuardianId(nextMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeThreadId]);

  async function sendMessage() {
    if (!activeThreadId || !composerText.trim() || !canPost || busy) return;
    setBusy(true);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/messages/threads/${activeThreadId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message_type: "text", body: composerText.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? tr("Erreur d'envoi.", "Send error."));
      const created = json?.message as ThreadMessage | undefined;
      setComposerText("");
      if (created?.id) {
        upsertIncomingMessage(created, true);
      } else {
        await loadMessages(activeThreadId, "replace");
      }
    } catch (e: any) {
      setError(e?.message ?? tr("Erreur d'envoi.", "Send error."));
    } finally {
      setBusy(false);
    }
  }

  async function createThread() {
    if (!organizationId || busy) return;
    if (newType !== "player" && newType !== "event" && !newTitle.trim()) return;
    if (newType === "player" && !newPlayerId) return;
    if (newType === "event" && !newEventId) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        organization_id: organizationId,
        thread_type: newType,
      };
      if (newType !== "player" && newType !== "event") payload.title = newTitle.trim();
      if (newType === "group") payload.group_id = newGroupId || null;
      if (newType === "event") payload.event_id = newEventId || null;
      if (newType === "player") payload.player_id = newPlayerId || null;

      const headers = await authHeader();
      const res = await fetch("/api/messages/threads", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? tr("Création impossible.", "Cannot create thread."));

      const newThreadId = String(json?.thread?.id ?? "");
      setShowCreate(false);
      setNewTitle("");
      setNewGroupId("");
      setNewEventId("");
      setNewPlayerId("");
      await loadThreads(organizationId, newThreadId || undefined);
    } catch (e: any) {
      setError(e?.message ?? tr("Création impossible.", "Cannot create thread."));
    } finally {
      setBusy(false);
    }
  }

  async function setThreadArchived(threadId: string, archived: boolean) {
    if (!organizationId || !threadId || busy) return;
    setBusy(true);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/messages/threads/${threadId}/archive`, {
        method: "POST",
        headers,
        body: JSON.stringify({ archived }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? tr("Action impossible.", "Action failed."));
      await loadThreads(organizationId);
    } catch (e: any) {
      setError(e?.message ?? tr("Action impossible.", "Action failed."));
    } finally {
      setBusy(false);
    }
  }

  const canCreate = viewerRole === "manager" || viewerRole === "coach" || viewerRole === "captain";
  const creatableThreadTypes = useMemo(
    () => THREAD_TYPES.filter((t) => !(t.value === "organization" && viewerRole !== "manager")),
    [viewerRole]
  );
  const playerThreadFilterLabel = useMemo(
    () => ({
      fr: viewerRole === "player" ? "Coachs" : "Joueur",
      en: viewerRole === "player" ? "Coaches" : "Player",
    }),
    [viewerRole]
  );

  useEffect(() => {
    if (!creatableThreadTypes.some((t) => t.value === newType)) {
      setNewType(creatableThreadTypes[0]?.value ?? "player");
    }
  }, [creatableThreadTypes, newType]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page" style={{ display: "grid", gap: 0 }}>
        <div className="glass-section" style={{ marginTop: 0, paddingTop: 10, paddingBottom: 6 }}>
          <div className="marketplace-header" style={{ marginBottom: 0, paddingBottom: 0 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {locale === "fr" ? titleFr : locale === "de" ? titleDe ?? titleEn : locale === "it" ? titleIt ?? titleEn : titleEn}
              </div>
            </div>
            <div className="marketplace-actions" style={{ marginTop: 0, display: "flex", gap: 8 }}>
              {canCreate ? (
                <button
                  className="cta-green cta-green-inline"
                  type="button"
                  onClick={() => {
                    setShowCreate((v) => !v);
                    if (!showCreate && organizationId) void loadCatalog(organizationId);
                  }}
                >
                  <Plus size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {tr("Nouveau fil de discussion", "New discussion thread")}
                </button>
              ) : null}
            </div>
          </div>
          {error ? <div className="marketplace-error">{error}</div> : null}
        </div>

        {showCreate ? (
          <div className="glass-section" style={{ marginTop: 12 }}>
            <div className="glass-card" style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>{tr("Créer un fil de discussion", "Create discussion thread")}</div>
              {catalogLoading ? (
                <CompactLoadingBlock label={tr("Chargement…", "Loading...")} />
              ) : (
                <>
                  {newType === "player" || newType === "event" ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <select className="input" value={newType} onChange={(e) => setNewType(e.target.value as Thread["thread_type"])}>
                        {creatableThreadTypes.map((t) => (
                          <option key={t.value} value={t.value}>
                            {locale === "fr" ? t.fr : t.en}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr" }}>
                      <select className="input" value={newType} onChange={(e) => setNewType(e.target.value as Thread["thread_type"])}>
                        {creatableThreadTypes.map((t) => (
                          <option key={t.value} value={t.value}>
                            {locale === "fr" ? t.fr : t.en}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        placeholder={tr("Titre du fil de discussion", "Discussion thread title")}
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                      />
                    </div>
                  )}

                  {newType === "group" ? (
                    <select className="input" value={newGroupId} onChange={(e) => setNewGroupId(e.target.value)}>
                      <option value="">{tr("Choisir un groupe", "Select group")}</option>
                      {catalogGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {[String(g.name ?? "").trim() || g.id.slice(0, 8), ...((g.categories ?? []).filter(Boolean))]
                            .filter(Boolean)
                            .join(" • ")}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {newType === "event" ? (
                    <select
                      className="input"
                      value={newEventId}
                      onChange={(e) => {
                        const nextEventId = e.target.value;
                        setNewEventId(nextEventId);
                      }}
                    >
                      <option value="">{tr("Choisir un événement", "Select event")}</option>
                      {catalogEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {[
                            String(ev.title ?? "").trim() || `${eventTypeLabel(ev.event_type)} • ${fmtDate(ev.starts_at)}`,
                            String(ev.group_name ?? "").trim(),
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {newType === "player" ? (
                    <select className="input" value={newPlayerId} onChange={(e) => setNewPlayerId(e.target.value)}>
                      <option value="">{tr("Choisir un joueur", "Select player")}</option>
                      {catalogPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className="btn" type="button" onClick={() => setShowCreate(false)}>
                      {tr("Annuler", "Cancel")}
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={
                        busy ||
                        (newType === "player"
                          ? !newPlayerId
                          : newType === "event"
                            ? !newEventId
                            : !newTitle.trim())
                      }
                      onClick={createThread}
                    >
                      {tr("Créer", "Create")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="glass-section" style={{ marginTop: 12, minHeight: 560 }}>
          {loading ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="glass-card" style={{ display: "grid", gap: 10 }}>
                <ListLoadingBlock label={tr("Chargement des fils…", "Loading threads...")} />
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ height: 58, borderRadius: 12, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ height: 58, borderRadius: 12, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                </div>
              </div>
              <div className="glass-card" style={{ display: "grid", gap: 10, minHeight: 360 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ height: 12, width: "42%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ height: 12, width: "28%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                </div>
                <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12, background: "rgba(255,255,255,0.94)", padding: 10, display: "grid", gap: 10, minHeight: 280 }}>
                  <div style={{ justifySelf: "start", height: 44, width: "58%", borderRadius: 12, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ justifySelf: "end", height: 44, width: "52%", borderRadius: 12, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ justifySelf: "start", height: 44, width: "62%", borderRadius: 12, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
                <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.06)", alignItems: "center" }}>
                  {([
                    { key: "all", fr: "Tous", en: "All" },
                    { key: "event", fr: "Événement", en: "Event" },
                    { key: "group", fr: "Groupe", en: "Group" },
                    { key: "player", fr: playerThreadFilterLabel.fr, en: playerThreadFilterLabel.en },
                  ] as const).map((f) => {
                    const active = threadFilter === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setThreadFilter(f.key)}
                        className="pill-soft"
                        style={{
                          border: active ? "1px solid rgba(27,94,32,0.55)" : "1px solid rgba(0,0,0,0.08)",
                          background: active ? "rgba(27,94,32,0.12)" : "white",
                          cursor: "pointer",
                        }}
                      >
                        {locale === "fr" ? f.fr : f.en}
                      </button>
                    );
                  })}
                  {archivedFilter === "active" ? (
                    <button
                      type="button"
                      onClick={() => setArchivedFilter("archived")}
                      className="pill-soft"
                      style={{
                        marginLeft: "auto",
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "white",
                        cursor: "pointer",
                      }}
                    >
                      {tr("Discussions archivées", "Archived discussions")}
                      {` (${threadCounts.archived})`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setArchivedFilter("active")}
                      className="pill-soft"
                      style={{
                        marginLeft: "auto",
                        border: "1px solid rgba(55,65,81,0.55)",
                        background: "rgba(55,65,81,0.12)",
                        cursor: "pointer",
                      }}
                    >
                      {tr("Discussions actives", "Active discussions")}
                      {` (${threadCounts.active})`}
                    </button>
                  )}
                </div>
                {filteredThreads.length === 0 ? (
                  <div style={{ padding: 14, fontWeight: 800, opacity: 0.7 }}>{tr("Aucun fil de discussion.", "No discussion thread.")}</div>
                ) : (
                  <div style={{ display: "grid", maxHeight: "min(56svh, 460px)", overflowY: "auto" }}>
                    {filteredThreads.map((t) => {
                      const active = t.id === activeThreadId;
                      const groupHeader =
                        t.thread_type === "group"
                          ? [
                              `${tr("Groupe", "Group")}: ${String(t.group_name ?? "").trim() || tr("Non renseigné", "Not set")}`,
                              ...(t.group_categories ?? []),
                            ]
                              .filter(Boolean)
                              .join(" • ")
                          : "";
                      const groupSubject =
                        t.thread_type === "group" ? String(t.title ?? "").trim() : "";
                      return (
                        <div
                          key={t.id}
                          style={{
                            display: "grid",
                            gap: 5,
                            textAlign: "left",
                            width: "100%",
                            minWidth: 0,
                            borderBottom: "1px solid rgba(0,0,0,0.14)",
                            background: active ? "rgba(27,94,32,0.1)" : "white",
                            padding: "12px 12px",
                          }}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveThreadId(t.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setActiveThreadId(t.id);
                              }
                            }}
                            style={{
                              background: "transparent",
                              textAlign: "left",
                              display: "grid",
                              gap: 5,
                              width: "100%",
                              padding: 0,
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", minWidth: 0 }}>
                              <div style={{ fontWeight: 850, fontSize: 12, minWidth: 0 }} className="truncate">
                                {t.thread_type === "group" ? groupHeader || (t.display_title || t.title) : (t.display_title || t.title)}
                              </div>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                {t.unread_count > 0 ? (
                                  <span
                                    className="pill-soft"
                                    style={{
                                      background: "rgba(220,38,38,0.16)",
                                      borderColor: "rgba(220,38,38,0.35)",
                                      color: "rgba(153,27,27,1)",
                                      fontWeight: 900,
                                    }}
                                  >
                                    {t.unread_count}
                                  </span>
                                ) : null}
                                {canArchiveForMe ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      void setThreadArchived(t.id, !(t.me?.is_archived ?? false));
                                    }}
                                    disabled={busy}
                                    style={{
                                      fontSize: 10,
                                      padding: "2px 6px",
                                      lineHeight: 1.15,
                                      borderRadius: 8,
                                      border: "1px solid rgba(0,0,0,0.16)",
                                      background: "rgba(255,255,255,0.9)",
                                      color: "#4b5563",
                                      cursor: "pointer",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {t.me?.is_archived ? tr("Désarchiver", "Unarchive") : tr("Archiver", "Archive")}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.65 }}>
                              {t.thread_type === "group"
                                ? `${tr("Sujet", "Subject")}: ${groupSubject}`
                                : t.last_message?.body
                                  ? t.last_message.body.slice(0, 54)
                                  : tr("Aucun message", "No message")}
                            </div>
                            {t.thread_type === "group" && (t.participant_names?.length ?? 0) > 0 ? (
                              <div style={{ fontSize: 10, opacity: 0.58, minWidth: 0 }} className="truncate">
                                {tr("Participants", "Participants")}: {t.participant_names!.join(", ")}
                              </div>
                            ) : null}
                            <div style={{ fontSize: 10, opacity: 0.5 }}>{fmtDate(t.last_message?.created_at ?? t.updated_at)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </>
              </div>

              <div className="glass-card" style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 460 }}>
                {activeThread ? (
                  <>
                    <div style={{ paddingBottom: 8, borderBottom: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <MessageCircle size={16} />
                      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                        <div style={{ fontWeight: 900 }}>
                          {activeThread.thread_type === "group"
                            ? String(activeThread.group_name ?? "").trim() || tr("Non renseigné", "Not set")
                            : activeThreadHeader.line1}
                        </div>
                        {activeThreadHeader.line2 ? (
                          <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.78 }}>
                            {activeThreadHeader.line2}
                          </div>
                        ) : null}
                        {activeThreadParticipantNames.length > 0 ? (
                          <div style={{ fontSize: 11, opacity: 0.72, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            {tr("Participants", "Participants")}: {activeThreadParticipantNames.join(", ")}
                          </div>
                        ) : null}
                      </div>
                      {canArchiveForMe ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setThreadArchived(activeThread.id, !(activeThread.me?.is_archived ?? false))}
                          disabled={busy}
                          style={{ marginLeft: "auto", fontSize: 10, padding: "2px 6px", lineHeight: 1.1 }}
                        >
                          {activeThread.me?.is_archived ? tr("Désarchiver", "Unarchive") : tr("Archiver", "Archive")}
                        </button>
                      ) : null}
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.94)",
                        padding: 10,
                        display: "grid",
                        gap: 8,
                        minHeight: 380,
                        marginTop: 8,
                      }}
                    >
                      <div
                        style={{
                          overflow: "auto",
                          maxHeight: 400,
                          display: "grid",
                          gap: 8,
                          paddingRight: 8,
                          alignContent: "start",
                        }}
                      >
                        {hasOlderMessages ? (
                          <button className="btn" type="button" onClick={() => loadMessages(activeThread.id, "older")} disabled={messagesLoading}>
                            {tr("Afficher plus", "Load older")}
                          </button>
                        ) : null}

                        {messagesLoading && messages.length === 0 ? (
                          <CompactLoadingBlock label={tr("Chargement…", "Loading...")} />
                        ) : messages.length === 0 ? (
                          <div style={{ opacity: 0.65, fontWeight: 700 }}>{tr("Aucun message.", "No message.")}</div>
                        ) : (
                          messages.map((m) => {
                            const mine = m.sender_user_id === meId;
                            return (
                              <div
                                key={m.id}
                                style={{
                                  justifySelf: mine ? "end" : "start",
                                  maxWidth: "82%",
                                  borderRadius: 12,
                                  padding: "8px 10px",
                                  background: mine ? "#1b5e20" : "rgba(0,0,0,0.05)",
                                  color: mine ? "white" : "#111827",
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.85, marginBottom: 4 }}>
                                  {personLabel(m.sender_user_id)} {personParentSuffix(m.sender_user_id)} • {fmtDate(m.created_at)}
                                </div>
                                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body}</div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div style={{ paddingTop: 10, borderTop: "1px solid rgba(0,0,0,0.08)", display: "grid", gap: 8 }}>
                      {canPost ? (
                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                          <input
                            className="input"
                            value={composerText}
                            onChange={(e) => setComposerText(e.target.value)}
                            placeholder={tr("Écrire un message…", "Write a message...")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void sendMessage();
                              }
                            }}
                          />
                          <button className="btn btn-primary" type="button" onClick={sendMessage} disabled={busy || !composerText.trim()}>
                            <Send size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                            {tr("Envoyer", "Send")}
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontWeight: 700, opacity: 0.65 }}>
                          {activeThread.is_locked
                            ? tr("Ce fil est verrouillé.", "This thread is locked.")
                            : tr("Vous ne pouvez pas écrire dans ce fil.", "You cannot post in this thread.")}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ display: "grid", placeItems: "center", minHeight: 320, opacity: 0.65, fontWeight: 800 }}>
                    {tr("Sélectionnez un fil de discussion.", "Select a discussion thread.")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
