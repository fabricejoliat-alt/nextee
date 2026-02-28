"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type ProfileLite = { id: string; first_name: string | null; last_name: string | null };
type MembershipProfileRow = { user_id: string; profiles?: ProfileLite | null };
type LinkRow = { player_id: string; guardian_user_id: string; relation: string | null; is_primary: boolean | null };
type PickerOption = { id: string; label: string };

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

export default function ManagerParentsPage() {
  const { locale } = useI18n();
  const [clubs, setClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [clubId, setClubId] = useState("");
  const [players, setPlayers] = useState<MembershipProfileRow[]>([]);
  const [parents, setParents] = useState<MembershipProfileRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [parentId, setParentId] = useState("");
  const [linksSearch, setLinksSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const first = list[0]?.id ?? "";
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
  }, []);

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

  const playerOptions = useMemo<PickerOption[]>(
    () =>
      players.map((p) => ({
        id: p.user_id,
        label: fullName(p.profiles),
      })),
    [players]
  );

  const parentOptions = useMemo<PickerOption[]>(
    () =>
      parents.map((p) => ({
        id: p.user_id,
        label: fullName(p.profiles),
      })),
    [parents]
  );

  const filteredLinks = useMemo(() => {
    const q = linksSearch.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => {
      const player = fullName(playerMap[l.player_id]).toLowerCase();
      const parent = fullName(parentMap[l.guardian_user_id]).toLowerCase();
      return `${player} ${parent}`.includes(q);
    });
  }, [links, linksSearch, playerMap, parentMap]);

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
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
              {locale === "fr" ? "Parents / Enfants" : "Parents / Children"}
            </div>
          </div>
          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>{locale === "fr" ? "Club" : "Club"}</span>
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

            <form onSubmit={addLink} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto" }}>
              <SearchablePicker
                options={playerOptions}
                value={playerId}
                onChange={setPlayerId}
                placeholder={locale === "fr" ? "Choisir un junior" : "Select junior"}
                searchPlaceholder={locale === "fr" ? "Rechercher un junior" : "Search junior"}
              />
              <SearchablePicker
                options={parentOptions}
                value={parentId}
                onChange={setParentId}
                placeholder={locale === "fr" ? "Choisir un parent" : "Select parent"}
                searchPlaceholder={locale === "fr" ? "Rechercher un parent" : "Search parent"}
              />
              <button className="btn" type="submit" disabled={busy || !playerId || !parentId}>
                {locale === "fr" ? "Rattacher" : "Link"}
              </button>
            </form>
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <div style={{ marginBottom: 10, maxWidth: 360 }}>
              <input
                value={linksSearch}
                onChange={(e) => setLinksSearch(e.target.value)}
                placeholder={locale === "fr" ? "Rechercher un rattachement" : "Search link"}
              />
            </div>
            {loading ? (
              <div>{locale === "fr" ? "Chargement…" : "Loading…"}</div>
            ) : filteredLinks.length === 0 ? (
              <div style={{ opacity: 0.7 }}>{locale === "fr" ? "Aucun rattachement." : "No links."}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {filteredLinks.map((l) => (
                  <div key={`${l.player_id}-${l.guardian_user_id}`} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>
                        {fullName(playerMap[l.player_id])} <span style={{ opacity: 0.6 }}>↔</span> {fullName(parentMap[l.guardian_user_id])}
                      </div>
                      <button className="btn btn-danger soft" type="button" disabled={busy} onClick={() => removeLink(l)}>
                        {locale === "fr" ? "Retirer" : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
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
  placeholder,
  searchPlaceholder,
}: {
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
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
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 30);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 30);
  }, [options, query]);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange("");
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={searchPlaceholder}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
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
