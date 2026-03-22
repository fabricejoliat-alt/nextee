"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { Mail, RefreshCw, UserRoundX } from "lucide-react";

type ClubRow = { id: string; name: string };
type JuniorAccessRow = {
  junior_user_id: string;
  junior_name: string;
  junior_username: string | null;
  player_consent_status: "granted" | "pending" | "adult" | null;
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
  player_consent_status: "granted" | "pending" | "adult" | null;
  activated_at: string | null;
};
type PageData = {
  club: { id: string; name: string };
  parents: ParentAccessRow[];
  juniors_without_parent: UnlinkedJuniorRow[];
  mail_config: {
    parent_subject: string;
    parent_body: string;
    junior_subject: string;
    junior_body: string;
  };
};

type MailPreviewState =
  | null
  | {
      title: string;
      subject: string;
      body: string;
      kind: "parent_access" | "junior_access";
      parentUserId: string;
      juniorUserId?: string;
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

function consentLabel(status: "granted" | "pending" | "adult" | null | undefined) {
  if (status === "granted") return "Accordé";
  if (status === "adult") return "Majeur";
  return "En attente";
}

const LINK_TOKEN_RE = /\[\[ACTIVITEE_LINK:([^:\]]+):([^\]]+)\]\]/g;

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function createLinkToken(label: string, url: string) {
  return `[[ACTIVITEE_LINK:${encodeURIComponent(label)}:${encodeURIComponent(url)}]]`;
}

function renderMailTemplate(
  template: string,
  variables: Record<string, string>,
  linkMode: "text" | "token" = "text"
) {
  return template.replace(/\{\{([a-z0-9_]+)(?::([^}]+))?\}\}/gi, (_, key: string, label?: string) => {
    const value = variables[key] ?? "";
    if (!value) return "";
    if (!label) return value;
    if (!isHttpUrl(value)) return `${label}: ${value}`;
    return linkMode === "token" ? createLinkToken(label, value) : `${label}: ${value}`;
  });
}

function renderTemplateText(text: string) {
  return text.replace(LINK_TOKEN_RE, (_, encodedLabel: string, encodedUrl: string) => {
    return `${decodeURIComponent(encodedLabel)}: ${decodeURIComponent(encodedUrl)}`;
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function linkLabelForUrl(url: string) {
  if (url.includes("/reset-password?")) return "Cliquez ici pour définir votre mot de passe";
  if (url.includes("ActiviTee_V1_player.pdf")) return "Cliquez ici pour ouvrir le guide d'utilisation";
  return "Cliquez ici";
}

function linkifyHtml(value: string) {
  return value.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const href = url.replace(/&amp;/g, "&");
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#166534;text-decoration:underline">${linkLabelForUrl(
      href
    )}</a>`;
  });
}

function renderInlineHtml(value: string) {
  let html = "";
  let lastIndex = 0;
  for (const match of value.matchAll(LINK_TOKEN_RE)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const label = decodeURIComponent(match[1] ?? "");
    const url = decodeURIComponent(match[2] ?? "");
    html += linkifyHtml(escapeHtml(value.slice(lastIndex, index)));
    html += `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#166534;text-decoration:underline">${escapeHtml(label)}</a>`;
    lastIndex = index + raw.length;
  }
  html += linkifyHtml(escapeHtml(value.slice(lastIndex)));
  return html.replace(/\n/g, "<br/>");
}

function textToHtml(text: string) {
  return `<div style="font-family:Arial,sans-serif;color:#132018;line-height:1.5">${text
    .split("\n\n")
    .map((block) => `<p>${renderInlineHtml(block)}</p>`)
    .join("")}</div>`;
}

function defaultMailConfig(): PageData["mail_config"] {
  return {
    parent_subject: "ActiviTee • Accès parent {{club_name}}",
    parent_body: [
      "Bonjour {{parent_name}},",
      "",
      "Votre accès parent ActiviTee pour {{club_name}} est prêt.",
      "",
      "Identifiant: {{parent_username_or_existing}}",
      "Définir / réinitialiser votre mot de passe: {{reset_url}}",
      "Ce lien est valable 7 jours et peut être utilisé une seule fois.",
      "Connexion à l'application: {{app_url}}",
      "Mode d'emploi: {{player_guide_url}}",
      "",
      "Depuis votre espace parent, vous pourrez suivre les informations utiles et gérer le consentement de votre enfant si nécessaire.",
      "",
      "L'équipe ActiviTee",
    ].join("\n"),
    junior_subject: "ActiviTee • Accès junior {{junior_name}}",
    junior_body: [
      "Bonjour {{parent_name}},",
      "",
      "Voici les accès ActiviTee de {{junior_name}} pour {{club_name}}.",
      "",
      "Identifiant junior: {{junior_username}}",
      "Mot de passe temporaire: {{temp_password}}",
      "Connexion à l'application: {{app_url}}",
      "Mode d'emploi: {{player_guide_url}}",
      "",
      "Merci de transmettre ces accès à votre enfant ou de l'accompagner lors de sa première connexion.",
      "",
      "L'équipe ActiviTee",
    ].join("\n"),
  };
}

export default function ManagerAccessPage() {
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubId, setClubId] = useState("");
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [consentFilter, setConsentFilter] = useState<"hide_granted" | "all">("hide_granted");
  const [mailConfig, setMailConfig] = useState<PageData["mail_config"] | null>(null);
  const [savingMailConfig, setSavingMailConfig] = useState(false);
  const [mailPreview, setMailPreview] = useState<MailPreviewState>(null);
  const [portalReady, setPortalReady] = useState(false);

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
      setMailConfig((json as PageData).mail_config ?? null);
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

  useEffect(() => {
    setPortalReady(true);
  }, []);

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
      const sentAt = new Date().toISOString();
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          parents: prev.parents.map((parent) => {
            if (parent.parent_user_id !== parentUserId) return parent;
            if (kind === "parent_access") {
              return {
                ...parent,
                parent_status: "sent",
                parent_last_sent_at: sentAt,
                parent_send_count: Number(parent.parent_send_count ?? 0) + 1,
              };
            }
            return {
              ...parent,
              linked_juniors: parent.linked_juniors.map((junior) =>
                junior.junior_user_id !== juniorUserId
                  ? junior
                  : {
                      ...junior,
                      junior_status: "sent",
                      junior_last_sent_at: sentAt,
                      junior_send_count: Number(junior.junior_send_count ?? 0) + 1,
                    }
              ),
            };
          }),
        };
      });
    } catch (e: any) {
      setError(e?.message ?? "Envoi impossible");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveMailConfig() {
    if (!clubId || !mailConfig) return;
    setSavingMailConfig(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(mailConfig),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Impossible d'enregistrer les templates");
      setMailConfig((json?.mail_config ?? null) as PageData["mail_config"] | null);
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'enregistrer les templates");
    } finally {
      setSavingMailConfig(false);
    }
  }

  function openParentPreview(row: ParentAccessRow) {
    if (!data) return;
    const previewConfig = mailConfig ?? data.mail_config ?? defaultMailConfig();
    const variables = {
      club_name: data.club.name,
      parent_name: row.parent_name,
      parent_username: row.parent_username ?? "",
      parent_username_or_existing: row.parent_username || "votre compte parent déjà existant",
      reset_url: "https://www.activitee.golf/reset-password?invite_token=[généré-à-l-envoi]",
      app_url: "https://www.activitee.golf/",
      player_guide_url:
        "https://qgyshibomgcuaxhyhrgo.supabase.co/storage/v1/object/public/Docs/ActiviTee_V1_player.pdf",
      junior_name: "",
      junior_username: "",
      temp_password: "",
    };
    setMailPreview({
      title: `Aperçu mail parent • ${row.parent_name}`,
      subject: renderMailTemplate(previewConfig.parent_subject, variables, "text"),
      body: renderMailTemplate(previewConfig.parent_body, variables, "token"),
      kind: "parent_access",
      parentUserId: row.parent_user_id,
    });
  }

  function openJuniorPreview(row: ParentAccessRow, junior: JuniorAccessRow) {
    if (!data) return;
    const previewConfig = mailConfig ?? data.mail_config ?? defaultMailConfig();
    const variables = {
      club_name: data.club.name,
      parent_name: row.parent_name,
      parent_username: row.parent_username ?? "",
      parent_username_or_existing: row.parent_username || "votre compte parent déjà existant",
      reset_url: "",
      app_url: "https://www.activitee.golf/",
      player_guide_url:
        "https://qgyshibomgcuaxhyhrgo.supabase.co/storage/v1/object/public/Docs/ActiviTee_V1_player.pdf",
      junior_name: junior.junior_name,
      junior_username: junior.junior_username ?? "non renseigné",
      temp_password: "[généré-à-l-envoi]",
    };
    setMailPreview({
      title: `Aperçu mail junior • ${junior.junior_name}`,
      subject: renderMailTemplate(previewConfig.junior_subject, variables, "text"),
      body: renderMailTemplate(previewConfig.junior_body, variables, "token"),
      kind: "junior_access",
      parentUserId: row.parent_user_id,
      juniorUserId: junior.junior_user_id,
    });
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

  const visibleParents = useMemo(() => {
    const base = filteredParents.map((parent) => ({
      ...parent,
      linked_juniors:
        consentFilter === "hide_granted"
          ? parent.linked_juniors.filter((junior) => junior.player_consent_status !== "granted")
          : parent.linked_juniors,
    }));
    return base.filter((parent) => parent.linked_juniors.length > 0 || consentFilter === "all");
  }, [filteredParents, consentFilter]);

  const visibleUnlinkedJuniors = useMemo(() => {
    const list = data?.juniors_without_parent ?? [];
    if (consentFilter === "hide_granted") {
      return list.filter((junior) => junior.player_consent_status !== "granted");
    }
    return list;
  }, [data, consentFilter]);

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
            <label className="field-shell">
              <span className="field-label">Consentement</span>
              <select value={consentFilter} onChange={(e) => setConsentFilter(e.target.value as "hide_granted" | "all")}>
                <option value="hide_granted">Masquer consentements accordés</option>
                <option value="all">Tout afficher</option>
              </select>
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
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Templates e-mail</h2>
                    <p style={{ margin: "4px 0 0", color: "#5f6c62", fontSize: 13 }}>
                      Variables disponibles: {"{{club_name}}"}, {"{{parent_name}}"}, {"{{parent_username}}"}, {"{{parent_username_or_existing}}"}, {"{{reset_url}}"}, {"{{app_url}}"}, {"{{player_guide_url}}"}, {"{{junior_name}}"}, {"{{junior_username}}"}, {"{{temp_password}}"}. Libellé de lien possible, par exemple {"{{reset_url:Cliquez ici}}"}.
                    </p>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <label className="field-shell">
                      <span className="field-label">Sujet parent</span>
                      <input
                        value={mailConfig?.parent_subject ?? ""}
                        onChange={(e) => setMailConfig((prev) => (prev ? { ...prev, parent_subject: e.target.value } : prev))}
                      />
                    </label>
                    <label className="field-shell">
                      <span className="field-label">Corps parent</span>
                      <textarea
                        value={mailConfig?.parent_body ?? ""}
                        onChange={(e) => setMailConfig((prev) => (prev ? { ...prev, parent_body: e.target.value } : prev))}
                        rows={10}
                      />
                    </label>
                    <label className="field-shell">
                      <span className="field-label">Sujet junior</span>
                      <input
                        value={mailConfig?.junior_subject ?? ""}
                        onChange={(e) => setMailConfig((prev) => (prev ? { ...prev, junior_subject: e.target.value } : prev))}
                      />
                    </label>
                    <label className="field-shell">
                      <span className="field-label">Corps junior</span>
                      <textarea
                        value={mailConfig?.junior_body ?? ""}
                        onChange={(e) => setMailConfig((prev) => (prev ? { ...prev, junior_body: e.target.value } : prev))}
                        rows={10}
                      />
                    </label>
                    <div>
                      <button className="btn" type="button" onClick={() => void saveMailConfig()} disabled={savingMailConfig || !mailConfig}>
                        {savingMailConfig ? "Enregistrement..." : "Enregistrer les templates"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="glass-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Parents</h2>
                    <p style={{ margin: "4px 0 0", color: "#5f6c62", fontSize: 13 }}>
                      1 mail parent et 1 mail junior distinct, tous deux envoyés à l’adresse du parent.
                    </p>
                  </div>
                  <span className="pill-soft">{visibleParents.length} parent(s)</span>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {visibleParents.map((row) => {
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
                              {row.parent_status === "sent"
                                ? "Envoyé"
                                : row.parent_send_count > 0
                                ? "Renvoyer accès parent"
                                : "Envoyer accès parent"}
                            </button>
                            <button type="button" className="btn" onClick={() => openParentPreview(row)}>
                              Aperçu
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
                                    <div style={{ color: "#5f6c62", fontSize: 13 }}>
                                      Consentement: {consentLabel(junior.player_consent_status)}
                                    </div>
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
                                      {junior.junior_status === "sent"
                                        ? "Envoyé"
                                        : junior.junior_send_count > 0
                                        ? "Renvoyer accès junior"
                                        : "Envoyer accès junior"}
                                    </button>
                                    <button type="button" className="btn" onClick={() => openJuniorPreview(row, junior)}>
                                      Aperçu
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
                  <span className="pill-soft">{visibleUnlinkedJuniors.length} junior(s)</span>
                </div>

                {visibleUnlinkedJuniors.length === 0 ? (
                  <div className="notice-card">Tous les juniors éligibles ont un parent lié.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {visibleUnlinkedJuniors.map((junior) => (
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
                          <div style={{ color: "#5f6c62", fontSize: 13 }}>
                            Consentement: {consentLabel(junior.player_consent_status)}
                          </div>
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
      {portalReady && mailPreview
        ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 6000,
            background: "rgba(15,23,42,0.45)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setMailPreview(null)}
        >
          <div
            className="glass-card"
            style={{
              width: "min(760px, 100%)",
              maxHeight: "85vh",
              overflow: "hidden",
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.10)",
              display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr) auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                padding: 18,
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{mailPreview.title}</div>
                <div style={{ color: "#5f6c62", fontSize: 13 }}>Aperçu du message qui sera envoyé.</div>
              </div>
              <button type="button" className="btn" onClick={() => setMailPreview(null)}>
                Fermer
              </button>
            </div>
            <div style={{ overflow: "auto", padding: 18, display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", textTransform: "uppercase" }}>Sujet</div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>{mailPreview.subject}</div>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", textTransform: "uppercase" }}>Corps HTML</div>
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: "#fff",
                  }}
                  dangerouslySetInnerHTML={{ __html: textToHtml(mailPreview.body) }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", textTransform: "uppercase" }}>Corps texte</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 12,
                    lineHeight: 1.55,
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: "#fff",
                  }}
                >
                  {renderTemplateText(mailPreview.body)}
                </pre>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                padding: 18,
                borderTop: "1px solid #e5e7eb",
                background: "#fff",
              }}
            >
              <button type="button" className="btn" onClick={() => setMailPreview(null)}>
                Fermer
              </button>
              <button
                type="button"
                className="btn"
                disabled={
                  busyKey ===
                  `${mailPreview.kind}:${mailPreview.parentUserId}:${mailPreview.juniorUserId ?? mailPreview.parentUserId}`
                }
                onClick={async () => {
                  await sendInvitation(mailPreview.kind, mailPreview.parentUserId, mailPreview.juniorUserId);
                  setMailPreview(null);
                }}
              >
                {busyKey ===
                `${mailPreview.kind}:${mailPreview.parentUserId}:${mailPreview.juniorUserId ?? mailPreview.parentUserId}` ? (
                  <RefreshCw size={14} className="spin" />
                ) : (
                  <Mail size={14} />
                )}
                Envoyer le mail
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}
