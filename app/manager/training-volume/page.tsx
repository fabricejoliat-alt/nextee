"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type Club = { id: string; name: string };

type VolumeRow = {
  id?: string;
  ftem_code: string;
  level_label: string;
  handicap_label: string;
  handicap_min: string;
  handicap_max: string;
  motivation_text: string;
  minutes_offseason: string;
  minutes_inseason: string;
  sort_order: string;
};

const MONTHS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Fev" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Avr" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juin" },
  { value: 7, label: "Juil" },
  { value: 8, label: "Aout" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
] as const;

function toRow(input: any): VolumeRow {
  return {
    id: input?.id ? String(input.id) : undefined,
    ftem_code: String(input?.ftem_code ?? ""),
    level_label: String(input?.level_label ?? ""),
    handicap_label: String(input?.handicap_label ?? ""),
    handicap_min: input?.handicap_min == null ? "" : String(input.handicap_min),
    handicap_max: input?.handicap_max == null ? "" : String(input.handicap_max),
    motivation_text: String(input?.motivation_text ?? ""),
    minutes_offseason: input?.minutes_offseason == null ? "0" : String(input.minutes_offseason),
    minutes_inseason: input?.minutes_inseason == null ? "0" : String(input.minutes_inseason),
    sort_order: input?.sort_order == null ? "" : String(input.sort_order),
  };
}

export default function ManagerTrainingVolumePage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");

  const [rows, setRows] = useState<VolumeRow[]>([]);
  const [seasonMonths, setSeasonMonths] = useState<number[]>([]);
  const [offseasonMonths, setOffseasonMonths] = useState<number[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadClubs() {
    const headers = await authHeader();
    const res = await fetch("/api/manager/my-clubs", { method: "GET", headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "Erreur de chargement des clubs");
    return (Array.isArray(json?.clubs) ? json.clubs : [])
      .map((c: any) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "Club") }))
      .filter((c: Club) => Boolean(c.id));
  }

  async function loadVolume(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${selectedClubId}/training-volume`, { headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Erreur de chargement");

      setSeasonMonths(Array.isArray(json?.settings?.season_months) ? json.settings.season_months.map(Number) : []);
      setOffseasonMonths(Array.isArray(json?.settings?.offseason_months) ? json.settings.offseason_months.map(Number) : []);

      const list = Array.isArray(json?.rows) ? json.rows : [];
      setRows(list.map(toRow));
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement");
      setRows([]);
      setSeasonMonths([]);
      setOffseasonMonths([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const list = await loadClubs();
        setClubs(list);
        const first = list[0]?.id ?? "";
        setClubId(first);
        if (first) await loadVolume(first);
        else setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Erreur de chargement");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlapCount = useMemo(
    () => seasonMonths.filter((m) => offseasonMonths.includes(m)).length,
    [seasonMonths, offseasonMonths]
  );

  function toggleMonth(month: number, key: "season" | "offseason") {
    if (key === "season") {
      setSeasonMonths((prev) => (prev.includes(month) ? prev.filter((x) => x !== month) : [...prev, month]));
      return;
    }
    setOffseasonMonths((prev) => (prev.includes(month) ? prev.filter((x) => x !== month) : [...prev, month]));
  }

  function updateRow(index: number, patch: Partial<VolumeRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        ftem_code: "",
        level_label: "",
        handicap_label: "",
        handicap_min: "",
        handicap_max: "",
        motivation_text: "",
        minutes_offseason: "0",
        minutes_inseason: "0",
        sort_order: String((prev.length + 1) * 10),
      },
    ]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveAll() {
    if (!clubId) return;
    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      const headers = await authHeader();
      const payload = {
        season_months: seasonMonths,
        offseason_months: offseasonMonths,
        rows: rows.map((r) => ({
          ftem_code: r.ftem_code,
          level_label: r.level_label,
          handicap_label: r.handicap_label,
          handicap_min: r.handicap_min,
          handicap_max: r.handicap_max,
          motivation_text: r.motivation_text,
          minutes_offseason: r.minutes_offseason,
          minutes_inseason: r.minutes_inseason,
          sort_order: r.sort_order,
        })),
      };

      const res = await fetch(`/api/manager/clubs/${clubId}/training-volume`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Erreur de sauvegarde");

      setInfo("Volume d'entraînement sauvegardé.");
      await loadVolume(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, width: "min(1200px, 100%)", margin: "0 auto", boxSizing: "border-box" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Volume d'entraînement</h1>
        <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
          Paramètres FTEM, objectifs mensuels et mois en saison / hors saison.
        </div>
      </div>

      {error ? (
        <div style={{ border: "1px solid #ffcccc", background: "#fff5f5", color: "#a00", borderRadius: 12, padding: 12 }}>{error}</div>
      ) : null}
      {info ? (
        <div style={{ border: "1px solid #b8e9c8", background: "#f2fff6", color: "#15633a", borderRadius: 12, padding: 12 }}>{info}</div>
      ) : null}

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6, maxWidth: 420 }}>
          <span style={{ fontSize: 12, fontWeight: 900 }}>Organisation</span>
          <select
            value={clubId}
            onChange={async (e) => {
              const next = e.target.value;
              setClubId(next);
              await loadVolume(next);
            }}
          >
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Mois de référence</h2>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}>Mois en saison</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MONTHS.map((m) => (
              <label key={`season-${m.value}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", padding: "6px 10px", borderRadius: 999 }}>
                <input type="checkbox" checked={seasonMonths.includes(m.value)} onChange={() => toggleMonth(m.value, "season")} />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}>Mois hors saison</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MONTHS.map((m) => (
              <label key={`offseason-${m.value}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", padding: "6px 10px", borderRadius: 999 }}>
                <input type="checkbox" checked={offseasonMonths.includes(m.value)} onChange={() => toggleMonth(m.value, "offseason")} />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        {overlapCount > 0 ? (
          <div style={{ color: "#a00", fontWeight: 800, fontSize: 13 }}>
            Attention: un mois ne peut pas être dans les deux listes.
          </div>
        ) : null}
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Table FTEM</h2>
          <button className="btn" type="button" onClick={addRow}>
            Ajouter une ligne
          </button>
        </div>

        {loading ? (
          <ListLoadingBlock label="Chargement..." />
        ) : rows.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucune ligne.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, fontSize: 11 }}>
              <colgroup>
                <col style={{ width: 56 }} />
                <col style={{ width: 170 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 60 }} />
                <col style={{ width: 92 }} />
              </colgroup>
              <thead>
                <tr>
                  <Th>FTEM</Th>
                  <Th>Level</Th>
                  <Th>Handicap min</Th>
                  <Th>Handicap max</Th>
                  <Th>Phrase motivation</Th>
                  <Th>Minutes/mois hors saison</Th>
                  <Th>Minutes/mois en saison</Th>
                  <Th>Ordre</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id ?? `row-${index}`}>
                    <Td>
                      <input
                        value={row.ftem_code}
                        onChange={(e) => updateRow(index, { ftem_code: e.target.value })}
                        style={{ ...compactInputStyle, width: 50 }}
                      />
                    </Td>
                    <Td>
                      <input
                        value={row.level_label}
                        onChange={(e) => updateRow(index, { level_label: e.target.value })}
                        style={{ ...compactInputStyle, width: "100%", minWidth: 150 }}
                      />
                    </Td>
                    <Td>
                      <input
                        value={row.handicap_min}
                        onChange={(e) => updateRow(index, { handicap_min: e.target.value })}
                        style={{ ...compactInputStyle, width: 60 }}
                      />
                    </Td>
                    <Td>
                      <input
                        value={row.handicap_max}
                        onChange={(e) => updateRow(index, { handicap_max: e.target.value })}
                        style={{ ...compactInputStyle, width: 60 }}
                      />
                    </Td>
                    <Td>
                      <textarea
                        value={row.motivation_text}
                        onChange={(e) => updateRow(index, { motivation_text: e.target.value })}
                        rows={4}
                        style={{ ...compactInputStyle, minWidth: 160, minHeight: 92, resize: "vertical" }}
                      />
                    </Td>
                    <Td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={row.minutes_offseason}
                        onChange={(e) => updateRow(index, { minutes_offseason: e.target.value })}
                        style={{ ...compactInputStyle, width: 60 }}
                      />
                    </Td>
                    <Td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={row.minutes_inseason}
                        onChange={(e) => updateRow(index, { minutes_inseason: e.target.value })}
                        style={{ ...compactInputStyle, width: 60 }}
                      />
                    </Td>
                    <Td>
                      <input
                        type="number"
                        step={1}
                        value={row.sort_order}
                        onChange={(e) => updateRow(index, { sort_order: e.target.value })}
                        style={{ ...compactInputStyle, width: 52 }}
                      />
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-danger soft" type="button" onClick={() => removeRow(index)} style={{ padding: "5px 6px", fontSize: 11, width: "100%" }}>
                        Supprimer
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn" type="button" disabled={saving || loading || !clubId} onClick={saveAll}>
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </button>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ textAlign: "left", fontSize: 10, color: "var(--muted)", padding: "4px 3px" }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "4px", borderTop: "1px solid var(--border)", verticalAlign: "top", ...style }}>{children}</td>;
}

const compactInputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 6px",
  minHeight: 28,
};
