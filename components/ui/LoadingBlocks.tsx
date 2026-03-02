"use client";

import type { CSSProperties } from "react";

export function ListLoadingBlock({ label }: { label: string }) {
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{ display: "grid", gap: 10, padding: "6px 2px" }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <div
          className="route-loading-spinner"
          style={{ width: 22, height: 22, borderWidth: 3, boxShadow: "none" }}
        />
        <div style={{ color: "rgba(0,0,0,0.62)", fontWeight: 900, fontSize: 12 }}>{label}</div>
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        <ShimmerLine width="72%" />
        <ShimmerLine width="88%" />
        <ShimmerLine width="64%" />
      </div>
    </div>
  );
}

export function CompactLoadingBlock({ label }: { label: string }) {
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <div
        className="route-loading-spinner"
        style={{ width: 16, height: 16, borderWidth: 2, boxShadow: "none" }}
      />
      <span style={{ color: "rgba(0,0,0,0.62)", fontWeight: 850, fontSize: 12 }}>{label}</span>
    </div>
  );
}

function ShimmerLine({ width }: { width: CSSProperties["width"] }) {
  return (
    <div
      style={{
        height: 10,
        width,
        borderRadius: 999,
        background:
          "linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.14), rgba(0,0,0,0.08))",
        backgroundSize: "200% 100%",
        animation: "soft-shimmer 1.2s ease-in-out infinite",
      }}
    />
  );
}

