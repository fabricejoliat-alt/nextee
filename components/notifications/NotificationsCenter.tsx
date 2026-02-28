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
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { ensurePushSubscription, supportsWebPush } from "@/lib/pushClient";

type Props = {
  homeHref: string;
  titleFr: string;
  titleEn: string;
};

export default function NotificationsCenter({ homeHref, titleFr, titleEn }: Props) {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [rows, setRows] = useState<Array<{ recipient: NotificationRecipientRow; notification: NotificationRow | null }>>([]);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [viewerRole, setViewerRole] = useState<string>("player");

  function toErrorMessage(e: unknown, fallback: string) {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  }

  async function load() {
    setLoading(true);
    setError(null);

    const uRes = await supabase.auth.getUser();
    if (uRes.error || !uRes.data.user) {
      setError(tr("Session invalide.", "Invalid session."));
      setRows([]);
      setLoading(false);
      return;
    }

    const uid = uRes.data.user.id;
    setUserId(uid);

    try {
      const data = await loadMyNotifications(uid);
      setRows(data);
      applyPwaBadge(data.filter((r) => !r.recipient.is_read).length);
    } catch (e: unknown) {
      setError(toErrorMessage(e, tr("Erreur de chargement.", "Loading error.")));
      setRows([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (typeof window === "undefined") return;
    setPushEnabled(Notification.permission === "granted");
  }, []);

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
      setError(toErrorMessage(e, tr("Erreur.", "Error.")));
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
      setError(toErrorMessage(e, tr("Erreur.", "Error.")));
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
      setError(toErrorMessage(e, tr("Erreur.", "Error.")));
    } finally {
      setBusy(false);
    }
  }

  async function onEnablePush() {
    if (pushBusy) return;
    setPushBusy(true);
    const res = await ensurePushSubscription({ prompt: true });
    setPushBusy(false);
    if (res.ok) {
      setPushEnabled(true);
      return;
    }
    if (res.reason === "denied") {
      setError(tr("Permission notification refusée dans le navigateur.", "Notification permission denied in browser."));
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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 4 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>{locale === "fr" ? titleFr : titleEn}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                {tr("Non lues", "Unread")}: {unreadCount}
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
                {supportsWebPush() ? (
                  pushEnabled ? (
                    <span className="pill-soft">{tr("Push activé", "Push enabled")}</span>
                  ) : (
                    <button className="btn" type="button" disabled={pushBusy} onClick={onEnablePush}>
                      {pushBusy ? tr("Activation…", "Enabling…") : tr("Activer push PWA", "Enable PWA push")}
                    </button>
                  )
                ) : null}
                <button className="btn" type="button" disabled={busy || unreadCount === 0} onClick={onReadAll}>
                  <CheckCheck size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {tr("Tout marquer lu", "Mark all read")}
                </button>
              </div>
            </div>

            {loading ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
            ) : rows.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucune notification.", "No notification.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {rows.map((r) => {
                  const n = r.notification;
                  const href = (n?.data?.url as string | undefined) || null;
                  const card = (
                    <div
                      className="marketplace-item"
                      style={!r.recipient.is_read ? { borderColor: "rgba(53,72,59,0.35)", background: "rgba(240,248,242,0.86)" } : undefined}
                    >
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 900, fontSize: 14 }} className="truncate">{n?.title ?? tr("Notification", "Notification")}</div>
                          {!r.recipient.is_read ? <span className="pill-soft">{tr("Nouveau", "New")}</span> : null}
                        </div>
                        {n?.body ? <div style={{ fontSize: 12, fontWeight: 750, color: "rgba(0,0,0,0.75)" }}>{n.body}</div> : null}
                        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{fmtDate(n?.created_at ?? r.recipient.created_at)}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
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
                              {tr("Marquer lu", "Mark read")}
                            </button>
                          ) : null}
                          <button
                            className="btn btn-danger soft"
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDelete(r.recipient.id);
                            }}
                          >
                            <Trash2 size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                            {tr("Effacer", "Delete")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );

                  return (
                    <div key={r.recipient.id}>
                      {card}
                      {href ? (
                        <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                          <Link
                            href={href}
                            className="btn"
                            onClick={() => {
                              applyChildContextFromNotification(n, href);
                              if (!r.recipient.is_read) void onRead(r.recipient.id);
                            }}
                          >
                            {tr("Ouvrir", "Open")}
                          </Link>
                        </div>
                      ) : null}
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
