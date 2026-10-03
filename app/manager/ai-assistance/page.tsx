"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search, ShieldCheck, Users, WandSparkles } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerSettingsPresentation } from "@/lib/managerSettingsPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
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


export default function ManagerAiAssistancePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requestedClubId = params.get("club") ?? "";
  const { format, count, errorText } = managerSettingsPresentation(t, locale);
  function coachName(coach: Coach) {
    return [coach.profiles?.first_name, coach.profiles?.last_name].filter(Boolean).join(" ") || t("manager.settings.coach");
  }

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [clubsError, setClubsError] = useState(false);
  const clubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loadedClubId, setLoadedClubId] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const loadSequence = useRef(0);
  const activeClubRef = useRef(clubId);
  activeClubRef.current = clubId;
  const selectionKey = clubId || (requestedClubId ? `invalid:${requestedClubId}` : "none");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ name: string; enabled: boolean } | null>(null);
  const scopeReady = Boolean(clubId && loadedClubId === clubId && !loading && !loadFailed);

  async function loadCoaches(selectedClubId: string) {
    if (!selectedClubId) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    setSuccess(null);
    setCoaches([]);
    setLoadedClubId("");
    setLoadFailed(false);
    try {
      const response = await fetch(`/api/manager/clubs/${selectedClubId}/members`, {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? t("manager.settings.loadError")));
      if (sequence !== loadSequence.current || activeClubRef.current !== selectedClubId) return;
      const next = (Array.isArray(json?.members) ? json.members : [])
        .filter((member: Coach & { role?: string }) => member.role === "coach");
      setCoaches(next);
    } catch (cause) {
      if (sequence !== loadSequence.current || activeClubRef.current !== selectedClubId) return;
      setLoadFailed(true);
      setError(cause instanceof Error ? cause.message : t("manager.settings.loadError"));
      setCoaches([]);
    } finally {
      if (sequence === loadSequence.current && activeClubRef.current === selectedClubId) { setLoadedClubId(selectedClubId); setLoading(false); }
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(json?.error ?? t("manager.settings.clubLoadError")));
        const nextClubs = (Array.isArray(json?.clubs) ? json.clubs : []) as Club[];
        setClubs(nextClubs);
        setClubsLoaded(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("manager.settings.loadError"));
        setClubsError(true);
        setClubsLoaded(true);
        setLoading(false);
      }
    })();
    // Fetch clubs once; switching language must not reset the selected club.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clubsLoaded || clubsError) return;
    if (clubId) void loadCoaches(clubId);
    else { ++loadSequence.current; setCoaches([]); setLoadedClubId(""); setLoadFailed(true); setError(t(requestedClubId ? "manager.clubUnavailable" : "manager.settings.noClub")); setLoading(false); }
    // The URL club scopes each coach response and access toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubsLoaded, clubsError, selectionKey]);

  function selectClub(id: string) {
    if (id === clubId || !clubs.some((club) => club.id === id) || savingId) return;
    const next = new URLSearchParams(params.toString()); next.set("club", id);
    router.replace(`/manager/ai-assistance?${next}`, { scroll: false });
  }

  const visibleCoaches = [...(scopeReady ? coaches : [])].sort((left, right) => coachName(left).localeCompare(coachName(right), managerLocaleTag(locale))).filter((coach) => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return !normalizedQuery || `${coachName(coach)} ${coach.profiles?.staff_function ?? ""}`.toLocaleLowerCase(locale).includes(normalizedQuery);
  });

  const enabledCount = scopeReady ? coaches.filter((coach) => coach.is_active !== false && coach.coach_training_assistance_enabled).length : null;
  const activeCount = scopeReady ? coaches.filter((coach) => coach.is_active !== false).length : null;

  async function updateCoach(coach: Coach, enabled: boolean) {
    if (!scopeReady || coach.is_active === false || savingId) return;
    setSavingId(coach.id);
    setError("");
    setSuccess(null);
    setCoaches((current) => current.map((item) => item.id === coach.id ? { ...item, coach_training_assistance_enabled: enabled } : item));
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/members`, {
        method: "PATCH",
        headers: await authHeaders(true),
        body: JSON.stringify({ memberId: coach.id, coach_training_assistance_enabled: enabled }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? t("manager.settings.updateError")));
      if (activeClubRef.current === clubId) setSuccess({ name: coachName(coach), enabled });
    } catch (cause) {
      if (activeClubRef.current === clubId) { setCoaches((current) => current.map((item) => item.id === coach.id ? { ...item, coach_training_assistance_enabled: !enabled } : item)); setError(cause instanceof Error ? cause.message : t("manager.settings.updateError")); }
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className={baseStyles.page}>
      <nav className={baseStyles.breadcrumb} aria-label={t("manager.settings.breadcrumb")}>
        <Link href="/manager">{t("manager.settings.manager")}</Link><ChevronRight size={13} /><span>{t("manager.settings.settings")}</span><ChevronRight size={13} /><span>{t("manager.settings.ai.title")}</span>
      </nav>

      <div className={baseStyles.topline}>
        <div>
          <h1>{t("manager.settings.ai.title")}</h1>
          <p className={baseStyles.lead}>{t("manager.settings.ai.lead")}</p>
        </div>
      </div>

      {error ? <div className={baseStyles.alertError} role="alert">{errorText(error)}</div> : null}
      {success ? <div className={baseStyles.alertSuccess} role="status">{format(success.enabled ? "ai.enabledSuccess" : "ai.disabledSuccess", { name: success.name })}</div> : null}

      <section className={styles.summaryGrid} aria-label={t("manager.settings.ai.summary")}>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><WandSparkles size={19} /></span><div><b>{enabledCount ?? "—"}</b><span>{scopeReady ? count("ai.enabledCount", enabledCount ?? 0) : ""}</span></div></article>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><Users size={19} /></span><div><b>{activeCount ?? "—"}</b><span>{scopeReady ? count("ai.activeCount", activeCount ?? 0) : ""}</span></div></article>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><ShieldCheck size={19} /></span><div><b>{t("manager.settings.ai.individual")}</b><span>{t("manager.settings.ai.controlledAccess")}</span></div></article>
      </section>

      <section className={baseStyles.panel}>
        <div className={`${baseStyles.panelHeader} ${styles.panelHeader}`}>
          <div><h2>{t("manager.settings.ai.access")}</h2><p>{t("manager.settings.ai.accessHelp")}</p></div>
          <div className={styles.controls}>
            <label className={`user-mgmt-field ${styles.control}`}><span className="user-mgmt-field-label">{t("manager.settings.club")}</span><select value={clubId} disabled={!clubsLoaded || Boolean(savingId) || !clubs.length} onChange={(event) => selectClub(event.target.value)}>{!clubId ? <option value="">{t(clubs.length ? "manager.chooseClub" : "manager.noClub")}</option> : null}{clubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? t("manager.settings.club")}</option>)}</select></label>
            <label className={`user-mgmt-field ${styles.searchControl}`}>
              <span className="user-mgmt-field-label">{t("manager.settings.search")}</span>
              <span className={styles.searchField}><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("manager.settings.ai.searchPlaceholder")} /></span>
            </label>
          </div>
        </div>

        {loading || (clubId && !loadFailed && !scopeReady) ? <ListLoadingBlock label={t("manager.settings.ai.loading")} /> : !scopeReady ? null : visibleCoaches.length === 0 ? <div className={styles.empty}>{t("manager.settings.ai.empty")}</div> : (
          <div className={styles.coachList}>
            {visibleCoaches.map((coach) => {
              const enabled = coach.coach_training_assistance_enabled;
              const inactive = coach.is_active === false;
              return <article className={styles.coachRow} key={coach.id}>
                <div className={styles.identity}>
                  <ManagerMemberAvatar name={coachName(coach)} avatarUrl={coach.profiles?.avatar_url ?? null} />
                  <div><b>{coachName(coach)}</b><span>{coach.profiles?.staff_function || t("manager.settings.coach")}{inactive ? t("manager.settings.ai.inactiveSuffix") : ""}</span></div>
                </div>
                <div className={styles.rowActions}>
                  <span className={styles.switchLabel}>{enabled ? t("manager.settings.ai.enabled") : t("manager.settings.ai.disabled")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={format("ai.switchLabel", { name: coachName(coach) })}
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
