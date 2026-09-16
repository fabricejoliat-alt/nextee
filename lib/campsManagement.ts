export type CampAttendanceStatus = "expected" | "present" | "absent" | "excused" | "not_registered";
export type CampLifecycle = "upcoming" | "in_progress" | "completed" | "draft" | "archived";

const ATTENDANCE = new Set<CampAttendanceStatus>(["expected", "present", "absent", "excused", "not_registered"]);

export function normalizeCampAttendanceStatus(value: unknown): CampAttendanceStatus {
  const normalized = String(value ?? "").trim().toLowerCase() as CampAttendanceStatus;
  return ATTENDANCE.has(normalized) ? normalized : "expected";
}

export function dedupeCampParticipants(groupPlayerIds: string[], individualPlayerIds: string[]) {
  return Array.from(new Set([...groupPlayerIds, ...individualPlayerIds].map((id) => String(id ?? "").trim()).filter(Boolean)));
}

export function isSelectableCampGroup(name: string | null | undefined) {
  const normalized = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return (
    normalized.length > 0 &&
    normalized !== "GROUPE_SPECIFIQUE" &&
    !normalized.includes("EVENT_SPECIFIQUE")
  );
}

export function remainingCampCapacity(capacity: number | null | undefined, assignedQuantity: number) {
  if (capacity == null) return null;
  return Math.max(0, Math.trunc(capacity) - Math.max(0, Math.trunc(assignedQuantity)));
}

export function deriveCampLifecycle(
  status: string | null | undefined,
  days: Array<{ starts_at?: string | null; ends_at?: string | null }>,
  now = new Date()
): CampLifecycle {
  if (status === "archived") return "archived";
  if (status === "draft") return "draft";
  const starts = days.map((day) => new Date(day.starts_at ?? "").getTime()).filter(Number.isFinite);
  const ends = days.map((day) => new Date(day.ends_at ?? "").getTime()).filter(Number.isFinite);
  if (starts.length === 0) return "draft";
  if (now.getTime() < Math.min(...starts)) return "upcoming";
  if (now.getTime() <= Math.max(...ends, ...starts)) return "in_progress";
  return "completed";
}

export function validateCampDays(days: Array<{ starts_at?: string | null; ends_at?: string | null; location_text?: string | null }>) {
  const errors: string[] = [];
  const keys = new Set<string>();
  days.forEach((day, index) => {
    const start = new Date(day.starts_at ?? "").getTime();
    const end = new Date(day.ends_at ?? "").getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push(`Journée ${index + 1}: horaires invalides.`);
    const key = `${day.starts_at ?? ""}|${day.ends_at ?? ""}|${String(day.location_text ?? "").trim().toLowerCase()}`;
    if (keys.has(key)) errors.push(`Journée ${index + 1}: doublon détecté.`);
    keys.add(key);
  });
  return errors;
}

export function evaluationToggleEffect(previouslyEnabled: boolean, nextEnabled: boolean, completedEvaluations: number) {
  return {
    requiresConfirmation: previouslyEnabled && !nextEnabled && completedEvaluations > 0,
    deleteExistingEvaluations: false,
  };
}

export function moveCampItem<T>(values: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= values.length) return values;
  const next = [...values];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
