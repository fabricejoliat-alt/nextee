"use client";

type AttendanceToggleProps = {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  leftLabel: string;
  rightLabel: string;
  ariaLabel: string;
  disabledCursor?: "wait" | "not-allowed";
};

export function AttendanceToggle({
  checked,
  onToggle,
  disabled = false,
  leftLabel,
  rightLabel,
  ariaLabel,
  disabledCursor = "not-allowed",
}: AttendanceToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      disabled={disabled}
      style={{
        width: 114,
        height: 24,
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.14)",
        background: "rgba(0,0,0,0.16)",
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 180ms ease",
        cursor: disabled ? disabledCursor : "pointer",
        flex: "0 0 auto",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "50%",
          left: checked ? "50%" : 0,
          background: checked ? "var(--green-light)" : "#ea7f77",
          borderTopLeftRadius: checked ? 0 : 999,
          borderBottomLeftRadius: checked ? 0 : 999,
          borderTopRightRadius: checked ? 999 : 0,
          borderBottomRightRadius: checked ? 999 : 0,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 8,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 9,
          fontWeight: 900,
          color: checked ? "rgba(255,255,255,0.72)" : "#fff",
          letterSpacing: 0.2,
          textTransform: "uppercase",
        }}
      >
        {leftLabel}
      </span>
      <span
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 9,
          fontWeight: 900,
          color: checked ? "#fff" : "rgba(255,255,255,0.72)",
          letterSpacing: 0.2,
          textTransform: "uppercase",
          minWidth: 44,
          textAlign: "right",
        }}
      >
        {rightLabel}
      </span>
    </button>
  );
}

