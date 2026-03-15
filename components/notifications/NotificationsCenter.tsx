"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import {
  applyPwaBadge,
  deleteNotificationRecipient,
  loadMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecipientRow,
  type NotificationRow,
} from "@/lib/notifications";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { Bell, CheckCheck, Settings, Trash2 } from "lucide-react";

type Props = {
  homeHref: string;
  settingsHref: string;
  titleFr: string;
  titleEn: string;
  titleDe: string;
  titleIt: string;
};

export default function NotificationsCenter({ homeHref, settingsHref, titleFr, titleEn, titleDe, titleIt }: Props) {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string, de?: string, it?: string) => {
    if (locale === "fr") return fr;
    if (locale === "de") return de ?? en;
    if (locale === "it") return it ?? en;
    return en;
  };

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [rows, setRows] = useState<Array<{ recipient: NotificationRecipientRow; notification: NotificationRow | null }>>([]);
  const [viewerRole, setViewerRole] = useState<string>("player");
  const [threadTitlesById, setThreadTitlesById] = useState<Record<string, string>>({});
  const [threadMetaById, setThreadMetaById] = useState<Record<string, { thread_type: string; player_id: string; created_by: string; player_thread_scope: string; event_id: string; group_id: string }>>({});
  const [profileNamesById, setProfileNamesById] = useState<Record<string, string>>({});
  const [threadUnreadById, setThreadUnreadById] = useState<Record<string, number>>({});

  function toErrorMessage(e: unknown, fallback: string) {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  }

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const uRes = await supabase.auth.getUser();
      if (uRes.error || !uRes.data.user) {
        setError(tr("Session invalide.", "Invalid session.", "Ungültige Sitzung.", "Sessione non valida."));
        setRows([]);
        return;
      }

      const uid = uRes.data.user.id;
      setUserId(uid);

      const data = await loadMyNotifications(uid);
      setRows(data);
      applyPwaBadge(data.filter((r) => !r.recipient.is_read).length);
    } catch (e: unknown) {
      setError(toErrorMessage(e, tr("Erreur de chargement.", "Loading error.", "Ladefehler.", "Errore di caricamento.")));
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();

    // Handle race conditions when app is opened from system push:
    // recipient row can arrive a bit after initial paint.
    const t1 = window.setTimeout(() => void load({ silent: true }), 900);
    const t2 = window.setTimeout(() => void load({ silent: true }), 2200);
    const t3 = window.setTimeout(() => void load({ silent: true }), 4500);

    const onFocus = () => void load({ silent: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-center-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_recipients",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setViewerRole(String(json?.membership?.role ?? "player"));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const threadIds = Array.from(
        new Set(
          rows
            .map((r) => {
              const n = r.notification;
              if (!n || n.kind !== "thread_message") return "";
              return String((n.data ?? {}).thread_id ?? "").trim();
            })
            .filter(Boolean)
        )
      );
      const missing = threadIds.filter((id) => !threadTitlesById[id]);
      if (missing.length === 0) return;

      const res = await supabase.from("message_threads").select("id,title").in("id", missing);
      if (res.error) return;
      const next = { ...threadTitlesById };
      for (const row of res.data ?? []) {
        next[String((row as any).id)] = String((row as any).title ?? "").trim();
      }
      setThreadTitlesById(next);

      const metaRes = await supabase
        .from("message_threads")
        .select("id,thread_type,player_id,created_by,player_thread_scope,event_id,group_id")
        .in("id", missing);
      if (!metaRes.error) {
        const nextMeta = { ...threadMetaById };
        const profileIds = new Set<string>();
        for (const row of metaRes.data ?? []) {
          const id = String((row as any).id ?? "");
          const thread_type = String((row as any).thread_type ?? "");
          const player_id = String((row as any).player_id ?? "");
          const created_by = String((row as any).created_by ?? "");
          const player_thread_scope = String((row as any).player_thread_scope ?? "direct");
          const event_id = String((row as any).event_id ?? "");
          const group_id = String((row as any).group_id ?? "");
          nextMeta[id] = { thread_type, player_id, created_by, player_thread_scope, event_id, group_id };
          if (player_id) profileIds.add(player_id);
          if (created_by) profileIds.add(created_by);
        }
        setThreadMetaById(nextMeta);

        const missingProfiles = Array.from(profileIds).filter((id) => !profileNamesById[id]);
        if (missingProfiles.length > 0) {
          const profRes = await supabase
            .from("profiles")
            .select("id,first_name,last_name,username")
            .in("id", missingProfiles);
          if (!profRes.error) {
            const nextProfiles = { ...profileNamesById };
            for (const p of profRes.data ?? []) {
              const fullName = `${String((p as any).first_name ?? "").trim()} ${String((p as any).last_name ?? "").trim()}`.trim();
              const fallback = String((p as any).username ?? "").trim();
              nextProfiles[String((p as any).id)] = fullName || fallback || String((p as any).id).slice(0, 8);
            }
            setProfileNamesById(nextProfiles);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    (async () => {
      const threadIds = Array.from(
        new Set(
          rows
            .map((r) => {
              const n = r.notification;
              if (!n || n.kind !== "thread_message") return "";
              return String((n.data ?? {}).thread_id ?? "").trim();
            })
            .filter(Boolean)
        )
      );
      if (threadIds.length === 0) {
        setThreadUnreadById({});
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) return;

      const qs = new URLSearchParams();
      qs.set("thread_ids", threadIds.join(","));
      const res = await fetch(`/api/messages/thread-badges?${qs.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const next: Record<string, number> = {};
      const badges = (json?.badges ?? {}) as Record<string, { unread_count?: number }>;
      for (const [threadId, badge] of Object.entries(badges)) {
        next[threadId] = Number(badge?.unread_count ?? 0);
      }
      setThreadUnreadById(next);
    })();
  }, [rows]);

  const unreadCount = useMemo(() => rows.filter((r) => !r.recipient.is_read).length, [rows]);

  function fmtDate(iso?: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  async function onRead(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      await markNotificationRead(id);
      setRows((prev) => prev.map((r) => (r.recipient.id === id ? { ...r, recipient: { ...r.recipient, is_read: true } } : r)));
      const nextUnread = Math.max(0, unreadCount - 1);
      applyPwaBadge(nextUnread);
      window.dispatchEvent(new CustomEvent("notifications:changed", { detail: { unreadCount: nextUnread } }));
    } catch (e: unknown) {
      setError(toErrorMessage(e, tr("Erreur.", "Error.", "Fehler.", "Errore.")));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      const target = rows.find((r) => r.recipient.id === id);
      await deleteNotificationRecipient(id);
      setRows((prev) => prev.filter((r) => r.recipient.id !== id));
      const nextUnread = unreadCount - (target && !target.recipient.is_read ? 1 : 0);
      const normalized = Math.max(0, nextUnread);
      applyPwaBadge(normalized);
      window.dispatchEvent(new CustomEvent("notifications:changed", { detail: { unreadCount: normalized } }));
    } catch (e: unknown) {
      setError(toErrorMessage(e, tr("Erreur.", "Error.", "Fehler.", "Errore.")));
    } finally {
      setBusy(false);
    }
  }

  async function onReadAll() {
    if (busy || !userId) return;
    setBusy(true);
    try {
      await markAllNotificationsRead(userId);
      setRows((prev) => prev.map((r) => ({ ...r, recipient: { ...r.recipient, is_read: true } })));
      applyPwaBadge(0);
      window.dispatchEvent(new CustomEvent("notifications:changed", { detail: { unreadCount: 0 } }));
    } catch (e: unknown) {
      setError(toErrorMessage(e, tr("Erreur.", "Error.", "Fehler.", "Errore.")));
    } finally {
      setBusy(false);
    }
  }

  function applyChildContextFromNotification(notification: NotificationRow | null, href?: string | null) {
    if (typeof window === "undefined") return;
    if (viewerRole !== "parent") return;

    const data = (notification?.data ?? {}) as Record<string, unknown>;
    let childId = String(data.child_id ?? "").trim();
    if (!childId && href) {
      try {
        const u = new URL(href, window.location.origin);
        childId = String(u.searchParams.get("child_id") ?? "").trim();
      } catch {
        // ignore
      }
    }
    if (childId) {
      window.localStorage.setItem("parent:selected_child_id", childId);
    }
  }

  function resolveNotificationHref(notification: NotificationRow | null) {
    const data = (notification?.data ?? {}) as Record<string, unknown>;
    const explicit = String(data.url ?? "").trim();
    if (explicit) return explicit;

    if (String(notification?.kind ?? "") === "thread_message") {
      const threadId = String(data.thread_id ?? "").trim();
      const eventId = String(data.event_id ?? "").trim();
      const groupId = String(data.group_id ?? "").trim();
      if (threadId) {
        const meta = threadMetaById[threadId];
        const targetEventId = eventId || String(meta?.event_id ?? "").trim();
        const targetGroupId = groupId || String(meta?.group_id ?? "").trim();
        if (targetEventId && (String(data.thread_type ?? "").trim() === "event" || meta?.thread_type === "event")) {
          if (homeHref.startsWith("/coach") && targetGroupId) {
            return `/coach/groups/${encodeURIComponent(targetGroupId)}/planning/${encodeURIComponent(targetEventId)}`;
          }
          if (homeHref.startsWith("/manager")) {
            return `/manager/calendar?event=${encodeURIComponent(targetEventId)}`;
          }
          let href = `/player/golf/trainings/new?club_event_id=${encodeURIComponent(targetEventId)}`;
          const childId = String(data.child_id ?? "").trim();
          if (childId) href += `&child_id=${encodeURIComponent(childId)}`;
          return href;
        }
        if (
          homeHref.startsWith("/coach") &&
          meta?.thread_type === "player" &&
          meta?.player_thread_scope === "team" &&
          String(meta.player_id ?? "").trim()
        ) {
          return `/coach/players/${encodeURIComponent(String(meta.player_id))}`;
        }
        return `${homeHref}/messages?thread_id=${encodeURIComponent(threadId)}`;
      }
    }
    return null;
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 4 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {locale === "fr" ? titleFr : locale === "de" ? titleDe : locale === "it" ? titleIt : titleEn}
              </div>
            </div>
            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={homeHref}>{t("common.back")}</Link>
            </div>
          </div>
          {error ? <div className="marketplace-error">{error}</div> : null}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 950 }}>
                <Bell size={16} />
                {tr("Centre de notifications", "Notification center")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Link className="btn" href={settingsHref}>
                  <Settings size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {tr("Paramètres", "Settings", "Einstellungen", "Impostazioni")}
                </Link>
                <button className="btn" type="button" disabled={busy || unreadCount === 0} onClick={onReadAll}>
                  <CheckCheck size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {tr("Tout marquer lu", "Mark all read", "Alle als gelesen markieren", "Segna tutto come letto")}
                </button>
              </div>
            </div>

            {loading ? (
              <ListLoadingBlock label={t("common.loading")} />
            ) : rows.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucune notification.", "No notification.", "Keine Benachrichtigung.", "Nessuna notifica.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top" style={{ minWidth: 0, overflowX: "hidden" }}>
                {rows.map((r) => {
                  const n = r.notification;
                  const href = resolveNotificationHref(n);
                  const threadId = n && n.kind === "thread_message" ? String((n.data ?? {}).thread_id ?? "").trim() : "";
                  const threadTitleFromData = n && n.kind === "thread_message" ? String((n.data ?? {}).thread_title ?? "").trim() : "";
                  const threadMeta = threadId ? threadMetaById[threadId] : null;
                  const threadUnreadCount = threadId ? Number(threadUnreadById[threadId] ?? 0) : 0;
                  const isEventThread = n?.kind === "thread_message" && threadMeta?.thread_type === "event";
                  const counterpartName =
                    threadMeta?.thread_type === "player"
                      ? ((viewerRole === "player" || viewerRole === "parent")
                          ? profileNamesById[threadMeta.created_by]
                          : profileNamesById[threadMeta.player_id]) ?? ""
                      : "";
                  const threadTitle =
                    counterpartName
                      ? `${tr("Discussion avec", "Discussion with", "Diskussion mit", "Discussione con")} ${counterpartName}`
                      : threadTitleFromData || (threadId ? threadTitlesById[threadId] ?? "" : "");
                  const notificationTitle =
                    isEventThread
                      ? (threadUnreadCount > 1
                          ? tr("Nouveaux messages", "New messages", "Neue Nachrichten", "Nuovi messaggi")
                          : tr("Nouveau message", "New message", "Neue Nachricht", "Nuovo messaggio"))
                      : (n?.title ?? tr("Notification", "Notification"));
                  const notificationBody =
                    isEventThread && threadUnreadCount > 1 ? "" : (n?.body ?? "");
                  const card = (
                    <div
                      className="marketplace-item"
                      style={{
                        width: "100%",
                        minWidth: 0,
                        boxSizing: "border-box",
                        overflow: "hidden",
                        ...(!r.recipient.is_read
                          ? { borderColor: "rgba(53,72,59,0.35)", background: "rgba(240,248,242,0.86)" }
                          : {}),
                      }}
                    >
                      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div
                            style={{
                              fontWeight: 900,
                              fontSize: 14,
                              minWidth: 0,
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                            }}
                          >
                            {notificationTitle}
                          </div>
                          {!r.recipient.is_read ? <span className="pill-soft">{tr("Nouveau", "New", "Neu", "Nuovo")}</span> : null}
                        </div>
                        {n?.kind === "thread_message" && threadTitle ? (
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 850,
                              color: "rgba(0,0,0,0.7)",
                              minWidth: 0,
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                            }}
                          >
                            {threadTitle}
                          </div>
                        ) : null}
                        {notificationBody ? (
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              fontStyle: "italic",
                              lineHeight: 1.35,
                              color: "rgba(0,0,0,0.68)",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                            }}
                          >
                            {notificationBody}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{fmtDate(n?.created_at ?? r.recipient.created_at)}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                          {href ? (
                            <Link
                              href={href}
                              className="btn"
                              onClick={() => {
                                applyChildContextFromNotification(n, href);
                                if (!r.recipient.is_read) void onRead(r.recipient.id);
                              }}
                            >
                              {tr("Ouvrir", "Open", "Öffnen", "Apri")}
                            </Link>
                          ) : null}
                          {!r.recipient.is_read ? (
                            <button
                              className="btn"
                              type="button"
                              disabled={busy}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void onRead(r.recipient.id);
                              }}
                            >
                              {tr("Marquer lu", "Mark read", "Als gelesen markieren", "Segna come letto")}
                            </button>
                          ) : null}
                          <button
                            className="btn btn-danger soft"
                            type="button"
                            title={tr("Effacer", "Delete", "Löschen", "Elimina")}
                            aria-label={tr("Effacer", "Delete", "Löschen", "Elimina")}
                            disabled={busy}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDelete(r.recipient.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                  return (
                    <div key={r.recipient.id} style={{ minWidth: 0, width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
                      {card}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
