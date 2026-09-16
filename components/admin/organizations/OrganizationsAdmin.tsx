"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { Building2, ChevronRight, Filter, Plus, Search } from "lucide-react";
import styles from "./OrganizationsAdmin.module.css";

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

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | OrgType>("all");
  const [tablePage, setTablePage] = useState(1);

  const canCreate = useMemo(() => name.trim().length >= 2, [name]);
  const filteredOrganizations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("fr");
    return organizations.filter((organization) => {
      const matchesSearch = !normalizedSearch || [organization.name, organization.slug ?? "", organization.org_type]
        .some((value) => value.toLocaleLowerCase("fr").includes(normalizedSearch));
      const matchesType = typeFilter === "all" || organization.org_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [organizations, search, typeFilter]);
  const tablePageSize = 8;
  const tableTotalPages = Math.max(1, Math.ceil(filteredOrganizations.length / tablePageSize));
  const visibleOrganizations = filteredOrganizations.slice((tablePage - 1) * tablePageSize, tablePage * tablePageSize);

  async function loadOrganizations() {
    setLoading(true);
    setError(null);
    try {
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur chargement organisations");
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
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

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
        <Link href="/admin">Administration</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>Organisations</span>
      </nav>
      <h1 className={styles.pageTitle}>Organisations</h1>

      {error && (
        <div className={styles.errorAlert} role="alert">
          {error}
        </div>
      )}

      <section className={styles.creationCard} id="new-organization">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIcon}><Building2 size={21} /></div>
          <div>
            <h2>Nouvelle organisation</h2>
            <p>Les informations pourront être modifiées à tout moment.</p>
          </div>
        </div>

        <form onSubmit={createOrganization} className={styles.formGrid}>
          <label className={`${styles.field} ${styles.nameField}`}>
            <span>Nom de l’organisation</span>
            <input
              placeholder="Ex. Golf Club de Sion"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!slugTouched) setSlug(slugify(v));
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Type d’organisation</span>
            <select value={orgType} onChange={(e) => setOrgType(e.target.value as OrgType)}>
              <option value="club">Club</option>
              <option value="academy">Académie</option>
              <option value="federation">Fédération</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Identifiant URL</span>
            <input
              placeholder="golf-club-de-sion"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
          </label>

          <div className={styles.submitField}>
            <button className={styles.primaryButton} disabled={!canCreate}>
              <Plus size={16} strokeWidth={2.5} /> Créer l’organisation
            </button>
          </div>
        </form>
      </section>

      <section className={styles.listCard}>
        <div className={styles.listHeader}>
          <div>
            <h2>Organisations enregistrées</h2>
            <span>Liste</span>
          </div>
        </div>

        <div className={styles.tableToolbar}>
          <label className={styles.tableSearch}>
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setTablePage(1); }} placeholder="Rechercher une organisation" aria-label="Rechercher une organisation" />
          </label>
          <label className={styles.tableFilter}>
            <Filter size={14} aria-hidden="true" />
            <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value as "all" | OrgType); setTablePage(1); }} aria-label="Filtrer par type">
              <option value="all">Tous les types</option>
              <option value="club">Clubs</option>
              <option value="academy">Académies</option>
              <option value="federation">Fédérations</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className={styles.emptyState}>Chargement des organisations…</div>
        ) : filteredOrganizations.length === 0 ? (
          <div className={styles.emptyState}>Aucune organisation ne correspond à votre recherche.</div>
        ) : (
          <div className={styles.tableFrame}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Type</th>
                  <th>Identifiant URL</th>
                  <th>Créée le</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
            {visibleOrganizations.map((org, index) => (
                <tr key={org.id} className={index % 2 === 1 ? styles.alternateRow : ""}>
                    <>
                      <td data-label="Organisation">
                        <strong className={styles.organizationName}>{org.name}</strong>
                      </td>
                      <td data-label="Type"><span className={`${styles.typeTag} ${styles[`type${org.org_type}`]}`}>{orgTypeLabel(org.org_type)}</span></td>
                      <td data-label="Identifiant URL"><code>{org.slug ?? "—"}</code></td>
                      <td data-label="Créée le"><span className={styles.date}>{formatDate(org.created_at)}</span></td>
                      <td className={styles.actionCell}>
                        <div className={styles.rowActions}>
                        <Link
                          href={`/admin/organizations/${org.id}/settings`}
                          className={styles.secondaryButton}
                        >
                          Paramètres
                        </Link>
                        </div>
                      </td>
                    </>
                </tr>
            ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filteredOrganizations.length > 0 ? (
          <div className={styles.tableFooter}>
            <span>{`${((tablePage - 1) * tablePageSize) + 1}-${Math.min(tablePage * tablePageSize, filteredOrganizations.length)} sur ${filteredOrganizations.length}`}</span>
            <div className={styles.pagination}>
              <button type="button" onClick={() => setTablePage((current) => Math.max(1, current - 1))} disabled={tablePage === 1}>Précédent</button>
              {Array.from({ length: tableTotalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} onClick={() => setTablePage(page)} aria-current={page === tablePage ? "page" : undefined}>{page}</button>)}
              <button type="button" onClick={() => setTablePage((current) => Math.min(tableTotalPages, current + 1))} disabled={tablePage === tableTotalPages}>Suivant</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function orgTypeLabel(type: OrgType) {
  return type === "academy" ? "Académie" : type === "federation" ? "Fédération" : "Club";
}

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
}
