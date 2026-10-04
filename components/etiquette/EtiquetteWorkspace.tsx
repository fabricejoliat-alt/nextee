"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChevronRight, Lightbulb, RefreshCw, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { etiquetteText } from "@/lib/etiquetteLabels";
import player from "@/components/rules/PlayerRulesWorkspace.module.css";
import coach from "@/components/rules/CoachRulesWorkspace.module.css";
import manager from "@/components/rules/RulesWorkspace.module.css";

type Scope = "player" | "coach" | "manager";
type Theme = { id: string; stable_key: string; position: number; title_i18n: Record<string, string> };
type Version = { id: string; locale: string; title: string; situation: string; simple_explanation: string; action_text: string;
  common_mistake: string; mission_text: string; coach_tip: string; official_reference: string; image_url: string | null; image_alt: string };
type Card = { id: string; stable_key: string; position: number; version: Version };
type Overview = { themes: Theme[]; selectedTheme: Theme | null; cards: Card[] };

export default function EtiquetteWorkspace({ scope }: { scope: Scope }) {
  const search = useSearchParams();
  const themeKey = search.get("theme") ?? "";
  const { locale } = useI18n();
  const l = etiquetteText(locale);
  const s = scope === "player" ? player : scope === "coach" ? coach : manager;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const listPosition = useRef({ windowY: 0, scrollAreaY: 0 });
  const load = useCallback(async () => {
    const id = ++request.current;
    setError("");
    try {
      const auth = await supabase.auth.getSession();
      const token = auth.data.session?.access_token;
      if (!token) throw new Error("Missing session");
      const query = new URLSearchParams({ scope });
      if (themeKey) query.set("theme", themeKey);
      query.set("locale", locale);
      const response = await fetch(`/api/etiquette/overview?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !Array.isArray(json.themes) || !Array.isArray(json.cards)) throw new Error("Invalid overview");
      if (id === request.current) setOverview(json);
    } catch {
      if (id === request.current) setError(etiquetteText(locale).error);
    }
  }, [locale, scope, themeKey]);
  useEffect(() => { const requests = request; void load(); return () => { requests.current++; }; }, [load]);
  const open = (card: Card) => {
    const area = document.querySelector<HTMLElement>(".player-scroll-area");
    listPosition.current = { windowY: window.scrollY, scrollAreaY: area?.scrollTop ?? 0 };
    setSelected(card);
  };
  const close = () => {
    setSelected(null);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      window.scrollTo({ top: listPosition.current.windowY, behavior: "auto" });
      const area = document.querySelector<HTMLElement>(".player-scroll-area");
      if (area) area.scrollTop = listPosition.current.scrollAreaY;
    }));
  };
  useEffect(() => {
    if (!selected || scope !== "player") return;
    const area = document.querySelector<HTMLElement>(".player-scroll-area");
    if (!area) return;
    const overflow = area.style.overflow;
    const overscroll = area.style.overscrollBehavior;
    area.style.overflow = "hidden";
    area.style.overscrollBehavior = "none";
    return () => { area.style.overflow = overflow; area.style.overscrollBehavior = overscroll; };
  }, [scope, selected]);
  const theme = overview?.selectedTheme;
  const themeTitle = theme?.title_i18n[locale] ?? theme?.title_i18n.fr ?? "";
  const base = `/${scope}/etiquette`;
  const summary = overview?.themes.length === 12 ? l.summary
    : `${overview?.themes.length ?? 0}/12 · ${(overview?.themes.length ?? 0) * 3}/36`;
  const frenchFallback = locale !== "fr" && overview?.cards.some((card) => card.version.locale === "fr");

  if (scope === "manager") return <main className={manager.page} aria-busy={!overview && !error}>
    <header className={manager.hero}><div><span><BookOpen size={16}/>{l.path}</span><h1>{l.title}</h1><p>{l.intro}</p></div></header>
    {error ? <section className={manager.state}><p role="alert">{error}</p><button onClick={() => void load()}><RefreshCw size={16}/>{l.retry}</button></section>
      : !overview ? <div className={manager.skeleton}><i/><i/><i/></div>
      : !theme ? <section className={manager.state}><BookOpen/><p>{l.unavailable}</p></section>
      : <><section><div className={manager.sectionTitle}><div><span>{l.theme} {String(theme.position).padStart(2, "0")}</span><h2>{themeTitle}</h2><p>{summary}</p>{frenchFallback && <p lang={locale}>{l.fallback}</p>}</div></div><div className={manager.grid}>{overview.cards.map((card) => <button type="button" className={manager.card} key={card.id} onClick={() => open(card)}><span className={manager.cardNumber}>{card.position}</span><div><small>{l.card} {card.position}</small><h3 lang={card.version.locale}>{card.version.title}</h3><p lang={card.version.locale}>{card.version.situation}</p><em>{card.version.official_reference}</em></div><ChevronRight size={18}/></button>)}</div></section>
      <section><div className={manager.sectionTitle}><div><span>{l.path}</span><h2>{l.themes}</h2></div></div><div className={manager.timeline}>{overview.themes.map((item) => <Link key={item.id} href={`${base}?theme=${item.stable_key}`}><b>{String(item.position).padStart(2, "0")}</b><div><strong>{item.title_i18n[locale] ?? item.title_i18n.fr}</strong></div></Link>)}</div></section></>}
    {selected && <AccessibleDialog className={manager.modal} labelledBy="etiquette-card-title" onClose={close}><button className={manager.close} onClick={close} aria-label={l.back}><X size={20}/></button><div className={coach.dialogBody}><CardReading card={selected} labels={l} s={coach} coachTip /></div></AccessibleDialog>}
  </main>;

  return <main className={s.page} aria-busy={!overview && !error}>
    {scope === "player" ? <><PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: l.title }]} />
      <header className={player.topline}><div><h1>{l.title}</h1><p className={player.lead}>{l.intro}</p></div></header></>
      : <><nav data-ui="breadcrumb" className={coach.breadcrumb} aria-label="Breadcrumb"><Link href="/coach">Coach</Link><ChevronRight size={14}/><span>{l.title}</span></nav>
      <header className={coach.topline}><div><h1>{l.title}</h1><p>{l.intro}</p></div><span className={coach.summary}><BookOpen size={18}/><span><b>{overview?.themes.length ?? "—"}</b> / 12</span></span></header></>}
    {error ? <section className={s.empty} role="alert"><BookOpen size={25}/><strong>{error}</strong><button onClick={() => void load()}><RefreshCw size={15}/>{l.retry}</button></section>
      : !overview ? <section className={s.cardsSection} aria-label={l.loading}><div className={s.sectionHeading}><h2>{l.explore}</h2></div><div className={s.cardGrid} aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <div className={s.loadingCard} key={index}><span className={s.loadingIcon}/><span className={s.loadingTitle}/><span className={s.loadingBadge}/><span className={s.loadingCardTitle}/><span className={s.loadingCopy}/></div>)}</div></section>
      : !theme ? <section className={s.empty}><BookOpen size={25}/><strong>{l.unavailable}</strong></section>
      : <><section className={s.feature} aria-labelledby="etiquette-theme-title"><div className={s.featureCopy}>
        <span className={s.featureKicker}><Sparkles size={15}/>{l.theme} {String(theme.position).padStart(2, "0")}</span>
        <h2 id="etiquette-theme-title">{themeTitle}</h2><p>{l.intro}</p>
        <div className={s.featureBottom}><span className={s.phase}><BookOpen size={15}/>{summary}</span></div>
      </div><div className={s.featureArt} aria-hidden="true"><div className={s.artOrbit}><BookOpen size={62} strokeWidth={1.25}/></div><span className={s.artChipOne}>01</span><span className={s.artChipTwo}>03</span></div></section>
      <section className={s.cardsSection} aria-labelledby="etiquette-cards-title"><div className={s.sectionHeading}><h2 id="etiquette-cards-title">{l.explore}</h2><p>{frenchFallback ? l.fallback : l.cards}</p></div><div className={s.cardGrid}>{overview.cards.map((card) => <button type="button" className={s.card} key={card.id} onClick={() => open(card)}>
        <span className={s.cardLabel}><span className={s.cardIcon}><BookOpen size={25} strokeWidth={1.6}/></span><span className={s.cardNumber}>{l.card} {card.position}</span></span>
        <span className={s.cardContent}><small>{card.version.official_reference}</small><strong lang={card.version.locale}>{card.version.title}</strong><span lang={card.version.locale}>{card.version.situation}</span></span>
        <span className={s.cardAction}>{l.read}<ArrowRight size={15}/></span></button>)}</div></section>
      <section className={s.calendarSection} aria-labelledby="etiquette-themes-title"><div className={s.sectionHeading}><h2 id="etiquette-themes-title">{l.path}</h2><p>{l.themes}</p></div><div className={s.calendarGrid}>{overview.themes.map((item) => <Link key={item.id} href={`${base}?theme=${item.stable_key}`} className={`${s.calendarItem} ${item.id === theme.id ? s.calendarCurrent : ""}`}>
        <span className={s.calendarNumber}>{String(item.position).padStart(2, "0")}</span><span className={s.calendarText}><small>{l.theme}</small><strong>{item.title_i18n[locale] ?? item.title_i18n.fr}</strong></span>{item.id === theme.id && <span className={s.calendarNow}>{l.selected}</span>}
      </Link>)}</div></section></>}
    {selected && <AccessibleDialog className={s.dialog} labelledBy="etiquette-card-title" onClose={close}>
      {scope === "player" && <button type="button" className={player.mobileBack} onClick={close}>{l.back}</button>}
      <button type="button" className={s.close} onClick={close} aria-label={l.back}><X size={20}/></button>
      {selected.version.image_url && <div className={s.dialogImage}><Image src={selected.version.image_url} alt={selected.version.image_alt || selected.version.title} fill sizes="(max-width: 640px) 100vw, 640px" unoptimized/></div>}
      <div className={s.dialogBody}><CardReading card={selected} labels={l} s={s} coachTip={scope === "coach"}/><button type="button" className={s.done} onClick={close}>{l.back}<ArrowRight size={16}/></button></div>
    </AccessibleDialog>}
  </main>;
}

function CardReading({ card, labels: l, s, coachTip }: { card: Card; labels: ReturnType<typeof etiquetteText>; s: typeof player | typeof coach; coachTip: boolean }) {
  const { locale } = useI18n();
  const v = card.version;
  return <><span className={s.dialogKicker}>{l.card} {card.position} · {v.official_reference}</span>
    <h2 id="etiquette-card-title" lang={v.locale}>{v.title}</h2>{locale !== "fr" && v.locale === "fr" && <p lang={locale}>{l.fallback}</p>}
    <div className={s.dialogSection}><small>{l.situation}</small><p lang={v.locale}>{v.situation}</p></div>
    <div className={s.dialogSection}><small>{l.understand}</small><p lang={v.locale}>{v.simple_explanation}</p></div>
    <div className={s.takeaway}><Lightbulb size={20}/><div><strong>{l.action}</strong><p lang={v.locale}>{v.action_text}</p></div></div>
    <div className={s.dialogSection}><small>{l.avoid}</small><p lang={v.locale}>{v.common_mistake}</p></div>
    <div className={s.dialogSection}><small>{l.mission}</small><p lang={v.locale}>{v.mission_text}</p></div>
    {coachTip && <div className={s.dialogSection}><small>{l.tip}</small><p lang={v.locale}>{v.coach_tip}</p></div>}</>;
}
