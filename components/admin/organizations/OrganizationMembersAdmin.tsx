"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Club = {
  id: string;
  name: string;
  slug: string | null;
};

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type ClubMember = {
  id: string;
  club_id: string;
  user_id: string;
  role: "manager" | "coach" | "player";
  is_active: boolean | null;
  created_at: string | null;
};

function fullName(p?: Profile | null) {
  if (!p) return "";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

export default function OrganizationMembersAdmin() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;

  const [club, setClub] = useState<Club | null>(null);

  const [members, setMembers] = useState<ClubMember[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());

  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<"manager" | "coach" | "player">("player");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);

    // 1) club
    const clubRes = await supabase
      .from("clubs")
      .select("id,name,slug")
      .eq("id", organizationId)
      .maybeSingle();

    if (clubRes.error) {
      setError(clubRes.error.message);
      setLoading(false);
      return;
    }
    setClub(clubRes.data ?? null);

    // 2) superadmins (exclude)
    const adminsRes = await supabase.from("app_admins").select("user_id");
    if (adminsRes.error) {
      setError(adminsRes.error.message);
      setLoading(false);
      return;
    }
    const adminSet = new Set<string>((adminsRes.data ?? []).map((a: any) => a.user_id));
    setAdminIds(adminSet);

    // 3) members
    const memRes = await supabase
      .from("club_members")
      .select("id,club_id,user_id,role,is_active,created_at")
      .eq("club_id", organizationId)
      .order("created_at", { ascending: false });

    if (memRes.error) {
      setError(memRes.error.message);
      setLoading(false);
      return;
    }

    const memsRaw = (memRes.data ?? []) as ClubMember[];
    const mems = memsRaw.filter((m) => !adminSet.has(m.user_id)); // sécurité
    setMembers(mems);

    // 4) profiles for members
    const memberUserIds = Array.from(new Set(mems.map((m) => m.user_id)));
    const profMap: Record<string, Profile> = {};

    if (memberUserIds.length > 0) {
      const profRes = await supabase
        .from("profiles")
        .select("id,first_name,last_name")
        .in("id", memberUserIds);

      if (profRes.error) {
        setError(profRes.error.message);
        setLoading(false);
        return;
      }

      (profRes.data ?? []).forEach((p: any) => (profMap[p.id] = p as Profile));
    }
    setProfilesById(profMap);

    // 5) all users for dropdown (exclude superadmins)
    const allRes = await supabase
      .from("profiles")
      .select("id,first_name,last_name")
      .order("created_at", { ascending: false });

    if (allRes.error) {
      setError(allRes.error.message);
      setLoading(false);
      return;
    }

    const users = (allRes.data ?? []) as Profile[];
    setAllUsers(users.filter((u) => !adminSet.has(u.id)));

    setLoading(false);
  }

  useEffect(() => {
    if (!organizationId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const memberUserIdSet = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const addableUsers = useMemo(() => {
    return allUsers
      .filter((u) => !memberUserIdSet.has(u.id))
      .sort((a, b) => {
        const an = fullName(a).toLowerCase();
        const bn = fullName(b).toLowerCase();
        return an.localeCompare(bn);
      });
  }, [allUsers, memberUserIdSet]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedUserId) return;

    // UI anti-doublon
    if (memberUserIdSet.has(selectedUserId)) {
      setError("Cet utilisateur est déjà membre de cette organisation.");
      return;
    }

    setBusy(true);

    const { error } = await supabase.from("club_members").insert({
      club_id: organizationId,
      user_id: selectedUserId,
      role: selectedRole,
      is_active: true,
    });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    setSelectedUserId("");
    setSelectedRole("player");
    await loadAll();
    setBusy(false);
  }

  async function updateMember(memberId: string, patch: Partial<ClubMember>) {
    setError(null);
    setBusy(true);

    const { error } = await supabase
      .from("club_members")
      .update(patch)
      .eq("id", memberId);

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    await loadAll();
    setBusy(false);
  }

  async function removeMember(memberId: string) {
    if (!confirm("Supprimer ce membre de l’organisation ?")) return;

    setError(null);
    setBusy(true);

    const { error } = await supabase.from("club_members").delete().eq("id", memberId);

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    await loadAll();
    setBusy(false);
  }

  function RoleBadge({ role }: { role: ClubMember["role"] }) {
    const label =
      role === "manager" ? "Manager" : role === "coach" ? "Coach" : "Joueur";

    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 10px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          fontSize: 12,
          fontWeight: 800,
          background: "rgba(0,0,0,0.03)",
        }}
      >
        {label}
      </span>
    );
  }

  if (!organizationId) {
    return (
      <div className="card">
        <b>Erreur :</b> organizationId manquant dans l’URL.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>
          {club ? club.name : "Organisation"}
        </h1>
        <p style={{ marginTop: 6, color: "var(--muted)" }}>
          Ajoute des utilisateurs existants à cette organisation et définis leur rôle.
        </p>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/admin/organizations/${organizationId}/groups`} className="btn">
            Gestion des groupes
          </Link>
        </div>
      </div>

      {error && (
        <div
          style={{
            border: "1px solid #ffcccc",
            background: "#fff5f5",
            padding: 12,
            borderRadius: 12,
            color: "#a00",
          }}
        >
          {error}
        </div>
      )}

      {/* Add member */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ajouter un membre</h2>

        <form
          onSubmit={addMember}
          style={{ display: "grid", gap: 10, maxWidth: 520 }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Utilisateur
            </span>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              style={inputStyle}
              disabled={loading || busy}
            >
              <option value="">— Sélectionner —</option>
              {addableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {fullName(u) || "Sans nom"}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Rôle</span>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as any)}
              style={inputStyle}
              disabled={!selectedUserId || loading || busy}
            >
              <option value="player">Joueur</option>
              <option value="coach">Coach</option>
              <option value="manager">Manager</option>
            </select>
          </label>

          <button className="btn" type="submit" disabled={!selectedUserId || busy}>
            Ajouter à l’organisation
          </button>

          {addableUsers.length === 0 && !loading && (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Aucun utilisateur disponible à ajouter.
            </div>
          )}
        </form>
      </div>

      {/* Members */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Membres</h2>

        {loading ? (
          <div>Chargement…</div>
        ) : members.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucun membre.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {members.map((m) => {
              const p = profilesById[m.user_id];
              const name = fullName(p) || "Sans nom";
              const active = m.is_active !== false;

              return (
                <div
                  key={m.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900 }}>{name}</div>
                      <RoleBadge role={m.role} />
                      {!active && (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          (désactivé)
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select
                      value={m.role}
                      onChange={(e) => updateMember(m.id, { role: e.target.value as any })}
                      style={smallSelectStyle}
                      disabled={busy}
                    >
                      <option value="player">Joueur</option>
                      <option value="coach">Coach</option>
                      <option value="manager">Manager</option>
                    </select>

                    <button
                      className="btn"
                      onClick={() => updateMember(m.id, { is_active: !active })}
                      disabled={busy}
                    >
                      {active ? "Désactiver" : "Activer"}
                    </button>

                    <button className="btn" onClick={() => removeMember(m.id)} disabled={busy}>
                      Retirer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Note */}
      <div style={{ color: "var(--muted)", fontSize: 12 }}>
        Note : ce composant fonctionne même sans foreign key. Si on ajoute une FK plus tard,
        on pourra simplifier les requêtes avec des joins.
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};

const smallSelectStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "white",
};
