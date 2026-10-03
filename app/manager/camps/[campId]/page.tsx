/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { managerContentPresentation } from "@/lib/managerContentPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useParams, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  Download,
  Pencil,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import navigationStyles from "@/app/design-system/design-system.module.css";
import styles from "../Camps.module.css";

type Attendance =
  | "expected"
  | "present"
  | "absent"
  | "excused"
  | "not_registered";
type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
type Day = {
  id: string;
  event_id: string;
  day_index: number;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  practical_info: string | null;
  responsible_coach_id: string | null;
  evaluation_enabled: boolean;
  group_id: string;
  counts: Record<string, number>;
  evaluation: { required: number; completed: number };
};
type Camp = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  capacity: number | null;
  head_coach: Profile | null;
  coach_ids: string[];
  days: Day[];
  player_ids: string[];
  stats: { invited: number; registered: number; coaches: number };
  evaluation: { required: number; completed: number };
  player_registrations: Array<{
    player_id: string;
    registration_status: string;
    day_status_by_day_index: Record<string, Attendance>;
    player: Profile | null;
  }>;
  options: Array<{
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    applies_to_all_days: boolean;
    day_indexes: number[];
    capacity: number | null;
    allows_quantity: boolean;
    input_type: "checkbox" | "yes_no" | "select" | "radio";
    choices: string[];
    internal_note: string | null;
    player_assignments: Array<{
      player_id: string;
      quantity: number;
      note: string | null;
      selected_value: string | null;
    }>;
    assigned_count: number;
    assigned_quantity: number;
  }>;
};
type Tab = "overview" | "days" | "participants" | "evaluations" | "options";


function name(profile?: Profile | null) {
  return (
    `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "—"
  );
}
function initials(profile?: Profile | null) {
  return (
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() ||
    "?"
  );
}


function Avatar({ profile }: { profile?: Profile | null }) {
  return (
    <span className={styles.avatar}>
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" />
      ) : (
        initials(profile)
      )}
    </span>
  );
}




export default function CampDetailPage() {
  const { t, locale } = useI18n();
  const { format, count, number, errorText } = managerContentPresentation(t, locale);
  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: t("manager.content.overview") },
    { id: "days", label: t("manager.content.days") },
    { id: "participants", label: t("manager.content.participantsAttendance") },
    { id: "evaluations", label: t("manager.content.evaluations") },
    { id: "options", label: t("manager.content.options") },
  ];
  function optionTypeLabel(type: Camp["options"][number]["input_type"]) {
    if (type === "yes_no") return t("manager.content.yesNo");
    if (type === "select") return t("manager.content.select");
    if (type === "radio") return t("manager.content.radio");
    return t("manager.content.checkbox");
  }
  function optionAnswer(value: string | null, type: Camp["options"][number]["input_type"]) {
    if (!value) return type === "checkbox" ? t("manager.content.yes") : "";
    if (type === "yes_no") return value === "yes" ? t("manager.content.yes") : value === "no" ? t("manager.content.no") : value;
    if (type === "checkbox") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String).join(", ");
      } catch {
        return value;
      }
    }
    return value;
  }
  function dayLabel(day: Day) {
    const start = new Date(day.starts_at);
    return new Intl.DateTimeFormat(managerLocaleTag(locale), {
      timeZone: "Europe/Zurich",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(start);
  }
  function timeRange(day: Day) {
    const format = new Intl.DateTimeFormat(managerLocaleTag(locale), {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${format.format(new Date(day.starts_at))} – ${format.format(new Date(day.ends_at))}`;
  }
  const ATTENDANCE_LABELS: Record<Attendance, string> = {
    expected: t("manager.content.expected"),
    present: t("manager.content.present"),
    absent: t("manager.content.absent"),
    excused: t("manager.content.excused"),
    not_registered: t("manager.content.notRegistered"),
  };

  const campId = String(useParams<{ campId: string }>().campId ?? "");
  const search = useSearchParams();
  const tab = (search.get("tab") as Tab) || "overview";
  const [camp, setCamp] = useState<Camp | null>(null);
  const [coachProfiles, setCoachProfiles] = useState<Record<string, Profile>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function headers(json = false) {
    const { data } = await supabase.auth.getSession();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    };
  }
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/manager/camps", {
        headers: await headers(),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(String(payload?.error ?? t("manager.content.loadFailed")));
      const found = (payload?.camps ?? []).find(
        (entry: Camp) => entry.id === campId,
      );
      if (!found) throw new Error(t("manager.content.campNotFound"));
      setCamp(found);
      const ids = Array.from(
        new Set(
          [
            found.head_coach?.id,
            ...found.coach_ids,
            ...found.days.map((day: Day) => day.responsible_coach_id),
          ].filter(Boolean),
        ),
      ) as string[];
      if (ids.length) {
        const profiles = await supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url")
          .in("id", ids);
        if (!profiles.error)
          setCoachProfiles(
            Object.fromEntries(
              (profiles.data ?? []).map((profile: any) => [
                String(profile.id),
                profile,
              ]),
            ),
          );
      }
    } catch (cause: any) {
      setError(cause?.message ?? t("manager.content.loadFailed"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [campId]);
  useEffect(() => {
    setSuccess(null);
  }, [tab]);
  async function setAttendance(
    eventId: string,
    updates: Array<{ player_id: string; status: Attendance }>,
    message: string,
  ) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/manager/camps/${campId}`, {
        method: "PATCH",
        headers: await headers(true),
        body: JSON.stringify({
          action: "set_attendance",
          event_id: eventId,
          attendance_updates: updates,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(String(payload?.error ?? t("manager.content.updateError")));
      setSuccess(message);
      await load();
    } catch (cause: any) {
      setError(cause?.message ?? t("manager.content.updateError"));
    } finally {
      setBusy(false);
    }
  }
  const registrations = camp?.player_registrations ?? [];
  const alerts = (() => {
    if (!camp) return [];
    const next: string[] = [];
    if (camp.days.some((day) => !day.responsible_coach_id))
      next.push(t("manager.content.missingDayCoach"));
    if (camp.capacity != null && camp.player_ids.length > camp.capacity)
      next.push(t("manager.content.capacityExceeded"));
    if (registrations.some((entry) => entry.registration_status === "invited"))
      next.push(t("manager.content.pendingRegistrations"));
    if (
      camp.options.some(
        (option) =>
          option.capacity != null &&
          option.assigned_quantity >= option.capacity,
      )
    )
      next.push(t("manager.content.optionsAtCapacity"));
    if (camp.evaluation.completed < camp.evaluation.required)
      next.push(
        count("pendingEvaluations", camp.evaluation.required - camp.evaluation.completed),
      );
    return next;
  })();
  function exportOptions() {
    if (!camp) return;
    const rows = [[t("manager.content.option"), t("manager.content.answerType"), t("manager.content.junior"), t("manager.content.answer"), t("manager.content.quantity"), t("manager.content.note")]];
    camp.options.forEach((option) =>
      option.player_assignments.forEach((assignment) => {
        const registration = registrations.find(
          (entry) => entry.player_id === assignment.player_id,
        );
        rows.push([
          option.name,
          optionTypeLabel(option.input_type),
          name(registration?.player),
          optionAnswer(assignment.selected_value, option.input_type),
          String(assignment.quantity),
          assignment.note ?? "",
        ]);
      }),
    );
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";"),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `options-${camp.title.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label={t("manager.content.breadcrumb")}>
        <Link href="/manager/camps">{t("manager.content.camps")}</Link>
        <ChevronRight size={13} />
        <span>{camp?.title ?? t("manager.content.camp")}</span>
      </nav>
      <div className={styles.topline}>
        <div>
          <h1>{camp?.title ?? t("manager.content.camp")}</h1>
        </div>
        {camp ? (
          <div className={styles.actions}>
            <Link
              className={styles.primary}
              href={`/manager/camps/new?campId=${camp.id}`}
            >
              <Pencil size={15} />
              {t("manager.content.editCamp")}
            </Link>
          </div>
        ) : null}
      </div>
      <section className={styles.panel}>
        <nav
          className={`${navigationStyles.tabs} ${styles.detailTabs}`}
          aria-label={t("manager.content.campNavigation")}
        >
          {TABS.map(({ id, label }) => (
            <Link
              key={id}
              className={styles.detailTab}
              href={`/manager/camps/${campId}?tab=${id}`}
              aria-current={tab === id ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      </section>
      {error ? (
        <div className={styles.alertError} role="alert">
          {errorText(error)}
        </div>
      ) : null}
      {success ? (
        <div className={styles.alertSuccess} role="status">
          {errorText(success)}
        </div>
      ) : null}
      {loading ? <ListLoadingBlock label={t("manager.content.loadingCamps")} /> : null}
      {!loading && camp ? (
        <>
          {tab === "overview" ? (
            <>
              <section className={styles.metrics}>
                <div className={styles.metric}>
                  <span>{t("manager.content.days")}</span>
                  <b>{camp.days.length}</b>
                </div>
                <div className={styles.metric}>
                  <span>{t("manager.content.participants")}</span>
                  <b>
                    {camp.player_ids.length}
                    {camp.capacity ? ` / ${camp.capacity}` : ""}
                  </b>
                </div>
                <div className={styles.metric}>
                  <span>{t("manager.content.headCoach")}</span>
                  <b style={{ fontSize: 13 }}>{name(camp.head_coach)}</b>
                </div>
                <div className={styles.metric}>
                  <span>{t("manager.content.evaluations")}</span>
                  <b>
                    {camp.evaluation.completed}/{camp.evaluation.required}
                  </b>
                </div>
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>{t("manager.content.attention")}</h2>
                    <p>{t("manager.content.attentionHelp")}</p>
                  </div>
                </div>
                {alerts.length ? (
                  <div className={styles.stack}>
                    {alerts.map((alert) => (
                      <div className={styles.alertWarning} key={alert}>
                        {alert}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.alertSuccess}>
                    <CheckCircle2 size={16} />
                    {t("manager.content.noBlockers")}
                  </div>
                )}
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>{t("manager.content.nextDays")}</h2>
                    <p>{t("manager.content.chronology")}</p>
                  </div>
                </div>
                <div className={styles.stack}>
                  {camp.days.map((day) => (
                    <div className={styles.dayCard} key={day.id}>
                      <div className={styles.cardHead}>
                        <div>
                          <h3>{dayLabel(day)}</h3>
                          <span className={styles.muted}>
                            {timeRange(day)} ·{" "}
                            {day.location_text || t("manager.content.noLocation")}
                          </span>
                        </div>
                        <span className={styles.badge}>
                          {day.evaluation_enabled
                            ? t("manager.content.evaluable")
                            : t("manager.content.noEvaluation")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
          {tab === "days" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{t("manager.content.campDays")}</h2>
                  <p>
                    {t("manager.content.dayProgressHelp")}
                  </p>
                </div>
              </div>
              <div className={styles.stack}>
                {camp.days.map((day) => (
                  <article className={styles.dayCard} key={day.id}>
                    <div className={styles.cardHead}>
                      <div>
                        <h3>
                          {format("dayNumber", { number: number(day.day_index + 1) })} · {dayLabel(day)}
                        </h3>
                        <span className={styles.muted}>{timeRange(day)}</span>
                      </div>
                      <span className={styles.badge}>
                        {day.evaluation_enabled
                          ? format("evaluationsProgress", { completed: number(day.evaluation.completed), total: number(day.evaluation.required) })
                          : t("manager.content.notEvaluable")}
                      </span>
                    </div>
                    <div className={styles.grid3}>
                      <div>
                        <span className={styles.muted}>{t("manager.content.responsibleCoach")}</span>
                        <b style={{ display: "block" }}>
                          {name(
                            coachProfiles[day.responsible_coach_id ?? ""] ??
                              camp.head_coach,
                          )}
                        </b>
                      </div>
                      <div>
                        <span className={styles.muted}>{t("manager.content.location")}</span>
                        <b style={{ display: "block" }}>
                          {day.location_text || t("manager.content.noLocation")}
                        </b>
                      </div>
                      <div>
                        <span className={styles.muted}>{t("manager.content.presentPlural")}</span>
                        <b style={{ display: "block" }}>
                          {day.counts?.present ?? 0}
                        </b>
                      </div>
                    </div>
                    {day.practical_info ? (
                      <p className={styles.muted}>{day.practical_info}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {tab === "participants" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{t("manager.content.participantsAttendance")}</h2>
                  <p>
                    {t("manager.content.attendanceDetailHelp")}
                  </p>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.matrix}>
                  <thead>
                    <tr>
                      <th>{t("manager.content.junior")}</th>
                      <th>{t("manager.content.registration")}</th>
                      {camp.days.map((day) => (
                        <th key={day.id}>
                          {format("dayNumber", { number: number(day.day_index + 1) })}
                          <button
                            className={styles.iconButton}
                            style={{ marginLeft: 7 }}
                            type="button"
                            title={t("manager.content.allPresent")}
                            aria-label={`${t("manager.content.allPresent")} · ${format("dayNumber", { number: number(day.day_index + 1) })}`}
                            disabled={busy}
                            onClick={() =>
                              void setAttendance(
                                day.event_id,
                                registrations
                                  .filter(
                                    (entry) =>
                                      entry.registration_status ===
                                      "registered",
                                  )
                                  .map((entry) => ({
                                    player_id: entry.player_id,
                                    status: "present",
                                  })),
                                format("allPresentDay", { number: number(day.day_index + 1) }),
                              )
                            }
                          >
                            <CheckCircle2 size={13} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {registrations.map((registration) => (
                      <tr key={registration.player_id}>
                        <td>
                          <div className={styles.person}>
                            <Avatar profile={registration.player} />
                            <b>{name(registration.player)}</b>
                          </div>
                        </td>
                        <td>
                          {registration.registration_status === "registered"
                            ? t("manager.content.registered")
                            : registration.registration_status === "declined"
                              ? t("manager.content.declined")
                              : t("manager.content.invited")}
                        </td>
                        {camp.days.map((day) => {
                          const value =
                            registration.day_status_by_day_index[
                              String(day.day_index)
                            ] ?? "not_registered";
                          return (
                            <td key={day.id}>
                              <select
                                aria-label={format("attendanceFor", { name: name(registration.player), number: number(day.day_index + 1) })}
                                value={value}
                                disabled={busy}
                                onChange={(event) =>
                                  void setAttendance(
                                    day.event_id,
                                    [
                                      {
                                        player_id: registration.player_id,
                                        status: event.target
                                          .value as Attendance,
                                      },
                                    ],
                                    t("manager.content.attendanceUpdated"),
                                  )
                                }
                              >
                                {Object.entries(ATTENDANCE_LABELS).map(
                                  ([id, label]) => (
                                    <option key={id} value={id}>
                                      {label}
                                    </option>
                                  ),
                                )}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {tab === "evaluations" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{t("manager.content.evaluations")}</h2>
                  <p>
                    {t("manager.content.evaluationHelp")}
                  </p>
                </div>
              </div>
              <div className={styles.stack}>
                {camp.days.map((day) => (
                  <div className={styles.dayCard} key={day.id}>
                    <div className={styles.cardHead}>
                      <div>
                        <h3>
                          {format("dayNumber", { number: number(day.day_index + 1) })} · {dayLabel(day)}
                        </h3>
                        <span className={styles.muted}>
                          {day.evaluation_enabled
                            ? format("completedProgress", { completed: number(day.evaluation.completed), total: number(day.evaluation.required) })
                            : t("manager.content.noEvaluationPlanned")}
                        </span>
                      </div>
                      {day.evaluation_enabled ? (
                        <Link
                          className={styles.secondary}
                          href={`/manager/groups/${day.group_id}/planning/${day.event_id}/players`}
                        >
                          {t("manager.content.openEvaluations")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {tab === "options" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{t("manager.content.options")}</h2>
                  <p>
                    {t("manager.content.optionsDetailHelp")}
                  </p>
                </div>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={exportOptions}
                >
                  <Download size={15} />
                  {t("manager.content.export")}
                </button>
              </div>
              {camp.options.length === 0 ? (
                <div className={styles.empty}>{t("manager.content.noOptions")}</div>
              ) : (
                <div className={styles.stack}>
                  {camp.options.map((option) => (
                    <article className={styles.optionCard} key={option.id}>
                      <div className={styles.cardHead}>
                        <div>
                          <h3>{option.name}</h3>
                          <span className={styles.muted}>
                            {option.description || t("manager.content.noDescription")}
                          </span>
                        </div>
                        <div className={styles.cardMeta}>
                          <span className={styles.badge}>
                            {optionTypeLabel(option.input_type)}
                          </span>
                          <span className={styles.badge}>
                            {option.applies_to_all_days
                              ? t("manager.content.campOption")
                              : format("optionDays", { days: option.day_indexes.map((dayIndex) => number(dayIndex + 1)).join(", ") })}
                          </span>
                          <span className={styles.badge}>
                            {option.is_active ? t("manager.content.active") : t("manager.content.inactive")}
                          </span>
                        </div>
                      </div>
                      <div className={styles.summaryGrid}>
                        <div className={styles.summaryItem}>
                          <span>{t("manager.content.registrations")}</span>
                          <b>{option.assigned_count}</b>
                        </div>
                        <div className={styles.summaryItem}>
                          <span>{t("manager.content.quantity")}</span>
                          <b>{option.assigned_quantity}</b>
                        </div>
                        <div className={styles.summaryItem}>
                          <span>{t("manager.content.remainingCapacity")}</span>
                          <b>
                            {option.capacity == null
                              ? t("manager.content.unlimited")
                              : Math.max(
                                  0,
                                  option.capacity - option.assigned_quantity,
                                )}
                          </b>
                        </div>
                      </div>
                      <div className={styles.pillRow}>
                        {option.player_assignments.map((assignment) => {
                          const registration = registrations.find(
                            (entry) => entry.player_id === assignment.player_id,
                          );
                          return (
                            <span
                              className={styles.pill}
                              key={assignment.player_id}
                            >
                              {name(registration?.player)}
                              {option.allows_quantity
                                ? ` × ${assignment.quantity}`
                                : ""}
                              {assignment.selected_value
                                ? ` · ${optionAnswer(assignment.selected_value, option.input_type)}`
                                : ""}
                            </span>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
