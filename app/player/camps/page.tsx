"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin, Minus, Plus, TentTree, UserRound, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import styles from "./PlayerCamps.module.css";

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type CampDay = {
  event_id: string;
  day_index: number;
  practical_info: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location_text: string | null;
  status: string;
  attendance_status: "present" | "not_registered" | "absent" | "excused";
  participants_count: number;
  participants: ProfileLite[];
};
type CampOption = {
  id: string;
  name: string;
  description: string | null;
  applies_to_all_days: boolean;
  day_indexes: number[];
  capacity: number | null;
  allows_quantity: boolean;
  input_type: "checkbox" | "yes_no" | "select" | "radio";
  choices: string[];
  selected: boolean;
  quantity: number;
  value: string;
  remaining_capacity: number | null;
  available_quantity: number | null;
};
type CampRow = {
  id: string;
  club_name: string;
  title: string;
  notes: string | null;
  image_url: string | null;
  registration_status: "invited" | "registered" | "declined";
  head_coach: ProfileLite | null;
  options: CampOption[];
  days: CampDay[];
};

function fullName(profile?: ProfileLite | null) {
  return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "À définir";
}

function initials(profile?: ProfileLite | null) {
  return `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "?";
}

function formatDay(value: string | null) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return { weekday: "Date", day: "—", month: "à définir", long: "Date à définir" };
  return {
    weekday: new Intl.DateTimeFormat("fr-CH", { weekday: "short" }).format(date).replace(".", ""),
    day: new Intl.DateTimeFormat("fr-CH", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("fr-CH", { month: "short" }).format(date).replace(".", ""),
    long: new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long" }).format(date),
  };
}

function formatTime(value: string | null) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(":", "h");
}

function campDateRange(days: CampDay[]) {
  const datedDays = days.filter((day) => day.starts_at);
  if (!datedDays.length) return "Dates à définir";
  const first = new Date(datedDays[0].starts_at as string);
  const last = new Date(datedDays[datedDays.length - 1].starts_at as string);
  const formatter = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long", year: "numeric" });
  if (first.toDateString() === last.toDateString()) return formatter.format(first);
  return `Du ${formatter.format(first)} au ${formatter.format(last)}`;
}

function selectedCheckboxValues(value: string, choices: string[]) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry ?? "")).filter((entry) => choices.includes(entry))
      : [];
  } catch {
    return [];
  }
}

function Avatar({ profile, small = false }: { profile: ProfileLite | null; small?: boolean }) {
  const className = small ? styles.avatarSmall : styles.avatar;
  return profile?.avatar_url ? <img className={className} src={profile.avatar_url} alt="" /> : <span className={className}>{initials(profile)}</span>;
}

function CampSkeleton() {
  return <article className={`${styles.campCard} ${styles.skeleton}`} aria-label="Chargement d’un stage"><div className={`${styles.hero} ${styles.shimmer}`} /><div className={styles.campBody}><span className={`${styles.skeletonLine} ${styles.shimmer}`} /><span className={`${styles.skeletonLineShort} ${styles.shimmer}`} /><div className={`${styles.skeletonDay} ${styles.shimmer}`} /><div className={`${styles.skeletonDay} ${styles.shimmer}`} /></div></article>;
}

export default function PlayerCampsPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [participantsDay, setParticipantsDay] = useState<CampDay | null>(null);
  const childId = useMemo(() => String(searchParams.get("child_id") ?? "").trim(), [searchParams]);

  const headers = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const response = await fetch(`/api/player/camps${query}`, { headers: await headers(), cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error ?? "Impossible de charger les stages."));
      setCamps((payload?.camps ?? []) as CampRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur de chargement.");
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }, [childId, headers]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!participantsDay) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setParticipantsDay(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [participantsDay]);

  async function updateRegistration(campId: string, registered: boolean) {
    const action = registered ? "register" : "unregister";
    setBusyKey(`${action}-${campId}`);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const response = await fetch(`/api/player/camps/${encodeURIComponent(campId)}/register${query}`, { method: registered ? "POST" : "DELETE", headers: await headers() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error ?? "Mise à jour de l’inscription impossible."));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mise à jour de l’inscription impossible.");
    } finally {
      setBusyKey("");
    }
  }

  async function setDayAttendance(eventId: string, status: "present" | "absent") {
    setBusyKey(`day-${eventId}`);
    setError(null);
    setCamps((current) => current.map((camp) => ({
      ...camp,
      days: camp.days.map((day) => {
        if (day.event_id !== eventId) return day;
        const wasPresent = day.attendance_status === "present";
        const willBePresent = status === "present";
        const countDelta = wasPresent === willBePresent ? 0 : willBePresent ? 1 : -1;
        return {
          ...day,
          attendance_status: status,
          participants_count: Math.max(0, day.participants_count + countDelta),
        };
      }),
    })));
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const response = await fetch(`/api/player/camps/days/${encodeURIComponent(eventId)}/attendance${query}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ status }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error ?? "Mise à jour impossible."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mise à jour impossible.");
      await load();
    } finally {
      setBusyKey("");
    }
  }

  async function updateCampOption(campId: string, optionId: string, selected: boolean, quantity = 1, value = "") {
    setBusyKey(`option-${optionId}`);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const response = await fetch(`/api/player/camps/${encodeURIComponent(campId)}/options${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ option_id: optionId, selected, quantity, value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error ?? "Mise à jour de l’option impossible."));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mise à jour de l’option impossible.");
    } finally {
      setBusyKey("");
    }
  }

  function renderCampOption(campId: string, option: CampOption, scopeLabel: string) {
    const optionBusy = busyKey === `option-${option.id}`;
    const checkboxValues = option.input_type === "checkbox" && option.choices.length > 0
      ? selectedCheckboxValues(option.value, option.choices)
      : [];
    const unavailable = !option.selected && option.remaining_capacity === 0;
    const canDecrease = option.selected && option.quantity > 1;
    const canIncrease = option.selected && (option.available_quantity == null || option.quantity < option.available_quantity);
    return <article className={`${styles.option} ${option.selected ? styles.optionSelected : ""}`} key={option.id}>
      <div className={styles.optionCopy}>
        <div className={styles.optionTitle}><strong>{option.name}</strong>{option.selected ? <span><CheckCircle2 size={13} />{option.input_type === "checkbox" && option.choices.length === 0 ? "Choisie" : "Répondu"}</span> : null}</div>
        {option.description ? <p>{option.description}</p> : null}
        <small>{scopeLabel}{option.remaining_capacity != null ? ` · ${option.remaining_capacity} disponible${option.remaining_capacity > 1 ? "s" : ""}` : ""}</small>
      </div>
      <div className={styles.optionActions}>
        {option.input_type === "checkbox" && option.choices.length === 0 && option.allows_quantity && option.selected ? <div className={styles.quantity} aria-label={`Quantité pour ${option.name}`}>
          <button type="button" aria-label="Diminuer la quantité" disabled={optionBusy || !canDecrease} onClick={() => void updateCampOption(campId, option.id, true, option.quantity - 1)}><Minus size={13} /></button>
          <strong>{option.quantity}</strong>
          <button type="button" aria-label="Augmenter la quantité" disabled={optionBusy || !canIncrease} onClick={() => void updateCampOption(campId, option.id, true, option.quantity + 1)}><Plus size={13} /></button>
        </div> : null}
        {option.input_type === "checkbox" && option.choices.length === 0 ? <button type="button" className={option.selected ? styles.optionRemove : styles.optionAdd} disabled={optionBusy || unavailable} onClick={() => void updateCampOption(campId, option.id, !option.selected, option.quantity)}>{optionBusy ? "Mise à jour…" : option.selected ? "Retirer" : unavailable ? "Complet" : "Choisir"}</button> : null}
        {option.input_type === "checkbox" && option.choices.length > 0 ? <div className={styles.checkboxChoices}>{option.choices.map((choice) => {
          const checked = checkboxValues.includes(choice);
          return <label key={choice} className={checked ? styles.checkboxChoiceActive : ""}><input type="checkbox" checked={checked} disabled={optionBusy || unavailable} onChange={() => {
            const nextValues = checked ? checkboxValues.filter((value) => value !== choice) : [...checkboxValues, choice];
            void updateCampOption(campId, option.id, nextValues.length > 0, 1, JSON.stringify(nextValues));
          }} /><span>{choice}</span></label>;
        })}</div> : null}
        {option.input_type === "yes_no" ? <div className={styles.binaryChoice} aria-label={option.name}>
          <button type="button" className={option.value === "yes" ? styles.choiceActive : ""} disabled={optionBusy || unavailable} onClick={() => void updateCampOption(campId, option.id, true, 1, "yes")}>Oui</button>
          <button type="button" className={option.value === "no" ? styles.choiceActive : ""} disabled={optionBusy || unavailable} onClick={() => void updateCampOption(campId, option.id, true, 1, "no")}>Non</button>
        </div> : null}
        {option.input_type === "select" ? <select className={styles.optionSelect} aria-label={option.name} value={option.value} disabled={optionBusy || unavailable} onChange={(event) => void updateCampOption(campId, option.id, Boolean(event.target.value), 1, event.target.value)}>
          <option value="">Choisir…</option>{option.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select> : null}
        {option.input_type === "radio" ? <div className={styles.radioChoices}>{option.choices.map((choice) => <label key={choice} className={option.value === choice ? styles.radioChoiceActive : ""}><input type="radio" name={`camp-option-${option.id}`} value={choice} checked={option.value === choice} disabled={optionBusy || unavailable} onChange={() => void updateCampOption(campId, option.id, true, 1, choice)} /><span>{choice}</span></label>)}</div> : null}
      </div>
    </article>;
  }

  return (
    <div className={`player-dashboard-bg ${styles.page}`}>
      <div className={`app-shell marketplace-page ${styles.shell}`}>
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: "Stages / camps" }]} />
        <section className="glass-section">
          <div className="marketplace-header">
            <div><h1 className="section-title">Stages / camps</h1><p className="section-subtitle">Retrouve les informations, le programme et les participants de tes prochains stages.</p></div>
          </div>
        </section>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <main className={styles.list}>
          {loading ? <CampSkeleton /> : camps.length === 0 ? (
            <section className={styles.empty}><span><TentTree size={24} aria-hidden="true" /></span><h2>Aucun stage prévu</h2><p>Les prochains stages proposés par ton club apparaîtront ici.</p></section>
          ) : camps.map((camp) => {
            const registered = camp.registration_status === "registered";
            const registrationKey = `${registered ? "unregister" : "register"}-${camp.id}`;
            const stageOptions = camp.options.filter((option) => option.applies_to_all_days || option.day_indexes.length === 0);
            return (
              <article className={styles.campCard} key={camp.id}>
                <div className={styles.hero}>
                  {camp.image_url ? <img src={camp.image_url} alt={`Stage ${camp.title}`} /> : <div className={styles.heroFallback}><TentTree size={40} aria-hidden="true" /></div>}
                </div>

                <div className={styles.campBody}>
                  <header className={styles.campHeader}>
                    <span className={styles.club}>{camp.club_name}</span>
                    <h2>{camp.title}</h2>
                    <span className={styles.dateRange}><CalendarDays size={14} />{campDateRange(camp.days)}</span>
                  </header>
                  <div className={styles.summaryRow}>
                    <div className={styles.coach}><Avatar profile={camp.head_coach} /><span><small>Coach responsable</small><strong>{fullName(camp.head_coach)}</strong></span></div>
                    <div className={styles.registration}>{registered ? <span className={styles.registered}><CheckCircle2 size={15} />Inscrit</span> : null}<button type="button" className={registered ? styles.secondaryButton : styles.primaryButton} disabled={busyKey === registrationKey} onClick={() => void updateRegistration(camp.id, !registered)}>{busyKey === registrationKey ? "Mise à jour…" : registered ? "Se désinscrire" : "S’inscrire"}</button></div>
                  </div>
                  {camp.notes?.trim() ? <div className={styles.description} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(camp.notes) }} /> : null}

                  {registered && stageOptions.length ? <section className={styles.optionsSection}>
                    <div className={styles.sectionHeading}><span><CheckCircle2 size={16} />Options du stage</span><small>{stageOptions.filter((option) => option.selected).length} sélectionnée(s)</small></div>
                    <div className={styles.optionsList}>
                      {stageOptions.map((option) => renderCampOption(camp.id, option, "Valable pour tout le stage"))}
                    </div>
                  </section> : null}

                  <section className={styles.program}>
                    <div className={styles.sectionHeading}><span><CalendarDays size={16} />Programme</span><small>{camp.days.length} {camp.days.length > 1 ? "journées" : "journée"}</small></div>
                    <div className={styles.days}>
                      {camp.days.map((day) => {
                        const date = formatDay(day.starts_at);
                        const present = day.attendance_status === "present";
                        const dayOptions = registered
                          ? camp.options.filter((option) => !option.applies_to_all_days && option.day_indexes.includes(day.day_index))
                          : [];
                        return (
                          <article className={styles.day} key={day.event_id}>
                            <div className={styles.dateBox}><span>{date.weekday}</span><strong>{date.day}</strong><small>{date.month}</small><time>{formatTime(day.starts_at)}</time></div>
                            <div className={styles.dayContent}>
                              <div className={styles.dayTitle}><span>Journée {day.day_index + 1}</span><strong>{date.long}</strong></div>
                              {day.location_text ? <div className={styles.dayMeta}><span className={styles.dayLocation}><MapPin size={13} />{day.location_text}</span></div> : null}
                              {day.practical_info ? <p className={styles.dayNote}>{day.practical_info}</p> : null}
                              <button className={styles.participantsButton} type="button" onClick={() => setParticipantsDay(day)}><Users size={14} />Participants <b>{day.participants_count}</b></button>
                            </div>
                            {registered ? <AttendanceToggle variant="pill" checked={present} onToggle={() => void setDayAttendance(day.event_id, present ? "absent" : "present")} disabled={busyKey === `day-${day.event_id}`} disabledCursor="wait" ariaLabel="Basculer présence" leftLabel="Absent" rightLabel="Présent" /> : null}
                            {dayOptions.length ? <section className={styles.dayOptions}>
                              <strong className={styles.dayOptionsTitle}><CheckCircle2 size={14} />Options de la journée</strong>
                              <div className={styles.optionsList}>{dayOptions.map((option) => renderCampOption(camp.id, option, "Pour cette journée"))}</div>
                            </section> : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </article>
            );
          })}
        </main>
      </div>

      {participantsDay ? createPortal(
        <div className={styles.modalOverlay} role="presentation" onMouseDown={() => setParticipantsDay(null)}>
          <article className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="camp-participants-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className={styles.mobileBack} type="button" onClick={() => setParticipantsDay(null)}><ArrowLeft size={19} />Retour au stage</button>
            <button className={styles.modalClose} type="button" aria-label="Fermer" onClick={() => setParticipantsDay(null)}><X size={20} /></button>
            <div className={styles.modalBody}>
              <span className={styles.modalKicker}>Journée {participantsDay.day_index + 1}</span>
              <h2 id="camp-participants-title">Participants</h2>
              <p className={styles.modalCount}>{participantsDay.participants_count} participant{participantsDay.participants_count > 1 ? "s" : ""} présent{participantsDay.participants_count > 1 ? "s" : ""}</p>
              <div className={styles.participantList}>
                {participantsDay.participants.length === 0 ? (
                  <div className={styles.noParticipants}><UserRound size={20} /><span>Aucun participant présent pour le moment.</span></div>
                ) : participantsDay.participants.map((player) => (
                  <div className={styles.participant} key={player.id}><Avatar profile={player} small /><strong>{fullName(player)}</strong></div>
                ))}
              </div>
            </div>
          </article>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
