"use client";

import type { CSSProperties } from "react";

type Props = {
  messageCount: number;
  unreadCount: number;
  showZero?: boolean;
  style?: CSSProperties;
};

export default function MessageCountBadge({
  messageCount,
  unreadCount,
  showZero = false,
  style,
}: Props) {
  const count = Math.max(0, Number(messageCount || 0));
  const unread = Math.max(0, Number(unreadCount || 0));

  if (!showZero && count <= 0) return null;

  const baseStyle: CSSProperties = {
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1.2,
    border: "1px solid transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 24,
  };

  if (count <= 0) {
    return (
      <span
        style={{
          ...baseStyle,
          background: "rgba(107,114,128,0.14)",
          color: "rgba(75,85,99,1)",
          borderColor: "rgba(107,114,128,0.24)",
          ...style,
        }}
      >
        0
      </span>
    );
  }

  if (unread > 0) {
    return (
      <span
        style={{
          ...baseStyle,
          background: "rgba(220,38,38,0.14)",
          color: "rgba(153,27,27,1)",
          borderColor: "rgba(220,38,38,0.24)",
          ...style,
        }}
      >
        {count}
      </span>
    );
  }

  return (
    <span
      style={{
        ...baseStyle,
        background: "rgba(22,163,74,0.14)",
        color: "rgba(21,128,61,1)",
        borderColor: "rgba(22,163,74,0.24)",
        ...style,
      }}
    >
      {count}
    </span>
  );
}
