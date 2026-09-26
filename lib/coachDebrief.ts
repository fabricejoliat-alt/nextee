export const COACH_RATING_MIN = 1;
export const COACH_RATING_MAX = 6;
export const COACH_REPORT_MAX_LENGTH = 10_000;
export const COACH_PRIVATE_NOTE_MAX_LENGTH = 4_000;

export type CoachAttendanceStatus = "present" | "absent";
export type CoachReportScope = "collective" | "individual" | "mixed";

export type CoachDebriefReview = {
  player_id: string;
  status: CoachAttendanceStatus;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
};

export type CoachPrivateNoteProposal = {
  player_id: string;
  text: string;
};

export class CoachDebriefValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CoachDebriefValidationError";
    this.code = code;
  }
}

function requiredUuid(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new CoachDebriefValidationError("invalid_uuid", `${field} is invalid.`);
  }
  return normalized;
}

function nullableRating(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function normalizeDebriefSaveInput(
  input: unknown,
  allowedPlayerIds: Iterable<string>
): { report_text: string | null; report_scope: CoachReportScope; reviews: CoachDebriefReview[] } {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const reportText = String(body.report_text ?? "").trim();
  if (reportText.length > COACH_REPORT_MAX_LENGTH) {
    throw new CoachDebriefValidationError("report_too_long", "The session report is too long.");
  }

  const reportScope = String(body.report_scope ?? "mixed") as CoachReportScope;
  if (!["collective", "individual", "mixed"].includes(reportScope)) {
    throw new CoachDebriefValidationError("invalid_report_scope", "The report scope is invalid.");
  }

  const allowed = new Set(Array.from(allowedPlayerIds, (id) => String(id)));
  const rawReviews = Array.isArray(body.reviews) ? body.reviews : [];
  if (rawReviews.length !== allowed.size) {
    throw new CoachDebriefValidationError("all_attendees_required", "Every player needs an attendance status.");
  }

  const seen = new Set<string>();
  const reviews = rawReviews.map((raw) => {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const playerId = requiredUuid(row.player_id, "player_id");
    if (!allowed.has(playerId) || seen.has(playerId)) {
      throw new CoachDebriefValidationError("invalid_player", "A player is duplicated or is not part of the session.");
    }
    seen.add(playerId);

    const status = String(row.status ?? "") as CoachAttendanceStatus;
    if (status !== "present" && status !== "absent") {
      throw new CoachDebriefValidationError("attendance_required", "Every player needs an attendance status.");
    }

    const engagement = nullableRating(row.engagement);
    const attitude = nullableRating(row.attitude);
    const performance = nullableRating(row.performance);
    const ratings = [engagement, attitude, performance];
    if (
      status === "present" &&
      ratings.some((rating) => rating == null || rating < COACH_RATING_MIN || rating > COACH_RATING_MAX)
    ) {
      throw new CoachDebriefValidationError("ratings_required", "Present players need all three ratings.");
    }

    return {
      player_id: playerId,
      status,
      engagement: status === "present" ? engagement : null,
      attitude: status === "present" ? attitude : null,
      performance: status === "present" ? performance : null,
    };
  });

  return {
    report_text: reportText || null,
    report_scope: reportScope,
    reviews,
  };
}

export function normalizePrivateNoteProposals(
  input: unknown,
  presentPlayerIds: Iterable<string>
): CoachPrivateNoteProposal[] {
  const present = new Set(Array.from(presentPlayerIds, (id) => String(id)));
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawProposals = Array.isArray(body.proposals) ? body.proposals : [];
  if (rawProposals.length === 0 || rawProposals.length > 50) {
    throw new CoachDebriefValidationError("invalid_proposals", "Select at least one valid proposal.");
  }

  return rawProposals.map((raw) => {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const playerId = requiredUuid(row.player_id, "player_id");
    const text = String(row.text ?? "").trim();
    if (!present.has(playerId)) {
      throw new CoachDebriefValidationError("player_not_present", "Private notes can only target present players.");
    }
    if (!text || text.length > COACH_PRIVATE_NOTE_MAX_LENGTH) {
      throw new CoachDebriefValidationError("invalid_note", "A private note is empty or too long.");
    }
    return { player_id: playerId, text };
  });
}
