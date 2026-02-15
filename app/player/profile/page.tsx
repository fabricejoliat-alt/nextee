"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;

  first_name: string | null;
  last_name: string | null;
  phone: string | null;

  birth_date: string | null; // date ISO
  nationality: string | null;
  sex: string | null;

  handicap: number | null;

  address: string | null;
  postal_code: string | null;
  city: string | null;
};

export default function PlayerProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  // form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const [birthDate, setBirthDate] = useState(""); // YYYY-MM-DD
  const [nationality, setNationality] = useState("");
  const [sex, setSex] = useState(""); // "male" | "female" | "other" | ""

  const [handicap, setHandicap] = useState<string>(""); // input string -> numeric/null

  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");

  const canSave = useMemo(() => !busy, [busy]);

  async function load() {
    setLoading(true);
    setError(null);
    setInfo(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError("Session invalide. Reconnecte-toi.");
      setLoading(false);
      return;
    }

    const uid = userRes.user.id;
    setUserId(uid);
    setEmail(userRes.user.email ?? "");

    const profRes = await supabase
      .from("profiles")
      .select(
        "id,first_name,last_name,phone,birth_date,nationality,sex,handicap,address,postal_code,city"
      )
      .eq("id", uid)
      .maybeSingle();

    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      return;
    }

    const row = (profRes.data ?? null) as ProfileRow | null;

    setFirstName(row?.first_name ?? "");
    setLastName(row?.last_name ?? "");
    setPhone(row?.phone ?? "");

    setBirthDate(row?.birth_date ?? "");
    setNationality(row?.nationality ?? "");
    setSex(row?.sex ?? "");

    setHandicap(row?.handicap == null ? "" : String(row.handicap));

    setAddress(row?.address ?? "");
    setPostalCode(row?.postal_code ?? "");
    setCity(row?.city ?? "");

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function parseHandicap(): number | null {
    const v = handicap.trim();
    if (v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return n;
  }

  async function save() {
    if (!userId) return;

    setBusy(true);
    setError(null);
    setInfo(null);

    const hc = parseHandicap();
    if (handicap.trim() !== "" && hc === null) {
      setError("Handicap invalide (nombre attendu).");
      setBusy(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          phone: phone.trim() || null,

          birth_date: birthDate.trim() || null,
          nationality: nationality.trim() || null,
          sex: sex.trim() || null,

          handicap: hc,

          address: address.trim() || null,
          postal_code: postalCode.trim() || null,
          city: city.trim() || null,
        },
        { onConflict: "id" }
      );

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    setInfo("Profil enregistré ✅");
    setBusy(false);
  }

  async function logout() {
    setBusy(true);
    setError(null);
    setInfo(null);

    const { error } = await supabase.auth.signOut();
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 900 }}>Mon profil</h1>
            <p style={{ marginTop: 6, color: "var(--muted)" }}>Tes informations joueur.</p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" onClick={save} disabled={!canSave} type="button">
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button className="btn btn-danger" onClick={logout} disabled={busy} type="button">
              Logout
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, border: "1px solid #ffcccc", background: "#fff5f5", padding: 12, borderRadius: 12, color: "#a00" }}>
            {error}
          </div>
        )}

        {info && (
          <div style={{ marginTop: 12, border: "1px solid #d1fae5", background: "#ecfdf5", padding: 12, borderRadius: 12, color: "#065f46" }}>
            {info}
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div>Chargement…</div>
        ) : (
          <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
            {/* Identité */}
            <section style={sectionStyle}>
              <div style={sectionTitle}>Identité</div>

              <div className="grid2" style={{ display: "grid", gap: 12 }}>

                <Field label="Prénom">
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>

                <Field label="Nom">
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
              </div>

              <div className="grid2" style={{ display: "grid", gap: 12 }}>

                <Field label="Date de naissance">
                  <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                </Field>

                <Field label="Sexe">
                  <select value={sex} onChange={(e) => setSex(e.target.value)}>
                    <option value="">—</option>
                    <option value="male">Homme</option>
                    <option value="female">Femme</option>
                    <option value="other">Autre</option>
                  </select>
                </Field>
              </div>

              <div className="grid2" style={{ display: "grid", gap: 12 }}>

                <Field label="Nationalité">
                  <input value={nationality} onChange={(e) => setNationality(e.target.value)} />
                </Field>

                <Field label="Handicap">
                  <input
                    inputMode="decimal"
                    placeholder="ex: 25.4"
                    value={handicap}
                    onChange={(e) => setHandicap(e.target.value)}
                  />
                </Field>
              </div>
            </section>

            {/* Contact */}
            <section style={sectionStyle}>
              <div style={sectionTitle}>Contact</div>

              <div className="grid2" style={{ display: "grid", gap: 12 }}>

                <Field label="Téléphone">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>

                <Field label="Email (login)">
                  <input value={email} disabled />
                </Field>
              </div>
            </section>

            {/* Adresse */}
            <section style={sectionStyle}>
              <div style={sectionTitle}>Adresse</div>

              <Field label="Adresse">
                <input value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>

              <div className="grid2" style={{ display: "grid", gap: 12 }}>

                <Field label="Code postal">
                  <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                </Field>

                <Field label="Localité">
                  <input value={city} onChange={(e) => setCity(e.target.value)} />
                </Field>
              </div>
            </section>

            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Astuce : tu peux remplir progressivement, tout est optionnel pour le MVP.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{label}</label>
      {children}
    </div>
  );
}

const grid2: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "1fr",
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 14,
  background: "#fff",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
};

if (typeof window !== "undefined") {
  // nothing
}

// Responsive 2 columns on larger screens
// (inline style hack-free: on laisse le CSS global gérer la mise en page via media query)
