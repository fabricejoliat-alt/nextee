import { ReactNode } from "react";
import { theme } from "@/styles/theme";

export function Button({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 44,
        padding: "0 18px",
        borderRadius: theme.radius.md,
        border: "none",
        background: disabled
          ? "#9CA3AF"
          : theme.colors.primary,
        color: theme.colors.white,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
