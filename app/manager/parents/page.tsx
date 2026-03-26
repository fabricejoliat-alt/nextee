"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";

type ProfileLite = { id: string; first_name: string | null; last_name: string | null };
type MembershipProfileRow = {
  user_id: string;
  player_consent_status?: "granted" | "pending" | "adult" | null;
  profiles?: ProfileLite | null;
};
type LinkRow = { player_id: string; guardian_user_id: string; relation: string | null; is_primary: boolean | null };
type PickerOption = { id: string; label: string };

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

function normalizeForSearch(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function personSearchHaystack(p?: ProfileLite | null) {
  const first = normalizeForSearch((p?.first_name ?? "").trim());
  const last = normalizeForSearch((p?.last_name ?? "").trim());
  return [first, last, `${first} ${last}`.trim(), `${last} ${first}`.trim()].filter(Boolean).join(" | ");
}

function consentLabel(status: MembershipProfileRow["player_consent_status"]) {
  if (status === "granted") return "Accordé";
  if (status === "adult") return "Majeur";
  return "En attente";
}

export default function ManagerParentsPage() {
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const [clubs, setClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [clubId, setClubId] = useState("");
  const [players, setPlayers] = useState<MembershipProfileRow[]>([]);
  const [parents, setParents] = useState<MembershipProfileRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linksSearch, setLinksSearch] = useState("");
  const [attachmentFilter, setAttachmentFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [pendingParentByPlayer, setPendingParentByPlayer] = useState<Record<string, string>>({});
  const [activePickerPlayerId, setActivePickerPlayerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedClubId = searchParams.get("clubId");
  const requestedParentUserId = searchParams.get("parentUserId");

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadClubs() {
    const headers = await authHeader();
    const res = await fetch("/api/manager/my-clubs", {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "Erreur de chargement des clubs");

    return (Array.isArray(json?.clubs) ? json.clubs : [])
      .map((c: any) => ({
        id: String(c?.id ?? ""),
        name: String(c?.name ?? "Club"),
      }))
      .filter((c: { id: string }) => Boolean(c.id))
      .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  }

  async function loadLinks(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${selectedClubId}/guardians`, { headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Load failed");
      setPlayers((json.players ?? []) as MembershipProfileRow[]);
      setParents((json.parents ?? []) as MembershipProfileRow[]);
      setLinks((json.links ?? []) as LinkRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement.");
      setPlayers([]);
      setParents([]);
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const list = await loadClubs();
        setClubs(list);
        const first = (requestedClubId && list.find((club) => club.id === requestedClubId)?.id) ?? list[0]?.id ?? "";
        setClubId(first);
        if (first) await loadLinks(first);
        else setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Erreur de chargement des clubs");
        setClubs([]);
        setClubId("");
        setPlayers([]);
        setParents([]);
        setLinks([]);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedClubId]);

  useEffect(() => {
    if (!requestedClubId || !clubs.some((club) => club.id === requestedClubId) || requestedClubId === clubId) return;
    setClubId(requestedClubId);
    void loadLinks(requestedClubId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedClubId, clubs, clubId]);

  useEffect(() => {
    if (!requestedParentUserId) return;
    setAttachmentFilter("unlinked");
  }, [requestedParentUserId]);

  const playerMap = useMemo(() => {
    const m: Record<string, ProfileLite> = {};
    players.forEach((p) => {
      if (p.profiles) m[p.user_id] = p.profiles;
    });
    return m;
  }, [players]);

  const parentMap = useMemo(() => {
    const m: Record<string, ProfileLite> = {};
    parents.forEach((p) => {
      if (p.profiles) m[p.user_id] = p.profiles;
    });
    return m;
  }, [parents]);

  const parentOptions = useMemo<PickerOption[]>(
    () =>
      parents.map((p) => ({
        id: p.user_id,
        label: fullName(p.profiles),
      })),
    [parents]
  );

  const linksByPlayer = useMemo(() => {
    const map: Record<string, LinkRow[]> = {};
    for (const link of links) {
      if (!map[link.player_id]) map[link.player_id] = [];
      map[link.player_id].push(link);
    }
    return map;
  }, [links]);

  const filteredPlayers = useMemo(() => {
    const q = normalizeForSearch(linksSearch);
    const basePlayers = players.filter((p) => {
      const linked = (linksByPlayer[p.user_id] ?? []).length > 0;
      if (attachmentFilter === "linked") return linked;
      if (attachmentFilter === "unlinked") return !linked;
      return true;
    });
    if (!q) return basePlayers;

    const parentMatches = parents.some((p) => normalizeForSearch(fullName(p.profiles)).includes(q));
    if (parentMatches) {
      // If query matches a parent, keep all players visible so manager can link quickly.
      return basePlayers;
    }

    return basePlayers.filter((p) => {
      const playerName = personSearchHaystack(p.profiles);
      if (playerName.includes(q)) return true;
      const playerLinks = linksByPlayer[p.user_id] ?? [];
      return playerLinks.some((l) => personSearchHaystack(parentMap[l.guardian_user_id]).includes(q));
    });
  }, [players, parents, linksByPlayer, linksSearch, parentMap, attachmentFilter]);

  async function addLinkForPlayer(playerId: string, parentId: string) {
    if (!clubId || !playerId || !parentId) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/guardians`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          player_id: playerId,
          guardian_user_id: parentId,
          relation: "other",
          is_primary: false,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Save failed");
      setPendingParentByPlayer((prev) => ({ ...prev, [playerId]: "" }));
      await loadLinks(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de sauvegarde.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(link: LinkRow) {
    if (!clubId) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/guardians`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          player_id: link.player_id,
          guardian_user_id: link.guardian_user_id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Delete failed");
      await loadLinks(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de suppression.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {tr("Parents / Enfants", "Parents / Children")}
            </div>
          </div>
          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>{tr("Club", "Club")}</span>
              <select
                value={clubId}
                onChange={async (e) => {
                  const next = e.target.value;
                  setClubId(next);
                  await loadLinks(next);
                }}
              >
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ overflow: "visible" }}>
            <div style={{ marginBottom: 10, maxWidth: 360 }}>
              <input
                value={linksSearch}
                onChange={(e) => setLinksSearch(e.target.value)}
                placeholder={tr("Rechercher un rattachement", "Search link")}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {[
                { value: "all" as const, label: tr("Tous", "All") },
                { value: "linked" as const, label: tr("Avec parent", "Linked") },
                { value: "unlinked" as const, label: tr("Sans parent", "Unlinked") },
              ].map((option) => {
                const active = attachmentFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className="pill-soft"
                    onClick={() => setAttachmentFilter(option.value)}
                    style={{
                      border: active ? "1px solid #1f6f43" : "1px solid rgba(0,0,0,0.08)",
                      background: active ? "rgba(31,111,67,0.10)" : undefined,
                      color: active ? "#1f6f43" : undefined,
                      fontWeight: active ? 900 : 700,
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {loading ? (
              <ListLoadingBlock label={tr("Chargement...", "Loading...")} />
            ) : filteredPlayers.length === 0 ? (
              <div style={{ opacity: 0.7 }}>{tr("Aucun junior.", "No junior.")}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {filteredPlayers.map((player) => {
                  const playerLinks = linksByPlayer[player.user_id] ?? [];
                  const defaultRequestedParentId =
                    requestedParentUserId &&
                    !playerLinks.some((link) => link.guardian_user_id === requestedParentUserId) &&
                    parents.some((parent) => parent.user_id === requestedParentUserId)
                      ? requestedParentUserId
                      : "";
                  const selectedParentId = pendingParentByPlayer[player.user_id] ?? defaultRequestedParentId;
                  const availableParents = parentOptions.filter((option) => !playerLinks.some((l) => l.guardian_user_id === option.id));
                  return (
                    <div
                      key={player.user_id}
                      className="marketplace-item"
                      style={{
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: 12,
                        display: "grid",
                        gap: 10,
                        overflow: "visible",
                        position: "relative",
                        zIndex: activePickerPlayerId === player.user_id ? 900 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>{fullName(player.profiles)}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        Consentement: {consentLabel(player.player_consent_status ?? null)}
                      </div>
                      {playerLinks.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>{tr("Aucun parent rattaché.", "No linked parent.")}</div>
                      ) : (
                        <div style={{ display: "grid", gap: 6 }}>
                          {playerLinks.map((l) => (
                            <div
                              key={`${l.player_id}-${l.guardian_user_id}`}
                              style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}
                            >
                              <div>{fullName(parentMap[l.guardian_user_id])}</div>
                              <button className="btn btn-danger soft" type="button" disabled={busy} onClick={() => removeLink(l)}>
                                {tr("Retirer", "Remove")}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                        <SearchablePicker
                          options={availableParents}
                          value={selectedParentId}
                          onOpenChange={(open) => {
                            setActivePickerPlayerId((prev) => {
                              if (open) return player.user_id;
                              return prev === player.user_id ? "" : prev;
                            });
                          }}
                          onChange={(nextId) =>
                            setPendingParentByPlayer((prev) => ({
                              ...prev,
                              [player.user_id]: nextId,
                            }))
                          }
                          placeholder={tr("Choisir un parent", "Select parent")}
                          searchPlaceholder={tr("Rechercher un parent", "Search parent")}
                        />
                        <button
                          className="btn"
                          type="button"
                          disabled={busy || !selectedParentId}
                          onClick={() => addLinkForPlayer(player.user_id, selectedParentId)}
                        >
                          {tr("Rattacher", "Link")}
                        </button>
                      </div>
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

function SearchablePicker({
  options,
  value,
  onChange,
  onOpenChange,
  placeholder,
  searchPlaceholder,
}: {
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const selected = options.find((o) => o.id === value);
    setQuery(selected?.label ?? "");
  }, [value, options]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query);
    const base = [...options].sort((a, b) => a.label.localeCompare(b.label, "fr-CH", { sensitivity: "base" }));
    if (!q) return base;
    return base.filter((o) => normalizeForSearch(o.label).includes(q));
  }, [options, query]);

  return (
    <div style={{ position: "relative", zIndex: open ? 4000 : "auto" }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange("");
          setOpen(true);
          onOpenChange?.(true);
        }}
        onFocus={() => {
          setOpen(true);
          onOpenChange?.(true);
        }}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            onOpenChange?.(false);
          }, 120)
        }
        placeholder={searchPlaceholder}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 5000,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: "auto",
            background: "white",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 8px 18px rgba(0,0,0,0.08)",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "9px 10px", color: "var(--muted)", fontSize: 13 }}>{placeholder}</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setQuery(o.label);
                  setOpen(false);
                  onOpenChange?.(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  padding: "9px 10px",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
