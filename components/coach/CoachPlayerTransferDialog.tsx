"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachText } from "@/lib/i18n/coachMessages";
import { coachCaughtErrorKey, coachUiErrorKey } from "@/lib/coachUiErrors";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import CoachListSkeleton from "./CoachListSkeleton";
import styles from "./CoachPlayerTransferDialog.module.css";

type Group = { id: string; name: string };

async function headers() {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("coach.error.session");
  return { Authorization: `Bearer ${token}` };
}

export default function CoachPlayerTransferDialog({ playerId, playerName, sourceGroupId, onTransferred }: {
  playerId: string; playerName: string; sourceGroupId: string; onTransferred: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [futureCount, setFutureCount] = useState(0);
  const [action, setAction] = useState<"keep" | "remove_old" | "move">("keep");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setGroups([]);
    setDestinationId("");
    setSourceName("");
    setFutureCount(0);
    setAction("keep");
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/coach/players/${playerId}/transfer-group?sourceGroupId=${encodeURIComponent(sourceGroupId)}`, {
          headers: await headers(), cache: "no-store", signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(coachUiErrorKey(response.status, json, "coach.error.load"));
        if (!active) return;
        setGroups(json.destinationGroups ?? []);
        setSourceName(json.sourceGroup?.name ?? "");
        setFutureCount(json.futureSourceEventsCount ?? 0);
        setDestinationId(json.destinationGroups?.[0]?.id ?? "");
      } catch (cause) {
        if (active) setError(coachCaughtErrorKey(cause, "coach.error.load"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [open, playerId, sourceGroupId, reload]);

  function close() {
    if (!saveInFlight.current) setOpen(false);
  }

  async function confirm() {
    if (!destinationId || loading || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/coach/players/${playerId}/transfer-group`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ sourceGroupId, destinationGroupId: destinationId, futureEventsAction: action }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(coachUiErrorKey(response.status, json, "coach.error.transfer"));
      setOpen(false);
      onTransferred();
    } catch (cause) {
      setError(coachCaughtErrorKey(cause, "coach.error.transfer"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return <>
    <button type="button" className={styles.trigger} onClick={(event) => { event.stopPropagation(); setLoading(true); setOpen(true); }} title={t("coach.transfer.title")} aria-label={coachText(t, "coach.transfer.named", { name: playerName })} aria-haspopup="dialog"><ArrowRightLeft size={17} aria-hidden="true"/></button>
    {open ? <AccessibleDialog className={styles.dialog} labelledBy={`transfer-${playerId}`} onClose={close}>
      <header><div><h2 id={`transfer-${playerId}`}>{t("coach.transfer.title")}</h2><p>{playerName} · {sourceName || t("coach.transfer.source")}</p></div><button type="button" onClick={close} disabled={saving} aria-label={t("common.close")}><X size={19} aria-hidden="true"/></button></header>
      {loading ? <div className={styles.body}><CoachListSkeleton label={t("coach.groups.loading")}/></div> :
        <fieldset className={styles.body} disabled={saving} aria-busy={saving}>
          {error ? <div className={styles.error} role="alert">{t(error)}{groups.length === 0 ? <button type="button" className={styles.cancel} onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button> : null}</div> : null}
          {!error && groups.length === 0 ? <p role="status">{t("coach.transfer.noDestinations")}</p> : null}
          <label><span>{t("coach.transfer.destination")}</span><select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}><option value="">{t("coach.transfer.choose")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <p className={styles.explanation}>{t("coach.transfer.explanation")}</p>
          <fieldset><legend>{coachText(t, "coach.transfer.future", { count: futureCount })}</legend>
            {(["keep", "remove_old", "move"] as const).map((value) => {
              const key = value === "remove_old" ? "remove" : value;
              const optionId = `transfer-${playerId}-${value}`;
              return <label key={value}><input type="radio" name={`future-${playerId}`} value={value} checked={action === value}
                aria-labelledby={`${optionId}-label`} aria-describedby={`${optionId}-hint`} onChange={() => setAction(value)}/>
                <span><b id={`${optionId}-label`}>{t(`coach.transfer.${key}`)}</b><small id={`${optionId}-hint`}>{t(`coach.transfer.${key}Hint`)}</small></span></label>;
            })}
          </fieldset>
          <p className={styles.note}>{t("coach.transfer.unchanged")}</p>
        </fieldset>}
      <footer><button type="button" className={styles.cancel} onClick={close} disabled={saving}>{t("coach.directory.cancel")}</button><button type="button" className={styles.confirm} onClick={() => void confirm()} disabled={loading || saving || !destinationId}>{saving ? t("coach.transfer.saving") : t("coach.transfer.confirm")}</button></footer>
    </AccessibleDialog> : null}
  </>;
}
