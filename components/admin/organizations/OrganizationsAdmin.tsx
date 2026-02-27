"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type OrgType = "club" | "academy" | "federation";

type Organization = {
  id: string;
  name: string;
  slug: string | null;
  org_type: OrgType;
  created_at: string | null;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}

export default function OrganizationsAdmin() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [orgType, setOrgType] = useState<OrgType>("club");
  const [slugTouched, setSlugTouched] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editOrgType, setEditOrgType] = useState<OrgType>("club");

  const canCreate = useMemo(() => name.trim().length >= 2, [name]);

  async function loadOrganizations() {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("organizations")
      .select("id,name,slug,org_type,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setOrganizations([]);
    } else {
      setOrganizations((data ?? []) as Organization[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadOrganizations();
  }, []);

  async function createOrganization(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const finalSlug = (slug || slugify(name)).trim() || null;
    const orgId = crypto.randomUUID();
    const finalName = name.trim();

    // Transitional dual-write:
    // - organizations = source v2 (with org_type)
    // - clubs = compatibility for existing admin members page and legacy flows
    const orgRes = await supabase.from("organizations").insert({
      id: orgId,
      name: finalName,
      slug: finalSlug,
      org_type: orgType,
      is_active: true,
    });

    if (orgRes.error) {
      setError(orgRes.error.message);
      return;
    }

    const clubRes = await supabase.from("clubs").insert({
      id: orgId,
      name: finalName,
      slug: finalSlug,
    });

    if (clubRes.error) {
      // rollback best-effort on organizations if legacy insert fails
      await supabase.from("organizations").delete().eq("id", orgId);
      setError(`clubs: ${clubRes.error.message}`);
      return;
    }

    setName("");
    setSlug("");
    setOrgType("club");
    setSlugTouched(false);
    await loadOrganizations();
  }

  function startEdit(org: Organization) {
    setEditingId(org.id);
    setEditName(org.name ?? "");
    setEditSlug(org.slug ?? "");
    setEditOrgType(org.org_type ?? "club");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditSlug("");
    setEditOrgType("club");
  }

  async function saveEdit() {
    if (!editingId) return;
    setError(null);

    const finalSlug = (editSlug || slugify(editName)).trim() || null;
    const finalName = editName.trim();

    const orgRes = await supabase
      .from("organizations")
      .update({
        name: finalName,
        slug: finalSlug,
        org_type: editOrgType,
      })
      .eq("id", editingId);

    if (orgRes.error) {
      setError(orgRes.error.message);
      return;
    }

    const clubRes = await supabase
      .from("clubs")
      .update({
        name: finalName,
        slug: finalSlug,
      })
      .eq("id", editingId);

    if (clubRes.error) {
      setError(`clubs: ${clubRes.error.message}`);
      return;
    }

    cancelEdit();
    await loadOrganizations();
  }

  async function deleteOrganization(org: Organization) {
    const ok = confirm(
      `Supprimer l’organisation "${org.name}" ?\n\nCette action est irréversible.`
    );
    if (!ok) return;

    setError(null);
    console.log("Deleting organization:", org.id);

    // 1️⃣ Supprimer coach_players (si existe)
    try {
      const cp = await supabase
        .from("coach_players")
        .delete()
        .eq("club_id", org.id);

      if (cp.error) {
        const msg = cp.error.message.toLowerCase();
        if (!msg.includes("does not exist")) {
          setError(`coach_players: ${cp.error.message}`);
          return;
        }
      }
    } catch {
      // ignore si table inexistante
    }

    // 2️⃣ Supprimer club_members
    const cm = await supabase
      .from("club_members")
      .delete()
      .eq("club_id", org.id);

    if (cm.error) {
      setError(`club_members: ${cm.error.message}`);
      return;
    }

    // 3️⃣ Supprimer l'organisation
    const delOrg = await supabase
      .from("organizations")
      .delete()
      .eq("id", org.id);

    if (delOrg.error) {
      setError(`organizations: ${delOrg.error.message}`);
      return;
    }

    // 4️⃣ Supprimer la ligne legacy club
    const delClub = await supabase
      .from("clubs")
      .delete()
      .eq("id", org.id);

    if (delClub.error) {
      setError(`clubs: ${delClub.error.message}`);
      return;
    }

    if (editingId === org.id) cancelEdit();

    await loadOrganizations();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>
          Gestion des Organisations
        </h1>
        <p style={{ marginTop: 6, color: "var(--muted)" }}>
          Ajouter, modifier ou supprimer des organisations.
        </p>
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

      {/* Create */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ajouter une organisation</h2>

        <form
          onSubmit={createOrganization}
          style={{ display: "grid", gap: 10, maxWidth: 520 }}
        >
          <input
            placeholder="Nom de l’organisation"
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              if (!slugTouched) setSlug(slugify(v));
            }}
            style={inputStyle}
          />

          <input
            placeholder="Slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            style={inputStyle}
          />

          <select
            value={orgType}
            onChange={(e) => setOrgType(e.target.value as OrgType)}
            style={inputStyle}
          >
            <option value="club">Club</option>
            <option value="academy">Academy</option>
            <option value="federation">Federation</option>
          </select>

          <button className="btn" disabled={!canCreate}>
            Ajouter
          </button>
        </form>
      </div>

      {/* List */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Liste des organisations</h2>

        {loading ? (
          <div>Chargement…</div>
        ) : organizations.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucune organisation.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {organizations.map((org) => {
              const isEditing = editingId === org.id;

              return (
                <div
                  key={org.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {!isEditing ? (
                    <>
                      <div style={{ fontWeight: 800 }}>{org.name}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        slug: {org.slug ?? "—"} • type: {org.org_type}
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Link
                          href={`/admin/organizations/${org.id}`}
                          className="btn"
                        >
                          Gérer
                        </Link>
                        <Link
                          href={`/admin/organizations/${org.id}/groups`}
                          className="btn"
                        >
                          Groupes
                        </Link>
                        <button
                          className="btn"
                          onClick={() => startEdit(org)}
                        >
                          Modifier
                        </button>
                        <button
                          className="btn"
                          onClick={() => deleteOrganization(org)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={inputStyle}
                      />
                      <input
                        value={editSlug}
                        onChange={(e) => setEditSlug(e.target.value)}
                        style={inputStyle}
                      />
                      <select
                        value={editOrgType}
                        onChange={(e) => setEditOrgType(e.target.value as OrgType)}
                        style={inputStyle}
                      >
                        <option value="club">Club</option>
                        <option value="academy">Academy</option>
                        <option value="federation">Federation</option>
                      </select>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={saveEdit}>
                          Enregistrer
                        </button>
                        <button className="btn" onClick={cancelEdit}>
                          Annuler
                        </button>
                        <button
                          className="btn"
                          onClick={() => deleteOrganization(org)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
