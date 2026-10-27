"use client";
import { useRetainedLoading } from "@/lib/useRetainedLoading";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

/* eslint-disable @next/next/no-img-element -- Club and profile images are dynamic Storage URLs. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin, Minus, Plus, TentTree, UserRound, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
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

function fullName(profile: ProfileLite | null | undefined, locale: string) {
  return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || pickLocaleText(locale, "À définir", "To be confirmed", "Noch offen");
}

function initials(profile?: ProfileLite | null) {
  return `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "?";
}

function dateLocale(locale: string) {
  return locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-GB";
}

function formatDay(value: string | null, locale: string) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return { weekday: pickLocaleText(locale, "Date", "Date", "Datum"), day: "—", month: pickLocaleText(locale, "à définir", "TBC", "noch offen"), long: pickLocaleText(locale, "Date à définir", "Date to be confirmed", "Datum noch offen") };
  return {
    weekday: new Intl.DateTimeFormat(dateLocale(locale), { weekday: "short" }).format(date).replace(".", ""),
    day: new Intl.DateTimeFormat(dateLocale(locale), { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat(dateLocale(locale), { month: "short" }).format(date).replace(".", ""),
    long: new Intl.DateTimeFormat(dateLocale(locale), { weekday: "long", day: "numeric", month: "long" }).format(date),
  };
}

function formatTime(value: string | null, locale: string) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "—";
  const formatted = new Intl.DateTimeFormat(dateLocale(locale), { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return locale === "fr" ? formatted.replace(":", "h") : formatted;
}

function campDateRange(days: CampDay[], locale: string) {
  const datedDays = days.filter((day) => day.starts_at);
  if (!datedDays.length) return pickLocaleText(locale, "Dates à définir", "Dates to be confirmed", "Termine noch offen");
  const first = new Date(datedDays[0].starts_at as string);
  const last = new Date(datedDays[datedDays.length - 1].starts_at as string);
  const formatter = new Intl.DateTimeFormat(dateLocale(locale), { day: "numeric", month: "long", year: "numeric" });
  if (first.toDateString() === last.toDateString()) return formatter.format(first);
  return pickLocaleText(locale, `Du ${formatter.format(first)} au ${formatter.format(last)}`, `From ${formatter.format(first)} to ${formatter.format(last)}`, `Vom ${formatter.format(first)} bis ${formatter.format(last)}`);
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
  const { locale } = useI18n();
  return <article className={`${styles.campCard} ${styles.skeleton}`} aria-label={pickLocaleText(locale, "Chargement d’un stage", "Loading camp", "Camp wird geladen")}><div className={`${styles.hero} ${styles.shimmer}`} /><div className={styles.campBody}><span className={`${styles.skeletonLine} ${styles.shimmer}`} /><span className={`${styles.skeletonLineShort} ${styles.shimmer}`} /><div className={`${styles.skeletonDay} ${styles.shimmer}`} /><div className={`${styles.skeletonDay} ${styles.shimmer}`} /></div></article>;
}

export default function PlayerCampsPage() {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string, de: string) => pickLocaleText(locale, fr, en, de);
  const searchParams = useSearchParams();
  const [loading, setLoading] = useRetainedLoading();
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [participantsDay, setParticipantsDay] = useState<CampDay | null>(null);
  const childId = useMemo(() => String(searchParams.get("child_id") ?? "").trim(), [searchParams]);
  const linkedCampId = useMemo(() => String(searchParams.get("camp_id") ?? "").trim(), [searchParams]);

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
      if (!response.ok) throw new Error(String(payload?.error ?? pickLocaleText(locale, "Impossible de charger les stages.", "Unable to load camps.", "Camps konnten nicht geladen werden.")));
      setCamps((payload?.camps ?? []) as CampRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pickLocaleText(locale, "Erreur de chargement.", "Loading error.", "Fehler beim Laden."));
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }, [childId, headers, locale, setLoading]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (loading || !linkedCampId || !camps.some((camp) => camp.id === linkedCampId)) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`camp-${linkedCampId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [camps, linkedCampId, loading]);

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
      if (!response.ok) throw new Error(String(payload?.error ?? tr("Mise à jour de l’inscription impossible.", "Unable to update registration.", "Anmeldung konnte nicht aktualisiert werden.")));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Mise à jour de l’inscription impossible.", "Unable to update registration.", "Anmeldung konnte nicht aktualisiert werden."));
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
      if (!response.ok) throw new Error(String(payload?.error ?? tr("Mise à jour impossible.", "Unable to update.", "Aktualisierung fehlgeschlagen.")));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Mise à jour impossible.", "Unable to update.", "Aktualisierung fehlgeschlagen."));
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
      if (!response.ok) throw new Error(String(payload?.error ?? tr("Mise à jour de l’option impossible.", "Unable to update option.", "Option konnte nicht aktualisiert werden.")));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Mise à jour de l’option impossible.", "Unable to update option.", "Option konnte nicht aktualisiert werden."));
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
        <div className={styles.optionTitle}><strong>{option.name}</strong>{option.selected ? <span><CheckCircle2 size={13} />{option.input_type === "checkbox" && option.choices.length === 0 ? tr("Choisie", "Selected", "Ausgewählt") : tr("Répondu", "Answered", "Beantwortet")}</span> : null}</div>
        {option.description ? <p>{option.description}</p> : null}
        <small>{scopeLabel}{option.remaining_capacity != null ? ` · ${option.remaining_capacity} ${tr("disponible(s)", "available", "verfügbar")}` : ""}</small>
      </div>
      <div className={styles.optionActions}>
        {option.input_type === "checkbox" && option.choices.length === 0 && option.allows_quantity && option.selected ? <div className={styles.quantity} aria-label={`${tr("Quantité pour", "Quantity for", "Menge für")} ${option.name}`}>
          <button type="button" aria-label={tr("Diminuer la quantité", "Decrease quantity", "Menge verringern")} disabled={optionBusy || !canDecrease} onClick={() => void updateCampOption(campId, option.id, true, option.quantity - 1)}><Minus size={13} /></button>
          <strong>{option.quantity}</strong>
          <button type="button" aria-label={tr("Augmenter la quantité", "Increase quantity", "Menge erhöhen")} disabled={optionBusy || !canIncrease} onClick={() => void updateCampOption(campId, option.id, true, option.quantity + 1)}><Plus size={13} /></button>
        </div> : null}
        {option.input_type === "checkbox" && option.choices.length === 0 ? <button type="button" className={option.selected ? styles.optionRemove : styles.optionAdd} disabled={optionBusy || unavailable} onClick={() => void updateCampOption(campId, option.id, !option.selected, option.quantity)}>{optionBusy ? tr("Mise à jour…", "Updating…", "Wird aktualisiert…") : option.selected ? tr("Retirer", "Remove", "Entfernen") : unavailable ? tr("Complet", "Full", "Ausgebucht") : tr("Choisir", "Choose", "Auswählen")}</button> : null}
        {option.input_type === "checkbox" && option.choices.length > 0 ? <div className={styles.checkboxChoices}>{option.choices.map((choice) => {
          const checked = checkboxValues.includes(choice);
          return <label key={choice} className={checked ? styles.checkboxChoiceActive : ""}><input type="checkbox" checked={checked} disabled={optionBusy || unavailable} onChange={() => {
            const nextValues = checked ? checkboxValues.filter((value) => value !== choice) : [...checkboxValues, choice];
            void updateCampOption(campId, option.id, nextValues.length > 0, 1, JSON.stringify(nextValues));
          }} /><span>{choice}</span></label>;
        })}</div> : null}
        {option.input_type === "yes_no" ? <div className={styles.binaryChoice} aria-label={option.name}>
          <button type="button" className={option.value === "yes" ? styles.choiceActive : ""} disabled={optionBusy || unavailable} onClick={() => void updateCampOption(campId, option.id, true, 1, "yes")}>{tr("Oui", "Yes", "Ja")}</button>
          <button type="button" className={option.value === "no" ? styles.choiceActive : ""} disabled={optionBusy || unavailable} onClick={() => void updateCampOption(campId, option.id, true, 1, "no")}>{tr("Non", "No", "Nein")}</button>
        </div> : null}
        {option.input_type === "select" ? <select className={styles.optionSelect} aria-label={option.name} value={option.value} disabled={optionBusy || unavailable} onChange={(event) => void updateCampOption(campId, option.id, Boolean(event.target.value), 1, event.target.value)}>
          <option value="">{tr("Choisir…", "Choose…", "Auswählen…")}</option>{option.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select> : null}
        {option.input_type === "radio" ? <div className={styles.radioChoices}>{option.choices.map((choice) => <label key={choice} className={option.value === choice ? styles.radioChoiceActive : ""}><input type="radio" name={`camp-option-${option.id}`} value={choice} checked={option.value === choice} disabled={optionBusy || unavailable} onChange={() => void updateCampOption(campId, option.id, true, 1, choice)} /><span>{choice}</span></label>)}</div> : null}
      </div>
    </article>;
  }

  return (
    <div className={`player-dashboard-bg ${styles.page}`}>
      <div className={`app-shell marketplace-page ${styles.shell}`}>
        <PlayerBreadcrumb items={[{ label: pickLocaleText(locale, "Espace joueur", "Player area"), href: "/player" }, { label: t("player.camps") }]} />
        <section className="glass-section">
          <div className="marketplace-header">
            <div><h1 className="section-title">{t("player.camps")}</h1><p className="section-subtitle">{t("player.campsSubtitle")}</p></div>
          </div>
        </section>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <main className={styles.list}>
          {loading ? <CampSkeleton /> : camps.length === 0 ? (
            <section className={styles.empty}><span><TentTree size={24} aria-hidden="true" /></span><h2>{pickLocaleText(locale, "Aucun stage prévu", "No camp scheduled", "Kein Camp geplant")}</h2><p>{pickLocaleText(locale, "Les prochains stages proposés par ton club apparaîtront ici.", "Upcoming camps offered by your club will appear here.", "Die nächsten Camps deines Clubs werden hier angezeigt.")}</p></section>
          ) : camps.map((camp) => {
            const registered = camp.registration_status === "registered";
            const registrationKey = `${registered ? "unregister" : "register"}-${camp.id}`;
            const stageOptions = camp.options.filter((option) => option.applies_to_all_days || option.day_indexes.length === 0);
            return (
              <article className={styles.campCard} id={`camp-${camp.id}`} key={camp.id}>
                <div className={styles.hero}>
                  {camp.image_url ? <img src={camp.image_url} alt={`${tr("Stage", "Camp", "Camp")} ${camp.title}`} /> : <div className={styles.heroFallback}><TentTree size={40} aria-hidden="true" /></div>}
                </div>

                <div className={styles.campBody}>
                  <header className={styles.campHeader}>
                    <span className={styles.club}>{camp.club_name}</span>
                    <h2>{camp.title}</h2>
                    <span className={styles.dateRange}><CalendarDays size={14} />{campDateRange(camp.days, locale)}</span>
                  </header>
                  <div className={styles.summaryRow}>
                    <div className={styles.coach}><Avatar profile={camp.head_coach} /><span><small>{tr("Coach responsable", "Head coach", "Haupttrainer")}</small><strong>{fullName(camp.head_coach, locale)}</strong></span></div>
                    <div className={styles.registration}>{registered ? <span className={styles.registered}><CheckCircle2 size={15} />{tr("Inscrit", "Registered", "Angemeldet")}</span> : null}<button type="button" className={registered ? styles.secondaryButton : styles.primaryButton} disabled={busyKey === registrationKey} onClick={() => void updateRegistration(camp.id, !registered)}>{busyKey === registrationKey ? tr("Mise à jour…", "Updating…", "Wird aktualisiert…") : registered ? tr("Se désinscrire", "Unregister", "Abmelden") : tr("S’inscrire", "Register", "Anmelden")}</button></div>
                  </div>
                  {camp.notes?.trim() ? <div className={styles.description} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(camp.notes) }} /> : null}

                  {registered && stageOptions.length ? <section className={styles.optionsSection}>
                    <div className={styles.sectionHeading}><span><CheckCircle2 size={16} />{tr("Options du stage", "Camp options", "Camp-Optionen")}</span><small>{stageOptions.filter((option) => option.selected).length} {tr("sélectionnée(s)", "selected", "ausgewählt")}</small></div>
                    <div className={styles.optionsList}>
                      {stageOptions.map((option) => renderCampOption(camp.id, option, tr("Valable pour tout le stage", "Applies to the whole camp", "Gilt für das gesamte Camp")))}
                    </div>
                  </section> : null}

                  <section className={styles.program}>
                    <div className={styles.sectionHeading}><span><CalendarDays size={16} />{tr("Programme", "Programme", "Programm")}</span><small>{camp.days.length} {camp.days.length > 1 ? tr("journées", "days", "Tage") : tr("journée", "day", "Tag")}</small></div>
                    <div className={styles.days}>
                      {camp.days.map((day) => {
                        const date = formatDay(day.starts_at, locale);
                        const present = day.attendance_status === "present";
                        const dayOptions = registered
                          ? camp.options.filter((option) => !option.applies_to_all_days && option.day_indexes.includes(day.day_index))
                          : [];
                        return (
                          <article className={styles.day} key={day.event_id}>
                            <div className={styles.dateBox}><span>{date.weekday}</span><strong>{date.day}</strong><small>{date.month}</small><time>{formatTime(day.starts_at, locale)}</time></div>
                            <div className={styles.dayContent}>
                              <div className={styles.dayTitle}><span>{tr("Journée", "Day", "Tag")} {day.day_index + 1}</span><strong>{date.long}</strong></div>
                              {day.location_text ? <div className={styles.dayMeta}><span className={styles.dayLocation}><MapPin size={13} />{day.location_text}</span></div> : null}
                              {day.practical_info ? <p className={styles.dayNote}>{day.practical_info}</p> : null}
                              <button className={styles.participantsButton} type="button" onClick={() => setParticipantsDay(day)}><Users size={14} />{tr("Participants", "Participants", "Teilnehmende")} <b>{day.participants_count}</b></button>
                            </div>
                            {registered ? <AttendanceToggle variant="pill" checked={present} onToggle={() => void setDayAttendance(day.event_id, present ? "absent" : "present")} disabled={busyKey === `day-${day.event_id}`} disabledCursor="wait" ariaLabel={tr("Modifier la présence", "Change attendance", "Anwesenheit ändern")} leftLabel={tr("Absent", "Absent", "Abwesend")} rightLabel={tr("Présent", "Present", "Anwesend")} /> : null}
                            {dayOptions.length ? <section className={styles.dayOptions}>
                              <strong className={styles.dayOptionsTitle}><CheckCircle2 size={14} />{tr("Options de la journée", "Day options", "Tagesoptionen")}</strong>
                              <div className={styles.optionsList}>{dayOptions.map((option) => renderCampOption(camp.id, option, tr("Pour cette journée", "For this day", "Für diesen Tag")))}</div>
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
            <button className={styles.mobileBack} type="button" onClick={() => setParticipantsDay(null)}><ArrowLeft size={19} />{tr("Retour au stage", "Back to camp", "Zurück zum Camp")}</button>
            <button className={styles.modalClose} type="button" aria-label={tr("Fermer", "Close", "Schliessen")} onClick={() => setParticipantsDay(null)}><X size={20} /></button>
            <div className={styles.modalBody}>
              <span className={styles.modalKicker}>{tr("Journée", "Day", "Tag")} {participantsDay.day_index + 1}</span>
              <h2 id="camp-participants-title">{tr("Participants", "Participants", "Teilnehmende")}</h2>
              <p className={styles.modalCount}>{participantsDay.participants_count} {tr("participant(s) présent(s)", "participants present", "anwesende Teilnehmende")}</p>
              <div className={styles.participantList}>
                {participantsDay.participants.length === 0 ? (
                  <div className={styles.noParticipants}><UserRound size={20} /><span>{tr("Aucun participant présent pour le moment.", "No participants present at the moment.", "Zurzeit sind keine Teilnehmenden anwesend.")}</span></div>
                ) : participantsDay.participants.map((player) => (
                  <div className={styles.participant} key={player.id}><Avatar profile={player} small /><strong>{fullName(player, locale)}</strong></div>
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
