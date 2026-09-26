"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, ShieldCheck, Users, WandSparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import ManagerMemberAvatar from "@/components/manager/ManagerMemberAvatar";
import baseStyles from "@/app/manager/camps/Camps.module.css";
import styles from "./AiAssistance.module.css";

type Club = { id: string; name: string | null };
type Coach = {
  id: string;
  user_id: string;
  is_active: boolean | null;
  coach_training_assistance_enabled: boolean;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    staff_function: string | null;
    avatar_url?: string | null;
  } | null;
};

async function authHeaders(json = false) {
  const { data } = await supabase.auth.getSession();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${data.session?.access_token ?? ""}`,
  };
}

function coachName(coach: Coach) {
  return [coach.profiles?.first_name, coach.profiles?.last_name].filter(Boolean).join(" ") || "Coach";
}

export default function ManagerAiAssistancePage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadCoaches(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/manager/clubs/${selectedClubId}/members`, {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? "Chargement impossible."));
      const next = (Array.isArray(json?.members) ? json.members : [])
        .filter((member: Coach & { role?: string }) => member.role === "coach")
        .sort((left: Coach, right: Coach) => coachName(left).localeCompare(coachName(right), "fr"));
      setCoaches(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      setCoaches([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(json?.error ?? "Chargement du club impossible."));
        const nextClubs = (Array.isArray(json?.clubs) ? json.clubs : []) as Club[];
        const firstClubId = String(nextClubs[0]?.id ?? "");
        setClubs(nextClubs);
        setClubId(firstClubId);
        if (firstClubId) await loadCoaches(firstClubId);
        else setLoading(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Chargement impossible.");
        setLoading(false);
      }
    })();
  }, []);

  const visibleCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    if (!normalizedQuery) return coaches;
    return coaches.filter((coach) => `${coachName(coach)} ${coach.profiles?.staff_function ?? ""}`.toLocaleLowerCase("fr").includes(normalizedQuery));
  }, [coaches, query]);

  const enabledCount = coaches.filter((coach) => coach.is_active !== false && coach.coach_training_assistance_enabled).length;
  const activeCount = coaches.filter((coach) => coach.is_active !== false).length;

  async function updateCoach(coach: Coach, enabled: boolean) {
    if (!clubId || coach.is_active === false || savingId) return;
    setSavingId(coach.id);
    setError("");
    setSuccess("");
    setCoaches((current) => current.map((item) => item.id === coach.id ? { ...item, coach_training_assistance_enabled: enabled } : item));
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/members`, {
        method: "PATCH",
        headers: await authHeaders(true),
        body: JSON.stringify({ memberId: coach.id, coach_training_assistance_enabled: enabled }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? "Mise à jour impossible."));
      setSuccess(`${coachName(coach)} : assistance IA ${enabled ? "activée" : "désactivée"}.`);
    } catch (cause) {
      setCoaches((current) => current.map((item) => item.id === coach.id ? { ...item, coach_training_assistance_enabled: !enabled } : item));
      setError(cause instanceof Error ? cause.message : "Mise à jour impossible.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className={baseStyles.page}>
      <nav className={baseStyles.breadcrumb} aria-label="Fil d’Ariane">
        <Link href="/manager">Manager</Link><ChevronRight size={13} /><span>Paramètres</span><ChevronRight size={13} /><span>Assistance IA</span>
      </nav>

      <div className={baseStyles.topline}>
        <div>
          <h1>Assistance IA</h1>
          <p className={baseStyles.lead}>Choisissez individuellement les coachs qui peuvent utiliser l’aide à l’évaluation et à la préparation des entraînements.</p>
        </div>
      </div>

      {error ? <div className={baseStyles.alertError} role="alert">{error}</div> : null}
      {success ? <div className={baseStyles.alertSuccess} role="status">{success}</div> : null}

      <section className={styles.summaryGrid} aria-label="Résumé de l’activation">
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><WandSparkles size={19} /></span><div><b>{enabledCount}</b><span>coachs avec assistance IA</span></div></article>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><Users size={19} /></span><div><b>{activeCount}</b><span>coachs actifs dans le club</span></div></article>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><ShieldCheck size={19} /></span><div><b>Individuel</b><span>accès contrôlé par coach</span></div></article>
      </section>

      <section className={baseStyles.panel}>
        <div className={baseStyles.panelHeader}>
          <div><h2>Accès des coachs</h2><p>L’activation autorise les synthèses IA, les notes suggérées et les points d’attention issus des derniers entraînements.</p></div>
          <div className={styles.controls}>
            {clubs.length > 1 ? <label className={`user-mgmt-field ${styles.control}`}><span className="user-mgmt-field-label">Club</span><select value={clubId} onChange={(event) => { const next = event.target.value; setClubId(next); void loadCoaches(next); }}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? "Club"}</option>)}</select></label> : null}
            <label className={`user-mgmt-field ${styles.searchControl}`}>
              <span className="user-mgmt-field-label">Recherche</span>
              <span className={styles.searchField}><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom ou fonction" /></span>
            </label>
          </div>
        </div>

        {loading ? <ListLoadingBlock label="Chargement des coachs…" /> : visibleCoaches.length === 0 ? <div className={styles.empty}>Aucun coach ne correspond à la recherche.</div> : (
          <div className={styles.coachList}>
            {visibleCoaches.map((coach) => {
              const enabled = coach.coach_training_assistance_enabled;
              const inactive = coach.is_active === false;
              return <article className={styles.coachRow} key={coach.id}>
                <div className={styles.identity}>
                  <ManagerMemberAvatar name={coachName(coach)} avatarUrl={coach.profiles?.avatar_url ?? null} />
                  <div><b>{coachName(coach)}</b><span>{coach.profiles?.staff_function || "Coach"}{inactive ? " · Inactif" : ""}</span></div>
                </div>
                <div className={styles.rowActions}>
                  <span className={styles.switchLabel}>{enabled ? "Activée" : "Désactivée"}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Assistance IA pour ${coachName(coach)}`}
                    className={`${styles.toggle} ${enabled ? styles.toggleOn : ""}`}
                    disabled={inactive || savingId !== null}
                    onClick={() => void updateCoach(coach, !enabled)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </main>
  );
}
