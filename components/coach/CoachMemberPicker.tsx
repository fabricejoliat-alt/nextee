"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PlusCircle, Search, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachText } from "@/lib/i18n/coachMessages";
import styles from "./CoachMemberPicker.module.css";

type Member = { id: string; first_name: string | null; last_name: string | null };
const name = (member: Member) => `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || "—";

/** Search field followed by ordinary buttons: Tab/Shift+Tab work without a custom listbox. */
export default function CoachMemberPicker({ label, placeholder, items, onSelect, disabled = false }: {
  label: string; placeholder: string; items: Member[];
  onSelect: (member: Member) => Promise<boolean>; disabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selecting = useRef(false);
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const filtered = useMemo(() => {
    const search = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale);
    return items.filter((member) => name(member).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale).includes(search))
      .sort((a, b) => name(a).localeCompare(name(b), locale)).slice(0, 20);
  }, [items, query, locale]);
  useEffect(() => {
    if (restoreFocus.current && !disabled && !pending) {
      input.current?.focus();
      restoreFocus.current = false;
    }
  }, [disabled, pending]);

  async function select(member: Member) {
    if (disabled || selecting.current) return;
    selecting.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (await onSelect(member)) { setQuery(""); setOpen(false); }
      // A failed request keeps the query and results. The parent presents the error.
    } catch {
      setFailed(true);
    } finally {
      selecting.current = false;
      restoreFocus.current = true;
      setPending(false);
    }
  }

  return <div className={styles.picker} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !selecting.current) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false);
      restoreFocus.current = true; input.current?.focus(); restoreFocus.current = false;
    }
  }}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.search}>
      <Search size={18} aria-hidden="true"/>
      <input id={id} ref={input} type="search" autoComplete="off" value={query} placeholder={placeholder}
        aria-controls={open ? `${id}-results` : undefined} aria-describedby={open ? `${id}-count` : undefined}
        disabled={disabled || pending} onFocus={() => { if (!restoreFocus.current) setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}/>
      {query ? <button type="button" aria-label={t("coach.picker.clear")} title={t("coach.picker.clear")}
        disabled={disabled || pending} onClick={() => { setQuery(""); setOpen(true); input.current?.focus(); }}><X size={18} aria-hidden="true"/></button> : null}
    </div>
    {failed ? <p role="alert">{t("coach.error.save")}</p> : null}
    {open ? <div id={`${id}-results`} className={styles.results} role="group" aria-label={label}>
      <p id={`${id}-count`} role="status">{filtered.length ? coachText(t, filtered.length === 1 ? "coach.picker.resultOne" : "coach.picker.results", { count: filtered.length }) : t("coach.picker.empty")}</p>
      {filtered.map((member) => <button key={member.id} type="button" disabled={disabled || pending}
        aria-label={coachText(t, "coach.picker.addNamed", { name: name(member) })} onClick={() => void select(member)}>
        <span>{name(member)}</span><PlusCircle size={18} aria-hidden="true"/>
      </button>)}
    </div> : null}
  </div>;
}
