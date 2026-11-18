"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, TriangleAlert } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import { buildLegalChecklist, type LegalChecklistItem } from "@/lib/legalChecklist";
import DeleteAccountLink from "./DeleteAccountLink";
import styles from "./ProfileLegalDocuments.module.css";

const labels: Record<string, string> = { accepted: "Accepté", acknowledged: "Lu et confirmé", authorized: "Autorisé", consented: "Consentement donné", refused: "Refusé", withdrawn: "Retiré" };

export default function ProfileLegalDocuments() {
  const { locale } = useI18n();
  const [items, setItems] = useState<LegalChecklistItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Session indisponible");
    const results = await Promise.all(["documents", "children"].map(async path => {
      const response = await fetch(`/api/legal/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Documents indisponibles");
      return response.json();
    }));
    return buildLegalChecklist(results[0].documents, results[1].children, locale);
  }, [locale]);
  useEffect(() => {
    let active = true;
    load().then(rows => { if (active) { setItems(rows); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [load, attempt]);

  return <div className={styles.content}>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Leave the retained Player shell for legal documents. */}
    <h4 className={styles.heading}><a href="/legal/my">Documents et consentements</a></h4>
    {state === "loading" ? <p role="status">Chargement des documents…</p>
      : state === "error" ? <p role="status">Impossible de charger les documents. <button type="button" onClick={() => { setState("loading"); setAttempt(value => value + 1); }}>Réessayer</button></p>
      : !items.length ? <p>Aucun document à renseigner.</p>
      : <ul className={styles.list}>{items.map(item => {
        const query = new URLSearchParams({ document: item.doc?.id ?? "" });
        if (item.child) query.set("beneficiary", item.child.child_id);
        return <li key={item.key} className={!item.complete ? styles.pending : undefined}>
          <a href={`/legal/my?${query}`} className={styles.document}>
            <span className={styles.details}><small>{item.organizationName}{item.child ? ` · Pour ${item.child.child_name ?? "mon enfant"}` : " · Pour vous"}</small>
              <strong>{item.title}</strong><span className={item.complete ? styles.complete : styles.waiting}>
                {item.complete ? <Check size={15} aria-hidden="true" /> : <TriangleAlert size={17} aria-hidden="true" />}
                {item.complete ? labels[item.decision ?? ""] ?? "Réponse enregistrée" : "À répondre"}
              </span></span><ArrowRight size={18} aria-hidden="true" />
          </a>
        </li>;
      })}</ul>}
    <nav className={styles.links} aria-label="Données personnelles">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Leave the retained Player shell. */}
      <a href="/legal/request">Mes données</a>
      <DeleteAccountLink variant="text" />
    </nav>
  </div>;
}
