"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { notificationTemplateDefaults } from "@/lib/notificationMessages";

type Locale = "fr" | "en";

type Row = {
  locale: Locale;
  key: string;
  value: string;
};

export default function NotificationTemplatesAdmin() {
  const [rowsFr, setRowsFr] = useState<Row[]>([]);
  const [rowsEn, setRowsEn] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const templates = useMemo(
    () =>
      Object.entries(notificationTemplateDefaults)
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    []
  );

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadLocale(locale: Locale, token: string) {
    const res = await fetch(`/api/admin/translations?locale=${locale}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Erreur chargement traductions.");
    return (json.rows ?? []) as Row[];
  }

  function buildDraft(frRows: Row[], enRows: Row[]) {
    const next: Record<string, string> = {};
    const mapFr: Record<string, string> = {};
    const mapEn: Record<string, string> = {};
    for (const r of frRows) mapFr[r.key] = r.value;
    for (const r of enRows) mapEn[r.key] = r.value;

    for (const tpl of templates) {
      next[`fr:${tpl.key}.title`] = mapFr[`${tpl.key}.title`] ?? tpl.fr.title;
      next[`fr:${tpl.key}.body`] = mapFr[`${tpl.key}.body`] ?? tpl.fr.body;
      next[`en:${tpl.key}.title`] = mapEn[`${tpl.key}.title`] ?? tpl.en.title;
      next[`en:${tpl.key}.body`] = mapEn[`${tpl.key}.body`] ?? tpl.en.body;
    }
    return next;
  }

  async function load() {
    setLoading(true);
    setError(null);
    setInfo(null);

    const token = await getToken();
    if (!token) {
      setError("Pas de session.");
      setLoading(false);
      return;
    }

    try {
      const [fr, en] = await Promise.all([loadLocale("fr", token), loadLocale("en", token)]);
      setRowsFr(fr);
      setRowsEn(en);
      setDraft(buildDraft(fr, en));
      setLoading(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur chargement.");
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveOne(locale: Locale, key: string, value: string, token: string) {
    const res = await fetch("/api/admin/translations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ locale, key, value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Erreur sauvegarde ${key}`);
  }

  async function saveTemplate(baseKey: string) {
    setSavingKey(baseKey);
    setError(null);
    setInfo(null);

    const token = await getToken();
    if (!token) {
      setError("Pas de session.");
      setSavingKey(null);
      return;
    }

    try {
      await Promise.all([
        saveOne("fr", `${baseKey}.title`, draft[`fr:${baseKey}.title`] ?? "", token),
        saveOne("fr", `${baseKey}.body`, draft[`fr:${baseKey}.body`] ?? "", token),
        saveOne("en", `${baseKey}.title`, draft[`en:${baseKey}.title`] ?? "", token),
        saveOne("en", `${baseKey}.body`, draft[`en:${baseKey}.body`] ?? "", token),
      ]);
      setInfo(`Template enregistré: ${baseKey}`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur sauvegarde.");
    }

    setSavingKey(null);
  }

  async function resetTemplate(baseKey: string) {
    setSavingKey(`${baseKey}:reset`);
    setError(null);
    setInfo(null);

    const token = await getToken();
    if (!token) {
      setError("Pas de session.");
      setSavingKey(null);
      return;
    }

    try {
      await Promise.all([
        saveOne("fr", `${baseKey}.title`, "", token),
        saveOne("fr", `${baseKey}.body`, "", token),
        saveOne("en", `${baseKey}.title`, "", token),
        saveOne("en", `${baseKey}.body`, "", token),
      ]);
      setInfo(`Template réinitialisé: ${baseKey}`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur réinitialisation.");
    }

    setSavingKey(null);
  }

  const rowsFrMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rowsFr) map[r.key] = r.value;
    return map;
  }, [rowsFr]);

  const rowsEnMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rowsEn) map[r.key] = r.value;
    return map;
  }, [rowsEn]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Notifications</h1>
        <p style={{ margin: "8px 0 0", color: "rgba(0,0,0,0.65)", fontWeight: 700 }}>
          Modèles de messages (FR/EN) utilisés pour le centre de notifications et le push PWA.
        </p>
      </div>

      {error ? <div style={{ border: "1px solid #ffcccc", background: "#fff5f5", padding: 12, borderRadius: 12, color: "#a00" }}>{error}</div> : null}
      {info ? <div style={{ border: "1px solid var(--border)", background: "#f8fbf8", padding: 12, borderRadius: 12 }}>{info}</div> : null}

      {loading ? (
        <div className="card">Chargement…</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {templates.map((tpl) => {
            const frTitleKey = `${tpl.key}.title`;
            const frBodyKey = `${tpl.key}.body`;
            const enTitleKey = `${tpl.key}.title`;
            const enBodyKey = `${tpl.key}.body`;

            const hasOverride =
              rowsFrMap[frTitleKey] !== undefined ||
              rowsFrMap[frBodyKey] !== undefined ||
              rowsEnMap[enTitleKey] !== undefined ||
              rowsEnMap[enBodyKey] !== undefined;

            return (
              <div key={tpl.key} className="card" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900, fontSize: 15 }}>{tpl.label}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{tpl.key}</div>
                  </div>
                  {hasOverride ? <span className="pill-soft">override actif</span> : null}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>Français</div>
                  <input
                    style={inputStyle}
                    value={draft[`fr:${tpl.key}.title`] ?? tpl.fr.title}
                    onChange={(e) => setDraft((d) => ({ ...d, [`fr:${tpl.key}.title`]: e.target.value }))}
                  />
                  <textarea
                    style={{ ...inputStyle, minHeight: 62, resize: "vertical" }}
                    value={draft[`fr:${tpl.key}.body`] ?? tpl.fr.body}
                    onChange={(e) => setDraft((d) => ({ ...d, [`fr:${tpl.key}.body`]: e.target.value }))}
                  />
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>English</div>
                  <input
                    style={inputStyle}
                    value={draft[`en:${tpl.key}.title`] ?? tpl.en.title}
                    onChange={(e) => setDraft((d) => ({ ...d, [`en:${tpl.key}.title`]: e.target.value }))}
                  />
                  <textarea
                    style={{ ...inputStyle, minHeight: 62, resize: "vertical" }}
                    value={draft[`en:${tpl.key}.body`] ?? tpl.en.body}
                    onChange={(e) => setDraft((d) => ({ ...d, [`en:${tpl.key}.body`]: e.target.value }))}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => saveTemplate(tpl.key)} disabled={savingKey === tpl.key || savingKey === `${tpl.key}:reset`}>
                    {savingKey === tpl.key ? "Sauvegarde…" : "Sauvegarder"}
                  </button>
                  <button className="btn" onClick={() => resetTemplate(tpl.key)} disabled={savingKey === tpl.key || savingKey === `${tpl.key}:reset`}>
                    {savingKey === `${tpl.key}:reset` ? "Réinitialisation…" : "Réinitialiser"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};
