"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { Globe } from "lucide-react";

export default function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const options = [
    { code: "fr", label: "FR" },
    { code: "en", label: "EN" },
    { code: "de", label: "DE" },
    { code: "it", label: "IT" },
  ] as const;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="icon-btn lang-toggle"
        aria-label={t("common.switchLanguage")}
        title={t("common.switchLanguage")}
        onClick={() => setOpen((v) => !v)}
        style={{ minWidth: 68, paddingInline: 10, gap: 6, display: "inline-flex", alignItems: "center" }}
      >
        <Globe size={14} />
        <span style={{ fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>{locale.toUpperCase()}</span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 120,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "white",
            boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
            padding: 6,
            zIndex: 40,
            display: "grid",
            gap: 4,
          }}
        >
          {options.map((opt) => {
            const active = locale === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  setLocale(opt.code);
                  setOpen(false);
                }}
                style={{
                  border: "1px solid transparent",
                  borderRadius: 10,
                  padding: "8px 10px",
                  textAlign: "left",
                  fontWeight: active ? 900 : 700,
                  background: active ? "rgba(53,72,59,0.10)" : "transparent",
                  color: "rgba(0,0,0,0.86)",
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
