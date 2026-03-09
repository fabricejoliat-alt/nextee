"use client";

import { useMemo, useState } from "react";
import PublicSimpleHeader from "@/components/public/PublicSimpleHeader";

type ParentForm = {
  firstName: string;
  lastName: string;
  email: string;
};

type ChildForm = {
  firstName: string;
  lastName: string;
  birthDate: string;
  handicap: string;
};

const EMPTY_PARENT: ParentForm = { firstName: "", lastName: "", email: "" };
const EMPTY_CHILD: ChildForm = { firstName: "", lastName: "", birthDate: "", handicap: "" };
const DATE_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 44,
  boxSizing: "border-box",
  fontSize: 16,
  lineHeight: "20px",
  color: "rgba(0,0,0,0.85)",
  WebkitAppearance: "none",
  appearance: "none",
};

export default function ParentIntakePublicPage() {
  const [parents, setParents] = useState<ParentForm[]>([{ ...EMPTY_PARENT }]);
  const [children, setChildren] = useState<ChildForm[]>([{ ...EMPTY_CHILD }]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const canAddParent = parents.length < 2;
  const hasDuplicateParentEmails = useMemo(() => {
    const emails = parents.map((p) => p.email.trim().toLowerCase()).filter(Boolean);
    return new Set(emails).size !== emails.length;
  }, [parents]);

  const valid = useMemo(() => {
    const validParents = parents.filter((p) => p.firstName.trim() && p.lastName.trim() && p.email.trim().includes("@"));
    const validChildren = children.filter((c) => c.firstName.trim() && c.lastName.trim() && c.birthDate.trim());
    return validParents.length >= 1 && validChildren.length >= 1 && !hasDuplicateParentEmails;
  }, [parents, children, hasDuplicateParentEmails]);

  function updateParent(index: number, patch: Partial<ParentForm>) {
    setParents((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function updateChild(index: number, patch: Partial<ChildForm>) {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;

    setSubmitting(true);
    setError("");
    setSuccess("");
    if (hasDuplicateParentEmails) {
      setError("Les adresses e-mail des parents doivent être différentes.");
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        parents: parents
          .map((p) => ({
            first_name: p.firstName.trim(),
            last_name: p.lastName.trim(),
            email: p.email.trim().toLowerCase(),
          }))
          .filter((p) => p.first_name && p.last_name && p.email),
        children: children
          .map((c) => ({
            first_name: c.firstName.trim(),
            last_name: c.lastName.trim(),
            birth_date: c.birthDate.trim(),
            handicap: c.handicap.trim() || null,
          }))
          .filter((c) => c.first_name && c.last_name && c.birth_date),
      };

      const res = await fetch("/api/public/parent-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Envoi impossible"));

      setSuccess("Merci, votre formulaire a bien été envoyé.");
      setParents([{ ...EMPTY_PARENT }]);
      setChildren([{ ...EMPTY_CHILD }]);
    } catch (err: any) {
      setError(err?.message ?? "Envoi impossible");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <PublicSimpleHeader />

      <div className="app-shell marketplace-page" style={{ paddingInline: 10 }}>
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Golf Club de Sion - Section Junior
              </div>
            </div>
          </div>
        </div>

        <div className="glass-section">
          <div
            className="glass-card"
            style={{
              display: "grid",
              gap: 12,
              background: "linear-gradient(180deg, #ffffff 0%, #f7fbf8 100%)",
              border: "1px solid rgba(27,94,32,0.14)",
              boxShadow: "0 10px 26px rgba(16,24,40,0.06)",
            }}
          >
            <div
              className="card-title"
              style={{ marginBottom: 0, color: "var(--green-dark)", letterSpacing: 0.2 }}
            >
              Activation des comptes parents
            </div>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: "rgba(0,0,0,0.72)",
                fontWeight: 500,
                display: "grid",
                gap: 10,
              }}
            >
              <p style={{ margin: 0 }}>
                Dans le cadre du développement de sa section junior, le Golf Club de Sion utilisera dès cette saison{" "}
                <strong>ActiviTee</strong>, une plateforme dédiée à l’organisation de ses activités, à la planification des entraînements et au suivi de la progression des joueurs.
              </p>
              <p style={{ margin: 0 }}>
                Nous vous remercions de bien vouloir compléter ce formulaire. Les informations recueillies permettront de créer les comptes parents et de les associer aux joueurs juniors inscrits dans la section junior.
              </p>
              <p style={{ margin: 0 }}>
                Vous recevrez dans quelques jours un e-mail vous permettant d’activer votre compte sur la plateforme, de valider le consentement lié à la protection des données et d’accéder au suivi des activités et de la progression de votre (vos) enfant(s).
              </p>
              <div style={{ marginTop: 2, fontWeight: 700, color: "rgba(27,94,32,0.92)" }}>Le comité junior</div>
            </div>
          </div>
        </div>

        <div className="glass-section">
          <form
            className="glass-card"
            onSubmit={submitForm}
            style={{ display: "grid", gap: 14, background: "#ffffff" }}
          >
            <div
              className="card-title"
              style={{ marginBottom: 0, color: "var(--green-dark)", textTransform: "uppercase" }}
            >
              Parents / représentants légaux
            </div>

            {parents.map((parent, idx) => (
              <div key={idx} style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>Parent {idx + 1}</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr" }}>
                  <input className="input" style={{ width: "100%" }} placeholder="Prénom" value={parent.firstName} onChange={(e) => updateParent(idx, { firstName: e.target.value })} />
                  <input className="input" style={{ width: "100%" }} placeholder="Nom" value={parent.lastName} onChange={(e) => updateParent(idx, { lastName: e.target.value })} />
                  <input className="input" style={{ width: "100%" }} type="email" placeholder="Adresse e-mail" value={parent.email} onChange={(e) => updateParent(idx, { email: e.target.value })} />
                </div>
              </div>
            ))}

            {canAddParent ? (
              <div>
                <button type="button" className="btn" onClick={() => setParents((p) => [...p, { ...EMPTY_PARENT }])}>
                  Ajouter un 2e parent
                </button>
              </div>
            ) : null}

            <div className="hr-soft" />
            <div
              className="card-title"
              style={{ marginBottom: 0, color: "var(--green-dark)", textTransform: "uppercase" }}
            >
              Juniors
            </div>

            {children.map((child, idx) => (
              <div key={idx} style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>Junior {idx + 1}</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr" }}>
                  <input className="input" style={{ width: "100%" }} placeholder="Prénom" value={child.firstName} onChange={(e) => updateChild(idx, { firstName: e.target.value })} />
                  <input className="input" style={{ width: "100%" }} placeholder="Nom" value={child.lastName} onChange={(e) => updateChild(idx, { lastName: e.target.value })} />
                  <input
                    className="input"
                    style={DATE_INPUT_STYLE}
                    type="date"
                    value={child.birthDate}
                    onChange={(e) => updateChild(idx, { birthDate: e.target.value })}
                  />
                  <input className="input" style={{ width: "100%" }} placeholder="Handicap (si connu)" value={child.handicap} onChange={(e) => updateChild(idx, { handicap: e.target.value })} />
                </div>
              </div>
            ))}

            <div>
              <button type="button" className="btn" onClick={() => setChildren((c) => [...c, { ...EMPTY_CHILD }])}>
                Ajouter un junior
              </button>
            </div>

            {error ? <div className="marketplace-error">{error}</div> : null}
            {!error && hasDuplicateParentEmails ? (
              <div className="marketplace-error">Les adresses e-mail des parents doivent être différentes.</div>
            ) : null}
            {success ? <div className="pill-soft" style={{ color: "rgba(21,128,61,1)", fontWeight: 900 }}>{success}</div> : null}

            <div>
              <button className="btn btn-primary btn-upload-green" type="submit" disabled={!valid || submitting}>
                {submitting ? "Envoi..." : "Envoyer le formulaire"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
