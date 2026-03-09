import Link from "next/link";

export default function PublicSimpleHeader() {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-grid app-header-grid--centered">
          <div className="header-left header-left--icon" aria-hidden="true" />
          <div className="header-center header-center--brand">
            <Link href="/" className="brand" aria-label="ActiviTee - Accueil">
              <span className="brand-nex">Activi</span>
              <span className="brand-tee">Tee</span>
            </Link>
          </div>
          <div className="header-right header-right--icon" aria-hidden="true" />
        </div>
      </div>
    </header>
  );
}
