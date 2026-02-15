import { ReactNode } from "react";
import { theme } from "@/styles/theme";

export function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: theme.colors.white,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        boxShadow: theme.shadow.card,
      }}
    >
      {children}
    </div>
  );
}
