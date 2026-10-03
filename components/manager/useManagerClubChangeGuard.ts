"use client";

import { useEffect } from "react";

const eventName = "manager:before-club-change";

export function requestManagerClubChange() {
  if (typeof window === "undefined") return true;
  return window.dispatchEvent(new Event(eventName, { cancelable: true }));
}

export function useManagerClubChangeGuard(shouldConfirm: boolean, message: string, blocked = false) {
  useEffect(() => {
    if ((!shouldConfirm && !blocked) || typeof window === "undefined" || !window.addEventListener) return;
    const handleChange = (event: Event) => {
      if (blocked || (shouldConfirm && !window.confirm(message))) event.preventDefault();
    };
    window.addEventListener(eventName, handleChange);
    return () => window.removeEventListener(eventName, handleChange);
  }, [shouldConfirm, message, blocked]);
}
