"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  coach_user_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  category:
    | "warmup_mobility"
    | "long_game"
    | "putting"
    | "wedging"
    | "pitching"
    | "chipping"
    | "bunker"
    | "course"
    | "mental"
    | "fitness"
    | "other";
  minutes: number;
  note: string | null;
  other_detail: string | null;
  created_at: string;
};

const CAT_LABEL: Record<ItemRow["category"], string> = {
  warmup_mobility: "Échauffement / mobilité",
  long_game: "Long jeu",
  putting: "Putting",
  wedging: "Wedging",
  pitching: "Pitching",
  chipping: "Chipping",
  bunker: "Bunker",
  course: "Parcours",
  mental: "Préparation mentale",
  fitness: "Fitness / musculation",
  other: "Autre activité",
};

function uuidOrNull(v: any) {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

function getParamString(p: any): string | null {
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function getIdFromPathname(pathname: string): string | null {
  // ex: /player/trainings/<id>
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  // évite de prendre "trainings" ou "edit"
  if (last === "trainings" || last === "edit" || last === "new") return null;
  return last;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function typeLabel(t: SessionRow["session_type"]) {
  if (t === "club") return "Entraînement en club";
  if (t === "private") return "Cours privé";
  return "Entraînement individuel";
}

export default function TrainingDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  // ✅ sessionId robuste : params OU URL
  const sessionId = useMemo(() => {
    const fromParams = uuidOrNull(getParamString((params as any)?.sessionId));
    if (fromParams) return fromParams;

    const fromUrl = uuidOrNull(getIdFromPathname(pathname));
    return fromUrl;
  }, [params, pathname]);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);

  const [clubName, setClubName] = useState<string | null>(null);
  const [coachLabel, setCoachLabel] = useState<string | null>(null);

  const totalMinutes = useMemo(() => {
    if (typeof session?.total_minutes === "number") return session.total_minutes;
    return items.reduce((sum, it) => sum + (it.minutes || 0), 0);
  }, [session, items]);

  const breakdown = useMemo(() => {
    const byCat: Record<string, number> = {};
    for (const it of items) byCat[it.category] = (byCat[it.category] ?? 0) + (it.minutes || 0);
    return Object.entries(byCat)
      .map(([cat, minutes]) => ({
        cat: cat as ItemRow["category"],
        label: CAT_LABEL[cat as ItemRow["category"]] ?? cat,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [items]);

  async function load(id: string) {
    setLoading(true);
    setError(null);

    try {
      const sRes = await supabase
        .from("training_sessions")
        .select(
          "id,start_at,location_text,session_type,club_id,coach_user_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,created_at"
        )
        .eq("id", id)
        .maybeSingle();

      if (sRes.error) throw new Error(sRes.error.message);
      if (!sRes.data) throw new Error("Entraînement introuvable.");

      const s = sRes.data as SessionRow;
      setSession(s);

      const iRes = await supabase
        .from("training_session_items")
        .select("id,category,minutes,note,other_detail,created_at")
        .eq("session_id", id)
        .order("created_at", { ascending: true });

      if (iRes.error) throw new Error(iRes.error.message);
      setItems((iRes.data ?? []) as ItemRow[]);

      // club name
      if (s.session_type === "club" && uuidOrNull(s.club_id)) {
        const cRes = await supabase.from("clubs").select("id,name").eq("id", s.club_id as string).maybeSingle();
        setClubName(!cRes.error && cRes.data ? (cRes.data.name ?? "Club") : "Club");
      } else {
        setClubName(null);
      }

      // coach label
      if (s.session_type === "club" && uuidOrNull(s.coach_user_id)) {
        const pRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name")
          .eq("id", s.coach_user_id as string)
          .maybeSingle();

        if (!pRes.error && pRes.data) {
          const f = (pRes.data.first_name ?? "").trim();
          const l = (pRes.data.last_name ?? "").trim();
          setCoachLabel(!f && !l ? "Coach" : `${f} ${l ? l[0] + "." : ""}`.trim());
        } else {
          setCoachLabel("Coach");
        }
      } else {
        setCoachLabel(s.coach_name ? s.coach_name : null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setSession(null);
      setItems([]);
      setClubName(null);
      setCoachLabel(null);
    } finally {
      setLoading(false);
    }
  }

  // ✅ Ne pas rester en "Chargement…" si id absent
  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      setError("Identifiant d’entraînement introuvable dans l’URL.");
      return;
    }
    load(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function handleDelete() {
    if (!sessionId) return;
    if (!confirm("Supprimer cet entraînement ?")) return;

    setDeleting(true);
    setError(null);

    try {
      const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
      if (delItems.error) throw new Error(delItems.error.message);

      const delSession = await supabase.from("training_sessions").delete().eq("id", sessionId);
      if (delSession.error) throw new Error(delSession.error.message);

      router.push("/player/trainings");
    } catch (e: any) {
      setError(e?.message ?? "Erreur suppression.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  if (!session) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Entraînement</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? "Impossible d’afficher cet entraînement."}
          </div>
        </div>
        <Link className="btn" href="/player/trainings">
          Retour
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{typeLabel(session.session_type)}</div>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
              {fmtDateTime(session.start_at)} • {totalMinutes} min
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href={`/player/trainings/${session.id}/edit`}>
              Modifier
            </Link>
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </div>
        </div>

        {session.location_text && <div style={{ fontWeight: 700 }}>📍 {session.location_text}</div>}

        {(clubName || coachLabel) && (
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {clubName ? <>Club : {clubName}</> : null}
            {clubName && coachLabel ? " • " : null}
            {coachLabel ? <>Coach : {coachLabel}</> : null}
          </div>
        )}

        {error && <div style={{ marginTop: 6, color: "#a00" }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Détail</div>

        {items.length === 0 ? (
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>Aucun poste enregistré.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((it) => (
              <div key={it.id} style={{ border: "1px solid #e8e8e8", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>
                    {it.category === "other" ? "Autre activité" : CAT_LABEL[it.category]}
                    {it.category === "other" && it.other_detail ? ` — ${it.other_detail}` : ""}
                  </div>
                  <div style={{ fontWeight: 900 }}>{it.minutes} min</div>
                </div>

                {it.note && <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>{it.note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Répartition</div>
        {breakdown.length === 0 ? (
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>—</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {breakdown.map((b) => (
              <div key={b.cat} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>{b.label}</div>
                <div style={{ fontWeight: 900 }}>{b.minutes} min</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Sensations</div>
        <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 13, display: "grid", gap: 6 }}>
          <div>Motivation : {session.motivation ?? "—"} / 6</div>
          <div>Difficulté : {session.difficulty ?? "—"} / 6</div>
          <div>Satisfaction : {session.satisfaction ?? "—"} / 6</div>
        </div>
      </div>

      {session.notes && (
        <div className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 900 }}>Remarques</div>
          <div style={{ fontWeight: 700, whiteSpace: "pre-wrap" }}>{session.notes}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="btn" href="/player/trainings">
          Retour à la liste
        </Link>
      </div>
    </div>
  );
}
