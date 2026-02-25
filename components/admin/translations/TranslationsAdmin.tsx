"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { messages, type AppLocale } from "@/lib/i18n/messages";

type Row = {
  locale: AppLocale;
  key: string;
  value: string;
};

export default function TranslationsAdmin() {
  const [locale, setLocale] = useState<AppLocale>("fr");
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
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

    const res = await fetch(`/api/admin/translations?locale=${locale}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Erreur chargement traductions.");
      setLoading(false);
      return;
    }

    const list = (json.rows ?? []) as Row[];
    const map: Record<string, string> = {};
    for (const r of list) map[r.key] = r.value;
    setRows(list);
    setDraft(map);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [locale]);

  const base = messages[locale] ?? {};
  const overrideMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }, [rows]);

  const allKeys = useMemo(() => {
    const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(overrideMap)]));
    keys.sort((a, b) => a.localeCompare(b));
    const q = query.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => k.toLowerCase().includes(q));
  }, [base, overrideMap, query]);

  async function saveKey(key: string) {
    setSavingKey(key);
    setError(null);
    setInfo(null);

    const token = await getToken();
    if (!token) {
      setError("Pas de session.");
      setSavingKey(null);
      return;
    }

    const value = draft[key] ?? "";
    const res = await fetch("/api/admin/translations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ locale, key, value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Erreur sauvegarde.");
      setSavingKey(null);
      return;
    }

    setInfo(`Clé enregistrée: ${key}`);
    setSavingKey(null);
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Traductions</h1>
      </div>

      {error && (
        <div style={{ border: "1px solid #ffcccc", background: "#fff5f5", padding: 12, borderRadius: 12, color: "#a00" }}>
          {error}
        </div>
      )}

      {info && (
        <div style={{ border: "1px solid var(--border)", background: "#f8fbf8", padding: 12, borderRadius: 12 }}>
          {info}
        </div>
      )}

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ marginTop: 0 }}>Éditeur</h2>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "140px 1fr" }}>
          <select value={locale} onChange={(e) => setLocale(e.target.value as AppLocale)} style={inputStyle}>
            <option value="fr">fr</option>
            <option value="en">en</option>
          </select>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une clé…"
            style={inputStyle}
          />
        </div>

        {loading ? (
          <div>Chargement…</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {allKeys.map((key) => {
              const baseValue = base[key] ?? "";
              const current = draft[key] ?? overrideMap[key] ?? "";
              const isOverride = key in overrideMap;
              return (
                <div key={key} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{key}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Base: {baseValue || "—"} {isOverride ? "• override actif" : ""}
                  </div>
                  <textarea
                    value={current}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => saveKey(key)} disabled={savingKey === key}>
                      {savingKey === key ? "Sauvegarde…" : "Sauvegarder"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setDraft((d) => ({ ...d, [key]: "" }));
                        saveKey(key);
                      }}
                      disabled={savingKey === key}
                    >
                      Réinitialiser
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};

