import { ReactNode } from "react";
import { theme } from "@/styles/theme";

export function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        fontSize: 22,
        fontWeight: 900,
        color: theme.colors.primary,
      }}
    >
      {children}
    </h1>
  );
}
