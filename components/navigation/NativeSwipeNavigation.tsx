"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { installIOSSwipeNavigation, supportsIOSSwipeNavigation } from "@/lib/nativeIOSSwipeNavigation";
import { installNativeSwipeHistory } from "@/lib/nativeSwipeHistory";
import { edgeSwipeMovement, isSwipeAppPath, isSwipeEditingPath, startEdgeSwipe, type EdgeSwipe, type SwipeDirection } from "@/lib/nativeSwipeNavigation";
import styles from "./NativeSwipeNavigation.module.css";

type Indicator = { direction: SwipeDirection; progress: number; top: number };
function blockedTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  if (target.closest("a,button,input,textarea,select,form,[contenteditable]:not([contenteditable='false']),[role='button'],[role='slider'],[role='tablist'],[data-swipe-navigation='off']")) return true;
  for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true;
  }
  return false;
}
function blockedPage() {
  const visibleBlocker = Array.from(document.querySelectorAll("form,dialog[open],[role='dialog'][aria-modal='true'],[data-swipe-navigation='off']")).some(element => element.getClientRects().length > 0);
  return !isSwipeAppPath(location.pathname) || isSwipeEditingPath(location.pathname) || visibleBlocker || Boolean(document.activeElement?.matches("input,textarea,select,[contenteditable]:not([contenteditable='false'])"));
}

export default function NativeSwipeNavigation() {
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  useEffect(() => {
    // Safari/Chrome retain their own gestures. Only the hosted mobile app needs this.
    if (!Capacitor.isNativePlatform()) return;
    if (supportsIOSSwipeNavigation()) return installIOSSwipeNavigation(window, blockedPage);
    let gesture: EdgeSwipe | null = null, locked = false, lastNavigation = 0;
    const reset = () => { gesture = null; locked = false; setIndicator(null); };
    const history = installNativeSwipeHistory(window, reset);
    const point = (touch: Touch) => ({ x: touch.clientX, y: touch.clientY, time: performance.now() });
    const start = (event: TouchEvent) => {
      reset();
      if (event.touches.length !== 1 || event.defaultPrevented || blockedPage() || blockedTarget(event.target) || performance.now() - lastNavigation < 600) return;
      const next = startEdgeSwipe(point(event.touches[0]), window.innerWidth);
      if (next && history.canNavigate(next.direction)) gesture = next;
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || event.defaultPrevented || blockedPage()) return reset();
      const movement = edgeSwipeMovement(gesture, point(event.touches[0]));
      if (movement.cancelled || !event.cancelable) return reset();
      if (movement.horizontal || locked) {
        locked = true; event.preventDefault();
        setIndicator({ direction: gesture.direction, progress: movement.progress, top: Math.max(90, Math.min(window.innerHeight - 90, gesture.start.y)) });
      }
    };
    const end = (event: TouchEvent) => {
      if (gesture && locked && event.changedTouches.length === 1 && !blockedPage() && edgeSwipeMovement(gesture, point(event.changedTouches[0])).complete) {
        if (event.cancelable) event.preventDefault();
        const direction = gesture.direction; reset(); lastNavigation = performance.now(); history.navigate(direction);
      } else reset();
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: false });
    document.addEventListener("touchcancel", reset);
    window.addEventListener("resize", reset);
    return () => {
      history.dispose(); document.removeEventListener("touchstart", start); document.removeEventListener("touchmove", move); document.removeEventListener("touchend", end); document.removeEventListener("touchcancel", reset); window.removeEventListener("resize", reset);
    };
  }, []);
  if (!indicator) return null;
  const Icon = indicator.direction === "back" ? ChevronLeft : ChevronRight;
  return <div className={`${styles.indicator} ${indicator.direction === "back" ? styles.back : styles.forward}`} style={{ top: indicator.top, opacity: 0.35 + indicator.progress * 0.65, transform: `translateY(-50%) scale(${0.8 + indicator.progress * 0.2})` }} aria-hidden="true"><Icon size={24} /></div>;
}
