export default function AppLoading() {
  return (
    <div className="app-splash-screen" role="status" aria-live="polite" aria-label="Chargement de l'application">
      <div className="app-splash-card">
        <div className="app-splash-brand" aria-label="ActiviTee">
          <span className="app-splash-brand-nex">Activi</span>
          <span className="app-splash-brand-tee">Tee</span>
        </div>
        <div className="app-splash-subtitle">Golf app junior</div>
        <div className="app-splash-loader" />
      </div>
    </div>
  );
}
