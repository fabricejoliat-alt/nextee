"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type Club = {
  id: string;
  name: string;
  slug: string | null;
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

export default function ClubsAdmin() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const canCreate = useMemo(() => name.trim().length >= 2, [name]);

  async function loadClubs() {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("clubs")
      .select("id,name,slug,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setClubs([]);
    } else {
      setClubs((data ?? []) as Club[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadClubs();
  }, []);

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const finalSlug = (slug || slugify(name)).trim() || null;

    const { error } = await supabase.from("clubs").insert({
      name: name.trim(),
      slug: finalSlug,
    });

    if (error) {
      setError(error.message);
      return;
    }

    setName("");
    setSlug("");
    setSlugTouched(false);
    await loadClubs();
  }

  function startEdit(club: Club) {
    setEditingId(club.id);
    setEditName(club.name ?? "");
    setEditSlug(club.slug ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditSlug("");
  }

  async function saveEdit() {
    if (!editingId) return;
    setError(null);

    const finalSlug = (editSlug || slugify(editName)).trim() || null;

    const { error } = await supabase
      .from("clubs")
      .update({
        name: editName.trim(),
        slug: finalSlug,
      })
      .eq("id", editingId);

    if (error) {
      setError(error.message);
      return;
    }

    cancelEdit();
    await loadClubs();
  }

  async function deleteClub(club: Club) {
    const ok = confirm(
      `Supprimer le club "${club.name}" ?\n\nCette action est irréversible.`
    );
    if (!ok) return;

    setError(null);
    console.log("Deleting club:", club.id);

    // 1️⃣ Supprimer coach_players (si existe)
    try {
      const cp = await supabase
        .from("coach_players")
        .delete()
        .eq("club_id", club.id);

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
      .eq("club_id", club.id);

    if (cm.error) {
      setError(`club_members: ${cm.error.message}`);
      return;
    }

    // 3️⃣ Supprimer le club
    const del = await supabase
      .from("clubs")
      .delete()
      .eq("id", club.id);

    if (del.error) {
      setError(`clubs: ${del.error.message}`);
      return;
    }

    if (editingId === club.id) cancelEdit();

    await loadClubs();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>
          Gestion des Clubs
        </h1>
        <p style={{ marginTop: 6, color: "var(--muted)" }}>
          Ajouter, modifier ou supprimer des clubs.
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
        <h2 style={{ marginTop: 0 }}>Ajouter un club</h2>

        <form
          onSubmit={createClub}
          style={{ display: "grid", gap: 10, maxWidth: 520 }}
        >
          <input
            placeholder="Nom du club"
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

          <button className="btn" disabled={!canCreate}>
            Ajouter
          </button>
        </form>
      </div>

      {/* List */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Liste des clubs</h2>

        {loading ? (
          <div>Chargement…</div>
        ) : clubs.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucun club.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {clubs.map((club) => {
              const isEditing = editingId === club.id;

              return (
                <div
                  key={club.id}
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
                      <div style={{ fontWeight: 800 }}>{club.name}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        slug: {club.slug ?? "—"}
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Link
                          href={`/admin/clubs/${club.id}`}
                          className="btn"
                        >
                          Gérer
                        </Link>
                        <button
                          className="btn"
                          onClick={() => startEdit(club)}
                        >
                          Modifier
                        </button>
                        <button
                          className="btn"
                          onClick={() => deleteClub(club)}
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

                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={saveEdit}>
                          Enregistrer
                        </button>
                        <button className="btn" onClick={cancelEdit}>
                          Annuler
                        </button>
                        <button
                          className="btn"
                          onClick={() => deleteClub(club)}
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
