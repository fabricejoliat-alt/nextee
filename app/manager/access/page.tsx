"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { Mail, RefreshCw, UserRoundX } from "lucide-react";

type ClubRow = { id: string; name: string };
type JuniorAccessRow = {
  junior_user_id: string;
  junior_name: string;
  junior_username: string | null;
  junior_status: "not_ready" | "ready" | "sent" | "activated" | "error";
  junior_last_sent_at: string | null;
  junior_send_count: number;
};
type ParentAccessRow = {
  parent_user_id: string;
  parent_name: string;
  parent_username: string | null;
  parent_email: string | null;
  parent_status: "not_ready" | "ready" | "sent" | "activated" | "error";
  parent_last_sent_at: string | null;
  parent_send_count: number;
  linked_juniors: JuniorAccessRow[];
};
type UnlinkedJuniorRow = {
  user_id: string;
  name: string;
  username: string | null;
  activated_at: string | null;
};
type PageData = {
  club: { id: string; name: string };
  parents: ParentAccessRow[];
  juniors_without_parent: UnlinkedJuniorRow[];
};

function fmtDate(value: string | null | undefined) {
  if (!value) return "Jamais";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Jamais";
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function statusLabel(status: ParentAccessRow["parent_status"]) {
  if (status === "activated") return "Activé";
  if (status === "sent") return "Envoyé";
  if (status === "error") return "Erreur";
  if (status === "not_ready") return "Non prêt";
  return "Prêt";
}

function statusTone(status: ParentAccessRow["parent_status"]) {
  if (status === "activated") return { bg: "#dcfce7", color: "#166534", border: "#86efac" };
  if (status === "sent") return { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd" };
  if (status === "error") return { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" };
  if (status === "not_ready") return { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" };
  return { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" };
}

export default function ManagerAccessPage() {
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubId, setClubId] = useState("");
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadClubs() {
    const headers = await authHeader();
    const res = await fetch("/api/manager/my-clubs", { method: "GET", headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "Impossible de charger les clubs");
    return (Array.isArray(json?.clubs) ? json.clubs : [])
      .map((club: any) => ({ id: String(club?.id ?? ""), name: String(club?.name ?? "Club") }))
      .filter((club: ClubRow) => Boolean(club.id));
  }

  async function loadPage(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${selectedClubId}/access-invitations`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Impossible de charger les invitations");
      setData(json as PageData);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const list = await loadClubs();
        setClubs(list);
        const first = list[0]?.id ?? "";
        setClubId(first);
        if (first) await loadPage(first);
        else setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Impossible de charger les clubs");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clubId) return;
    void loadPage(clubId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function sendInvitation(kind: "parent_access" | "junior_access", parentUserId: string, juniorUserId?: string) {
    if (!clubId) return;
    const key = `${kind}:${parentUserId}:${juniorUserId ?? parentUserId}`;
    setBusyKey(key);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ kind, parent_user_id: parentUserId, junior_user_id: juniorUserId ?? null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Envoi impossible");
      await loadPage(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Envoi impossible");
    } finally {
      setBusyKey(null);
    }
  }

  const filteredParents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return data?.parents ?? [];
    return data.parents.filter((row) => {
      const haystacks = [
        row.parent_name,
        row.parent_username ?? "",
        row.parent_email ?? "",
        ...row.linked_juniors.map((j) => j.junior_name),
        ...row.linked_juniors.map((j) => j.junior_username ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return haystacks.includes(q);
    });
  }, [data, search]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              <span>Invitations & accès</span>
              <p className="section-subtitle">Envoi individuel des accès parent et junior avec suivi d’activation.</p>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 16 }}>
            <label className="field-shell">
              <span className="field-label">Club</span>
              <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
                {clubs.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-shell">
              <span className="field-label">Recherche</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Parent, e-mail, junior…" />
            </label>
          </div>

          {error ? (
            <div className="notice-card" style={{ marginBottom: 16, borderColor: "#fecaca", background: "#fff1f2", color: "#9f1239" }}>
              {error}
            </div>
          ) : null}

          {loading ? <ListLoadingBlock label="Chargement des invitations..." /> : null}

          {!loading && data ? (
            <div style={{ display: "grid", gap: 18 }}>
              <section className="glass-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Parents</h2>
                    <p style={{ margin: "4px 0 0", color: "#5f6c62", fontSize: 13 }}>
                      1 mail parent et 1 mail junior distinct, tous deux envoyés à l’adresse du parent.
                    </p>
                  </div>
                  <span className="pill-soft">{filteredParents.length} parent(s)</span>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {filteredParents.map((row) => {
                    const parentTone = statusTone(row.parent_status);
                    return (
                      <article key={row.parent_user_id} className="glass-card" style={{ padding: 16, background: "#fff", borderColor: "#e5e7eb" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 16 }}>{row.parent_name}</div>
                            <div style={{ color: "#5f6c62", fontSize: 13 }}>
                              {row.parent_email || "Aucune adresse e-mail exploitable"}
                              {row.parent_username ? ` • ${row.parent_username}` : ""}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                borderRadius: 999,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: 900,
                                background: parentTone.bg,
                                color: parentTone.color,
                                border: `1px solid ${parentTone.border}`,
                              }}
                            >
                              {statusLabel(row.parent_status)}
                            </span>
                            <button
                              type="button"
                              className="btn"
                              disabled={busyKey === `parent_access:${row.parent_user_id}:${row.parent_user_id}` || row.parent_status === "not_ready"}
                              onClick={() => void sendInvitation("parent_access", row.parent_user_id)}
                            >
                              {busyKey === `parent_access:${row.parent_user_id}:${row.parent_user_id}` ? <RefreshCw size={14} className="spin" /> : <Mail size={14} />}
                              {row.parent_send_count > 0 ? "Renvoyer accès parent" : "Envoyer accès parent"}
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, color: "#5f6c62", fontSize: 12 }}>
                          Dernier envoi parent: {fmtDate(row.parent_last_sent_at)} • Envois: {row.parent_send_count}
                        </div>

                        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                          {row.linked_juniors.length === 0 ? (
                            <div className="notice-card" style={{ borderStyle: "dashed" }}>Aucun junior mineur éligible lié à ce parent.</div>
                          ) : (
                            row.linked_juniors.map((junior) => {
                              const juniorTone = statusTone(junior.junior_status);
                              const key = `junior_access:${row.parent_user_id}:${junior.junior_user_id}`;
                              return (
                                <div
                                  key={junior.junior_user_id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    alignItems: "center",
                                    padding: 12,
                                    borderRadius: 14,
                                    border: "1px solid #e5e7eb",
                                    background: "#fcfcfb",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 800 }}>{junior.junior_name}</div>
                                    <div style={{ color: "#5f6c62", fontSize: 13 }}>{junior.junior_username || "Username non renseigné"}</div>
                                    <div style={{ color: "#5f6c62", fontSize: 12 }}>
                                      Dernier envoi: {fmtDate(junior.junior_last_sent_at)} • Envois: {junior.junior_send_count}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        borderRadius: 999,
                                        padding: "6px 10px",
                                        fontSize: 12,
                                        fontWeight: 900,
                                        background: juniorTone.bg,
                                        color: juniorTone.color,
                                        border: `1px solid ${juniorTone.border}`,
                                      }}
                                    >
                                      {statusLabel(junior.junior_status)}
                                    </span>
                                    <button
                                      type="button"
                                      className="btn"
                                      disabled={busyKey === key || junior.junior_status === "not_ready"}
                                      onClick={() => void sendInvitation("junior_access", row.parent_user_id, junior.junior_user_id)}
                                    >
                                      {busyKey === key ? <RefreshCw size={14} className="spin" /> : <Mail size={14} />}
                                      {junior.junior_send_count > 0 ? "Renvoyer accès junior" : "Envoyer accès junior"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="glass-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Juniors sans parent lié</h2>
                    <p style={{ margin: "4px 0 0", color: "#5f6c62", fontSize: 13 }}>
                      Ces juniors sont éligibles à l’application mais aucun parent n’est encore rattaché.
                    </p>
                  </div>
                  <span className="pill-soft">{data.juniors_without_parent.length} junior(s)</span>
                </div>

                {data.juniors_without_parent.length === 0 ? (
                  <div className="notice-card">Tous les juniors éligibles ont un parent lié.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {data.juniors_without_parent.map((junior) => (
                      <div
                        key={junior.user_id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: 12,
                          borderRadius: 14,
                          border: "1px solid #e5e7eb",
                          background: "#fff",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800 }}>{junior.name}</div>
                          <div style={{ color: "#5f6c62", fontSize: 13 }}>{junior.username || "Username non renseigné"}</div>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#b91c1c", fontWeight: 800 }}>
                          <UserRoundX size={16} />
                          Aucun parent lié
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
