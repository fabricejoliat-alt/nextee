"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Medal } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { playerMeritRead } from "@/lib/playerMeritRead";
import { playerMeritPreview, type MeritPreviewRow } from "@/lib/playerMeritPreview";
import { supabase } from "@/lib/supabaseClient";
import ui from "./PlayerUI.module.css";
import merit from "@/app/player/om/PlayerOrderOfMerit.module.css";
import home from "@/app/player/PlayerDashboard.module.css";

type RankingRow = MeritPreviewRow & {
  tournament_points_net: number | string;
  bonus_points_net: number | string;
  total_points_net: number | string;
  tournament_points_brut: number | string;
  bonus_points_brut: number | string;
  total_points_brut: number | string;
};
const points = (value: number | string) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00";
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? `${parts[0][0]}${parts.length > 1 ? parts.at(-1)![0] : ""}`.toUpperCase() : "?";
};

export default function PlayerHomeMerit({ context }: { context: {
  userId: string; organizationIds: string[]; performanceEnabled: boolean;
} | null }) {
  const { locale } = useI18n();
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const [mode, setMode] = useState<"net" | "brut">("net");
  const [organizations, setOrganizations] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ key: string; rows: RankingRow[]; avatars: Record<string, string | null>; error: boolean } | null>(null);
  const organizationId = context?.organizationIds.includes(selectedOrganization) ? selectedOrganization : context?.organizationIds[0] ?? "";
  const organizationKey = JSON.stringify(context?.organizationIds ?? []);
  const requestKey = `${context?.userId ?? ""}:${organizationId}`;
  const enabled = context?.performanceEnabled === true;

  useEffect(() => {
    let active = true;
    const ids = JSON.parse(organizationKey) as string[];
    if (ids.length > 1) void supabase.from("organizations").select("id,name").in("id", ids).then(({ data }) => {
      if (active) setOrganizations(Object.fromEntries((data ?? []).map(row => [row.id, row.name ?? row.id])));
    });
    return () => { active = false; };
  }, [organizationKey]);

  useEffect(() => {
    if (!enabled || !organizationId) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
        const rows = await playerMeritRead<RankingRow>(organizationId, `${today.slice(0, 4)}-01-01`, today, controller.signal);
        const avatarResult = rows.length ? await supabase.from("profiles").select("id,avatar_url").in("id", rows.map(row => row.player_id)) : null;
        if (!controller.signal.aborted) setResult({ key: requestKey, rows, avatars: Object.fromEntries((avatarResult?.data ?? []).map(row => [row.id, row.avatar_url])), error: false });
      } catch {
        if (!controller.signal.aborted) setResult({ key: requestKey, rows: [], avatars: {}, error: true });
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, organizationId, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const preview = useMemo(() => playerMeritPreview(current?.rows ?? [], context?.userId ?? "", mode), [current, context?.userId, mode]);
  const loading = !context || (enabled && !!organizationId && !current);
  const hasPlayer = current?.rows.some(row => row.player_id === context?.userId);

  return <article className={`${ui.panel} ${home.meritCard}`}>
    <div className={ui.panelHeader}>
      <h2>{pickLocaleText(locale, "Ordre du mérite", "Order of merit", "Order of Merit", "Ordine di merito")}</h2>
      <Link className={home.benchmarkLink} href="/player/om" aria-label={pickLocaleText(locale, "Voir l’ordre du mérite", "View order of merit", "Rangliste ansehen", "Vedi l’ordine di merito")}><ArrowRight size={15} /></Link>
    </div>
    <div className={home.meritControls}>
      {context && context.organizationIds.length > 1 ? <label className={merit.field}>
        <span>{pickLocaleText(locale, "Organisation", "Organization", "Organisation", "Organizzazione")}</span>
        <select value={organizationId} onChange={event => setSelectedOrganization(event.target.value)}>
          {context.organizationIds.map(id => <option key={id} value={id}>{organizations[id] ?? id}</option>)}
        </select>
      </label> : null}
      <div className={merit.segmented} aria-label={pickLocaleText(locale, "Classement", "Ranking", "Rangliste", "Classifica")}>
        {(["brut", "net"] as const).map(value => <button key={value} type="button" className={mode === value ? merit.segmentActive : ""} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "brut" ? pickLocaleText(locale, "Brut", "Gross", "Brutto", "Lordo") : pickLocaleText(locale, "Net", "Net", "Netto", "Netto")}</button>)}
      </div>
    </div>
    {loading ? <div className={ui.skeleton}><span /><span /><span /><span /></div>
      : !enabled ? <p className={merit.empty}>{pickLocaleText(locale, "Active le mode performance pour participer à l’ordre du mérite.", "Enable performance mode to join the order of merit.", "Aktiviere den Performance-Modus, um teilzunehmen.", "Attiva la modalità performance per partecipare.")}</p>
      : current?.error ? <p role="alert" className={merit.empty}>{pickLocaleText(locale, "Classement indisponible pour le moment.", "Ranking temporarily unavailable.", "Rangliste derzeit nicht verfügbar.", "Classifica temporaneamente non disponibile.")}</p>
      : !preview.length ? <p className={merit.empty}>{pickLocaleText(locale, "Aucun score OM.", "No OM scores.", "Keine OM-Scores.", "Nessun punteggio OM.")}</p>
      : <>
        {!hasPlayer ? <p className={home.chartNote}>{pickLocaleText(locale, "Tu n’es pas encore classé.", "You are not ranked yet.", "Du bist noch nicht klassiert.", "Non sei ancora in classifica.")}</p> : null}
        <div className={merit.rankingList}>
          {preview.map(row => {
            const rank = row[`rank_${mode}`];
            return <div key={row.player_id} className={`${merit.rankingRow} ${row.player_id === context?.userId ? merit.rankingRowMe : ""}`} aria-current={row.player_id === context?.userId ? "true" : undefined}>
              <span className={`${merit.rank} ${rank <= 3 ? merit.podiumRank : ""}`}>{rank <= 3 ? <Medal size={15} aria-hidden="true" /> : null}#{rank}</span>
              <div className={merit.avatar}>{current?.avatars[row.player_id] ? <Image src={current.avatars[row.player_id]!} alt="" fill sizes="38px" unoptimized /> : <span>{initials(row.full_name)}</span>}</div>
              <div className={merit.player}><strong>{row.full_name}</strong><small>{pickLocaleText(locale, "Tournois", "Tournaments", "Turniere", "Tornei")} {points(row[`tournament_points_${mode}`])} · Bonus {points(row[`bonus_points_${mode}`])}</small></div>
              <div className={merit.total}><strong>{points(row[`total_points_${mode}`])}</strong><span>pts</span></div>
            </div>;
          })}
        </div>
      </>}
  </article>;
}
