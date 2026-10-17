"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./AccessibleDialog.module.css";

const subscribeToDocument = () => () => {};
const getDocumentBody = () => document.body;
const getServerBody = () => null;

/** Native modal top layer: background inert, focus contained, Escape supported. */
export default function AccessibleDialog({ children, onClose, className = "", labelledBy, label, portal = false }: {
  children: ReactNode; onClose: () => void; className?: string; labelledBy?: string; label?: string; portal?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const portalRoot = useSyncExternalStore(subscribeToDocument, getDocumentBody, getServerBody);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    const pagePosition = { left: window.scrollX, top: window.scrollY };
    const ancestors: Array<{ element: HTMLElement; left: number; top: number }> = [];
    for (let element = dialog.parentElement; element; element = element.parentElement) {
      ancestors.push({ element, left: element.scrollLeft, top: element.scrollTop });
    }
    const restorePosition = () => {
      for (const { element, left, top } of ancestors) {
        element.scrollTo({ left, top, behavior: "instant" });
      }
      window.scrollTo({ ...pagePosition, behavior: "instant" });
    };
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    restorePosition();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      restorePosition();
    };
  }, [portal, portalRoot]);
  const content = <dialog ref={ref} tabIndex={-1} className={`${styles.dialog} ${className}`} aria-label={label} aria-labelledby={labelledBy}
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
  return portal ? (portalRoot ? createPortal(content, portalRoot) : null) : content;
}
