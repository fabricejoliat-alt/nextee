export default function AppLoading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeContent: "center",
        gap: 12,
        background:
          "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.64) 35%, rgba(255,255,255,0.55) 100%)",
      }}
    >
      <div className="route-loading-spinner" />
      <div className="route-loading-text">Chargement…</div>
    </div>
  );
}

