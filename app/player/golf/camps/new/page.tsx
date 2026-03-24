"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PlusCircle, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { invalidateClientPageCacheByPrefix } from "@/lib/clientPageCache";

const TRAINING_CATEGORY_VALUES = [
  "warmup_mobility",
  "long_game",
  "short_game_all",
  "putting",
  "wedging",
  "pitching",
  "chipping",
  "bunker",
  "course",
  "mental",
  "fitness",
  "other",
] as const;

function buildMinuteOptions() {
  const opts: number[] = [];
  for (let m = 5; m <= 300; m += 5) opts.push(m);
  return opts;
}
const MINUTE_OPTIONS = buildMinuteOptions();

type DayItemDraft = {
  category: string;
  minutes: string;
  note: string;
};

type DayDraft = {
  session_id?: string | null;
  starts_at: string;
  ends_at: string;
  location_text: string;
  items: DayItemDraft[];
};

function nextLocalDateTime(daysOffset: number, hour: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function newItem(): DayItemDraft {
  return { category: "", minutes: "", note: "" };
}

function newDay(index: number): DayDraft {
  return {
    session_id: null,
    starts_at: nextLocalDateTime(index + 1, 9, 0),
    ends_at: nextLocalDateTime(index + 1, 16, 0),
    location_text: "",
    items: [newItem()],
  };
}

function toLocalInputValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlayerCampNewPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCampId = String(searchParams.get("campId") ?? "").trim();
  const isEditing = requestedCampId.length > 0;
  const [loading, setLoading] = useState(isEditing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [coachName, setCoachName] = useState("");
  const [notes, setNotes] = useState("");
  const [days, setDays] = useState<DayDraft[]>([newDay(0)]);

  const categories = useMemo(
    () =>
      TRAINING_CATEGORY_VALUES.map((value) => ({
        value,
        label: t(`cat.${value}`),
      })),
    [t]
  );

  useEffect(() => {
    if (!requestedCampId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await resolveEffectivePlayerContext();
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (!token) throw new Error("Missing token");

        const query = new URLSearchParams();
        if (ctx.role === "parent") query.set("child_id", ctx.effectiveUserId);

        const res = await fetch(`/api/player/personal-camps/${encodeURIComponent(requestedCampId)}?${query.toString()}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Load failed"));
        if (cancelled) return;

        const camp = json?.camp ?? null;
        setTitle(String(camp?.title ?? ""));
        setCoachName(String(camp?.coach_name ?? ""));
        setNotes(String(camp?.notes ?? ""));
        setDays(
          (Array.isArray(camp?.days) && camp.days.length > 0
            ? camp.days.map((day: any) => ({
                session_id: String(day?.session_id ?? "").trim() || null,
                starts_at: toLocalInputValue(day?.starts_at),
                ends_at: toLocalInputValue(day?.ends_at),
                location_text: String(day?.location_text ?? ""),
                items:
                  Array.isArray(day?.items) && day.items.length > 0
                    ? day.items.map((item: any) => ({
                        category: String(item?.category ?? ""),
                        minutes: String(item?.minutes ?? ""),
                        note: String(item?.note ?? ""),
                      }))
                    : [newItem()],
              }))
            : [newDay(0)]) as DayDraft[]
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? pickLocaleText(locale, "Chargement impossible.", "Load failed."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedCampId, locale]);

  function updateDay(index: number, patch: Partial<DayDraft>) {
    setDays((current) => current.map((day, i) => (i === index ? { ...day, ...patch } : day)));
  }

  function updateDayItem(dayIndex: number, itemIndex: number, patch: Partial<DayItemDraft>) {
    setDays((current) =>
      current.map((day, i) =>
        i === dayIndex
          ? {
              ...day,
              items: day.items.map((item, j) => (j === itemIndex ? { ...item, ...patch } : item)),
            }
          : day
      )
    );
  }

  function addDay() {
    setDays((current) => [...current, newDay(current.length)]);
  }

  function removeDay(index: number) {
    setDays((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  }

  function addItem(dayIndex: number) {
    setDays((current) =>
      current.map((day, i) => (i === dayIndex ? { ...day, items: [...day.items, newItem()] } : day))
    );
  }

  function removeItem(dayIndex: number, itemIndex: number) {
    setDays((current) =>
      current.map((day, i) =>
        i === dayIndex
          ? { ...day, items: day.items.length <= 1 ? day.items : day.items.filter((_, j) => j !== itemIndex) }
          : day
      )
    );
  }

  async function saveCamp() {
    if (busy) return;
    if (!title.trim()) {
      setError(pickLocaleText(locale, "Nom du stage requis.", "Camp title is required."));
      return;
    }
    for (let i = 0; i < days.length; i += 1) {
      const day = days[i];
      if (!day.starts_at || !day.ends_at) {
        setError(pickLocaleText(locale, `Jour ${i + 1}: début et fin requis.`, `Day ${i + 1}: start and end are required.`));
        return;
      }
      if (new Date(day.ends_at).getTime() <= new Date(day.starts_at).getTime()) {
        setError(pickLocaleText(locale, `Jour ${i + 1}: la fin doit être après le début.`, `Day ${i + 1}: end must be after start.`));
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const ctx = await resolveEffectivePlayerContext();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");

      const endpoint = isEditing
        ? `/api/player/personal-camps/${encodeURIComponent(requestedCampId)}`
        : "/api/player/personal-camps";
      const res = await fetch(endpoint, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          child_id: ctx.role === "parent" ? ctx.effectiveUserId : null,
          title: title.trim(),
          coach_name: coachName.trim() || null,
          notes: notes.trim() || null,
          days: days.map((day) => ({
            session_id: day.session_id ?? null,
            starts_at: new Date(day.starts_at).toISOString(),
            ends_at: new Date(day.ends_at).toISOString(),
            location_text: day.location_text.trim() || null,
            items: day.items
              .map((item) => ({
                category: item.category,
                minutes: Number(item.minutes),
                note: item.note.trim() || null,
              }))
              .filter((item) => item.category && Number.isFinite(item.minutes) && item.minutes > 0),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? (isEditing ? "Unable to update camp" : "Unable to create camp")));

      invalidateClientPageCacheByPrefix("page-cache:player-home:");
      invalidateClientPageCacheByPrefix("page-cache:player-trainings:");
      router.push("/player/golf/trainings?type=camp");
    } catch (e: any) {
      setError(e?.message ?? pickLocaleText(locale, isEditing ? "Mise à jour impossible." : "Création impossible.", isEditing ? "Update failed." : "Creation failed."));
      setBusy(false);
      return;
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {loading ? (
          <div className="glass-section">
            <div className="glass-card" style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
              {pickLocaleText(locale, "Chargement...", "Loading...")}
            </div>
          </div>
        ) : (
          <>
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {pickLocaleText(locale, isEditing ? "Éditer le stage" : "Nouveau stage", isEditing ? "Edit camp" : "New camp")}
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings?type=camp">
                {t("common.back")}
              </Link>
            </div>
          </div>

          {error ? <div className="marketplace-error">{error}</div> : null}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>{pickLocaleText(locale, "Nom du stage", "Camp title")}</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={pickLocaleText(locale, "Stage d'été", "Summer camp")} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>{pickLocaleText(locale, "Coach (facultatif)", "Coach (optional)")}</span>
              <input className="input" value={coachName} onChange={(e) => setCoachName(e.target.value)} placeholder={pickLocaleText(locale, "Nom du coach", "Coach name")} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>{pickLocaleText(locale, "Informations", "Information")}</span>
              <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={pickLocaleText(locale, "Infos générales du stage", "General camp information")} />
            </label>
          </div>
        </div>

        <div className="glass-section">
          <div style={{ display: "grid", gap: 12 }}>
            {days.map((day, dayIndex) => (
              <div key={`day-${dayIndex}`} className="glass-card" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 950 }}>{pickLocaleText(locale, "Jour", "Day")} {dayIndex + 1}</div>
                  {days.length > 1 ? (
                    <button type="button" className="btn" onClick={() => removeDay(dayIndex)} disabled={busy}>
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>

                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 800 }}>{pickLocaleText(locale, "Début", "Start")}</span>
                    <input className="input" type="datetime-local" value={day.starts_at} onChange={(e) => updateDay(dayIndex, { starts_at: e.target.value })} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 800 }}>{pickLocaleText(locale, "Fin", "End")}</span>
                    <input className="input" type="datetime-local" value={day.ends_at} onChange={(e) => updateDay(dayIndex, { ends_at: e.target.value })} />
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>{t("common.place")}</span>
                  <input className="input" value={day.location_text} onChange={(e) => updateDay(dayIndex, { location_text: e.target.value })} placeholder={pickLocaleText(locale, "Lieu du jour", "Day location")} />
                </label>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{pickLocaleText(locale, "Structure du jour", "Day structure")}</div>
                  {day.items.map((item, itemIndex) => (
                    <div key={`day-${dayIndex}-item-${itemIndex}`} style={{ display: "grid", gap: 8, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.65)" }}>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0,1fr) 110px auto" }}>
                        <select className="input" value={item.category} onChange={(e) => updateDayItem(dayIndex, itemIndex, { category: e.target.value })}>
                          <option value="">{pickLocaleText(locale, "Choisir un secteur", "Choose a category")}</option>
                          {categories.map((category) => (
                            <option key={category.value} value={category.value}>{category.label}</option>
                          ))}
                        </select>
                        <select
                          className="input"
                          value={item.minutes}
                          onChange={(e) => updateDayItem(dayIndex, itemIndex, { minutes: e.target.value })}
                        >
                          <option value="">{pickLocaleText(locale, "Minutes", "Minutes")}</option>
                          {MINUTE_OPTIONS.map((minutes) => (
                            <option key={minutes} value={String(minutes)}>
                              {minutes} min
                            </option>
                          ))}
                        </select>
                        {day.items.length > 1 ? (
                          <button type="button" className="btn" onClick={() => removeItem(dayIndex, itemIndex)} disabled={busy}>
                            <Trash2 size={15} />
                          </button>
                        ) : <div />}
                      </div>
                      <textarea className="input" rows={2} value={item.note} onChange={(e) => updateDayItem(dayIndex, itemIndex, { note: e.target.value })} placeholder={pickLocaleText(locale, "Note (facultative)", "Note (optional)")} />
                    </div>
                  ))}

                  <button type="button" className="btn" onClick={() => addItem(dayIndex)} disabled={busy}>
                    <PlusCircle size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    {pickLocaleText(locale, "Ajouter un poste", "Add item")}
                  </button>
                </div>
              </div>
            ))}

            <button type="button" className="btn" onClick={addDay} disabled={busy}>
              <PlusCircle size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
              {pickLocaleText(locale, "Ajouter un jour", "Add day")}
            </button>
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Link className="btn" href="/player/golf/trainings?type=camp">
              {t("common.cancel")}
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => void saveCamp()} disabled={busy || loading}>
              {busy
                ? pickLocaleText(locale, isEditing ? "Enregistrement..." : "Création...", isEditing ? "Saving..." : "Creating...")
                : pickLocaleText(locale, isEditing ? "Enregistrer le stage" : "Créer le stage", isEditing ? "Save camp" : "Create camp")}
            </button>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
