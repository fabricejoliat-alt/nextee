"use client";

import { useEffect, useId, useState } from "react";

export default function AnimatedProgressRing({ percent, size = 150, label }: { percent: number | null; size?: number; label: string }) {
  const value = Math.max(0, Math.min(100, percent ?? 0));
  const gradientId = useId();
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 60;
    const timer = window.setTimeout(() => setAnimatedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={percent == null ? `${label} : aucune activité confirmée` : `${label} : ${Math.round(value)} %`}>
      <defs>
        <linearGradient id={gradientId} x1="70" y1="16" x2="124" y2="124" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--green-light)" />
          <stop offset="100%" stopColor="var(--green-dark)" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r={radius} strokeWidth="14" stroke="#e9eee7" fill="none" />
      <circle cx="70" cy="70" r={radius} strokeWidth="14" fill="none"
        strokeLinecap="round" strokeDasharray={`${(animatedValue / 100) * circumference} ${circumference}`}
        transform="rotate(-90 70 70)" className="donut-fg" style={{ stroke: `url(#${gradientId})` }} />
      <text x="70" y="79" textAnchor="middle" className="donut-label">{percent == null ? "—" : `${Math.round(value)}%`}</text>
      {value >= 100 ? <g className="donut-check-wrap on"><circle className="donut-check-circle" cx="70" cy="108" r="16" />
        <path className="donut-check" d="M64 110 l4 4 l9 -10" /></g> : null}
    </svg>
  );
}
