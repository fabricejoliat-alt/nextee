import { theme } from "@/styles/theme";

export function Input(props: any) {
  return (
    <input
      {...props}
      style={{
        height: 44,
        padding: "0 14px",
        borderRadius: theme.radius.md,
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.white,
        color: theme.colors.text,
        fontSize: 14,
      }}
    />
  );
}
