"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./AccessibleDialog.module.css";

/** Native modal top layer: background inert, focus contained, Escape supported. */
export default function AccessibleDialog({ children, onClose, className = "", labelledBy, label }: {
  children: ReactNode; onClose: () => void; className?: string; labelledBy?: string; label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${className}`} aria-label={label} aria-labelledby={labelledBy}
    aria-modal="true" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]'
      )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    {children}
  </dialog>;
}
