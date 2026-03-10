"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { MessageCircle } from "lucide-react";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";

type SupervisionStaff = {
  organization_id: string;
  organization_name: string;
  staff_user_id: string;
  role: "manager" | "coach" | string;
  full_name: string;
  username: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  staff_function: string | null;
  avatar_url: string | null;
  thread_id: string | null;
};

type ThreadBadge = {
  message_count: number;
  unread_count: number;
};

export default function PlayerSupportCenter() {
  const { locale } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [rows, setRows] = useState<SupervisionStaff[]>([]);
  const [badgesByThreadId, setBadgesByThreadId] = useState<Record<string, ThreadBadge>>({});
  const [effectivePlayerId, setEffectivePlayerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tr = (fr: string, en: string) => (locale === "fr" ? fr : en);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadSupport() {
    setLoading(true);
    setError(null);
    try {
      const ctx = await resolveEffectivePlayerContext();
      setEffectivePlayerId(ctx.effectiveUserId);
      const headers = await authHeader();
      const q = new URLSearchParams();
      if (ctx.effectiveUserId) q.set("child_id", ctx.effectiveUserId);
      const res = await fetch(`/api/messages/supervision?${q.toString()}`, { method: "GET", headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? tr("Erreur de chargement.", "Loading error.")));
      const staffRows = (json?.staff ?? []) as SupervisionStaff[];
      setRows(staffRows);
      const threadIds = Array.from(
        new Set(staffRows.map((r) => String(r.thread_id ?? "").trim()).filter(Boolean))
      );
      if (threadIds.length === 0) {
        setBadgesByThreadId({});
        return;
      }
      const badgesRes = await fetch(`/api/messages/thread-badges?thread_ids=${encodeURIComponent(threadIds.join(","))}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const badgesJson = await badgesRes.json().catch(() => ({}));
      if (!badgesRes.ok) throw new Error(String(badgesJson?.error ?? tr("Erreur de chargement.", "Loading error.")));
      setBadgesByThreadId((badgesJson?.badges ?? {}) as Record<string, ThreadBadge>);
    } catch (e: any) {
      setError(e?.message ?? tr("Erreur de chargement.", "Loading error."));
      setRows([]);
      setBadgesByThreadId({});
    } finally {
      setLoading(false);
    }
  }

  async function openThread(row: SupervisionStaff) {
    setBusyId(row.staff_user_id);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/messages/player-direct-thread", {
        method: "POST",
        headers,
        body: JSON.stringify({
          organization_id: row.organization_id,
          staff_user_id: row.staff_user_id,
          child_id: effectivePlayerId || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? tr("Action impossible.", "Action failed.")));
      const threadId = String(json?.thread?.id ?? "").trim();
      router.push(threadId ? `/player/messages?thread_id=${encodeURIComponent(threadId)}` : "/player/messages");
    } catch (e: any) {
      setError(e?.message ?? tr("Action impossible.", "Action failed."));
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    void loadSupport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function lastNameSortKey(fullName: string) {
    const clean = String(fullName ?? "").trim().replace(/\s+/g, " ");
    if (!clean) return "";
    const parts = clean.split(" ");
    return (parts[parts.length - 1] ?? clean).toLocaleLowerCase("fr-CH");
  }

  function sortByLastName(a: SupervisionStaff, b: SupervisionStaff) {
    const aKey = lastNameSortKey(a.full_name);
    const bKey = lastNameSortKey(b.full_name);
    if (aKey !== bKey) return aKey.localeCompare(bKey, "fr-CH");
    return String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "fr-CH");
  }

  const coachRows = rows.filter((r) => r.role === "coach").slice().sort(sortByLastName);
  const committeeRows = rows.filter((r) => r.role !== "coach").slice().sort(sortByLastName);

  function visibleEmail(raw: string | null | undefined) {
    const email = String(raw ?? "").trim();
    if (!email || !email.includes("@")) return null;
    const normalized = email.toLowerCase();
    // Hide technical auth placeholders when no real email was provided.
    if (normalized.endsWith("@users.noreply.supabase.io")) return null;
    return email;
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page" style={{ display: "grid", gap: 12 }}>
        <div className="glass-section" style={{ marginTop: 0 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {tr("Encadrement", "Support team")}
          </div>
          {error ? <div className="marketplace-error" style={{ marginTop: 8 }}>{error}</div> : null}
        </div>

        <div className="glass-section" style={{ marginTop: 0 }}>
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            {loading ? (
              <CompactLoadingBlock label={tr("Chargement…", "Loading...")} />
            ) : rows.length === 0 ? (
              <div style={{ fontWeight: 800, opacity: 0.72 }}>
                {tr("Aucun membre d'encadrement trouvé.", "No support staff found.")}
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 900, color: "var(--green-dark)", textTransform: "uppercase", fontSize: 13 }}>
                  Coachs
                </div>
                {coachRows.map((row) => (
                  (() => {
                    const email = visibleEmail(row.email);
                    return (
                    <div
                      key={`${row.organization_id}-${row.staff_user_id}`}
                      style={{
                        display: "grid",
                        gap: 8,
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 14,
                        background: "rgba(255,255,255,0.92)",
                        padding: "12px 12px",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 10, alignItems: "start" }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: "999px",
                            overflow: "hidden",
                            background: "rgba(15,23,42,0.12)",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 12,
                            fontWeight: 900,
                            color: "rgba(15,23,42,0.78)",
                          }}
                        >
                          {row.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            (row.full_name || "?").slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 900, fontSize: 13 }}>
                            {row.full_name}
                            {row.staff_function ? ` • ${row.staff_function}` : ""}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                            {row.organization_name}
                          </div>
                          <div style={{ height: 4 }} />
                          <div style={{ display: "grid", gap: 2, fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,0.6)" }}>
                            {row.phone ? <div>{`Tél. ${row.phone}`}</div> : null}
                            {email ? <div>{email}</div> : null}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 2 }}>
                        {(() => {
                          const threadId = String(row.thread_id ?? "").trim();
                          const badge = threadId
                            ? badgesByThreadId[threadId] ?? { message_count: 0, unread_count: 0 }
                            : { message_count: 0, unread_count: 0 };
                          const hasMessages = (badge.message_count ?? 0) > 0;
                          const hasUnread = (badge.unread_count ?? 0) > 0;
                          return (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void openThread(row)}
                              disabled={busyId === row.staff_user_id}
                            >
                              <MessageCircle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {tr("Messagerie", "Messages")}
                              <span
                                style={{
                                  minWidth: 18,
                                  height: 18,
                                  marginLeft: 6,
                                  padding: "0 6px",
                                  borderRadius: 999,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 11,
                                  fontWeight: 900,
                                  color: "white",
                                  background: !hasMessages ? "rgba(107,114,128,0.95)" : hasUnread ? "rgba(220,38,38,0.95)" : "rgba(22,163,74,0.95)",
                                }}
                              >
                                {badge.message_count ?? 0}
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    );
                  })()
                ))}

                <div style={{ fontWeight: 900, color: "var(--green-dark)", textTransform: "uppercase", fontSize: 13, marginTop: 4 }}>
                  Comité
                </div>
                {committeeRows.map((row) => (
                  (() => {
                    const email = visibleEmail(row.email);
                    return (
                    <div
                      key={`${row.organization_id}-${row.staff_user_id}`}
                      style={{
                        display: "grid",
                        gap: 8,
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 14,
                        background: "rgba(255,255,255,0.92)",
                        padding: "12px 12px",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 10, alignItems: "start" }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: "999px",
                            overflow: "hidden",
                            background: "rgba(15,23,42,0.12)",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 12,
                            fontWeight: 900,
                            color: "rgba(15,23,42,0.78)",
                          }}
                        >
                          {row.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            (row.full_name || "?").slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 900, fontSize: 13 }}>
                            {row.full_name}
                            {row.staff_function ? ` • ${row.staff_function}` : ""}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                            {row.organization_name}
                          </div>
                          <div style={{ height: 4 }} />
                          <div style={{ display: "grid", gap: 2, fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,0.6)" }}>
                            {row.phone ? <div>{`Tél. ${row.phone}`}</div> : null}
                            {email ? <div>{email}</div> : null}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 2 }}>
                        {(() => {
                          const threadId = String(row.thread_id ?? "").trim();
                          const badge = threadId
                            ? badgesByThreadId[threadId] ?? { message_count: 0, unread_count: 0 }
                            : { message_count: 0, unread_count: 0 };
                          const hasMessages = (badge.message_count ?? 0) > 0;
                          const hasUnread = (badge.unread_count ?? 0) > 0;
                          return (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void openThread(row)}
                              disabled={busyId === row.staff_user_id}
                            >
                              <MessageCircle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {tr("Messagerie", "Messages")}
                              <span
                                style={{
                                  minWidth: 18,
                                  height: 18,
                                  marginLeft: 6,
                                  padding: "0 6px",
                                  borderRadius: 999,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 11,
                                  fontWeight: 900,
                                  color: "white",
                                  background: !hasMessages ? "rgba(107,114,128,0.95)" : hasUnread ? "rgba(220,38,38,0.95)" : "rgba(22,163,74,0.95)",
                                }}
                              >
                                {badge.message_count ?? 0}
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    );
                  })()
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
