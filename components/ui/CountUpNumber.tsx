"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type CountUpNumberProps = {
  value: number;
  durationMs?: number;
  className?: string;
  style?: CSSProperties;
};

export default function CountUpNumber({
  value,
  durationMs = 2000,
  className,
  style,
}: CountUpNumberProps) {
  const target = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (target <= 0 || durationMs <= 0) {
      setDisplay(target);
      return;
    }

    setDisplay(0);
    let startTs: number | null = null;

    const tick = (ts: number) => {
      if (startTs == null) startTs = ts;
      const elapsed = ts - startTs;
      const progress = Math.min(1, elapsed / durationMs);
      const nextValue = Math.min(target, Math.floor(progress * target));
      setDisplay(nextValue);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        setDisplay(target);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [target, durationMs]);

  return (
    <span className={className} style={style}>
      {display}
    </span>
  );
}

