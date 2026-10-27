export type SwipeDirection = "back" | "forward";
export type SwipePoint = { x: number; y: number; time: number };
export type EdgeSwipe = { direction: SwipeDirection; start: SwipePoint };

export function startEdgeSwipe(point: SwipePoint, width: number): EdgeSwipe | null {
  if (width < 200 || point.x < 0 || point.x > width) return null;
  if (point.x <= 32) return { direction: "back", start: point };
  if (point.x >= width - 32) return { direction: "forward", start: point };
  return null;
}

export function edgeSwipeMovement(gesture: EdgeSwipe, point: SwipePoint) {
  const distance = (point.x - gesture.start.x) * (gesture.direction === "back" ? 1 : -1);
  const vertical = Math.abs(point.y - gesture.start.y);
  const cancelled = point.time - gesture.start.time > 1000 || distance < -12 || (vertical > 12 && vertical > Math.abs(distance));
  return { cancelled, horizontal: distance > 12 && distance > vertical * 2, progress: Math.max(0, Math.min(1, distance / 88)), complete: !cancelled && distance >= 88 && distance > vertical * 2 };
}

export function isSwipeAppPath(pathname: string) {
  return /^\/(player|parent|coach|manager|admin)(\/|$)/.test(pathname);
}

export function isSwipeEditingPath(pathname: string) {
  return /\/(new|edit|settings|profile)(\/|$)/.test(pathname);
}
