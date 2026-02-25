import Link from "next/link";

export default function AdminSettingsPage() {
  return (
    <section className="glass-section" style={{ marginTop: 14 }}>
      <div className="section-title">Réglages</div>

      <div className="glass-card" style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Réglages</h1>
          <p style={{ margin: "8px 0 0", color: "rgba(0,0,0,0.65)", fontWeight: 700 }}>
            Paramètres transverses de la plateforme.
          </p>
        </div>

        <div
          style={{
            border: "1px solid rgba(0,0,0,0.10)",
            borderRadius: 14,
            background: "rgba(255,255,255,0.65)",
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900 }}>Traductions</div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,0.62)", fontWeight: 700 }}>
            Gérer les libellés multilingues (fr/en) utilisés dans Coach et Player.
          </div>
          <div>
            <Link href="/admin/translations" className="btn">
              Ouvrir Traductions
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
