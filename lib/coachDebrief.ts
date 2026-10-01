export const COACH_RATING_MIN = 1;
export const COACH_RATING_MAX = 6;
export const COACH_REPORT_MAX_LENGTH = 10_000;
export const COACH_PRIVATE_NOTE_MAX_LENGTH = 4_000;

export type CoachAttendanceStatus = "present" | "absent";
export type CoachReportScope = "collective" | "individual";
export type CoachIndividualComments = Record<string, string>;

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

export type CoachAiPrivateNoteProposal = CoachPrivateNoteProposal & {
  rationale: string;
  confidence: "high" | "medium";
};

export type CoachDebriefSaveInput = {
  report_text: string | null;
  report_scope: CoachReportScope;
  collective_summary_text: string | null;
  individual_comments: CoachIndividualComments;
  reviews: CoachDebriefReview[];
};

export type CoachPlayerEvaluationInput = {
  player_id: string;
  status: CoachAttendanceStatus;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  player_note: string;
  private_note: string | null;
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

export function normalizeCoachPlayerEvaluationInput(input: unknown): CoachPlayerEvaluationInput {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const playerId = requiredUuid(body.player_id, "player_id");
  const status = String(body.status ?? "") as CoachAttendanceStatus;
  if (status !== "present" && status !== "absent") {
    throw new CoachDebriefValidationError("attendance_required", "Choose present or absent for this player.");
  }

  const engagement = nullableRating(body.engagement);
  const attitude = nullableRating(body.attitude);
  const performance = nullableRating(body.performance);
  const ratings = [engagement, attitude, performance];
  if (
    status === "present" &&
    ratings.some((rating) => rating == null || rating < COACH_RATING_MIN || rating > COACH_RATING_MAX)
  ) {
    throw new CoachDebriefValidationError("ratings_required", "Present players need all three ratings.");
  }

  const playerNote = status === "present"
    ? String(body.player_note ?? body.source_text ?? "").trim()
    : "";
  if (playerNote.length > COACH_PRIVATE_NOTE_MAX_LENGTH) {
    throw new CoachDebriefValidationError("individual_comment_too_long", "The individual comment is too long.");
  }

  const privateNote = status === "present" ? String(body.private_note ?? "").trim() : "";
  if (privateNote.length > COACH_PRIVATE_NOTE_MAX_LENGTH) {
    throw new CoachDebriefValidationError("invalid_note", "The private note is too long.");
  }
  return {
    player_id: playerId,
    status,
    engagement: status === "present" ? engagement : null,
    attitude: status === "present" ? attitude : null,
    performance: status === "present" ? performance : null,
    player_note: playerNote,
    private_note: privateNote || null,
  };
}

export function needsCoachPlayerEvaluation(
  recordedStatus: CoachAttendanceStatus | null,
  ratings: Array<number | null>
) {
  if (recordedStatus === "absent") return false;
  if (recordedStatus !== "present") return true;
  return ratings.some(
    (rating) => rating == null || !Number.isInteger(rating) || rating < COACH_RATING_MIN || rating > COACH_RATING_MAX
  );
}

export function normalizeDebriefSaveInput(
  input: unknown,
  allowedPlayerIds: Iterable<string>
): CoachDebriefSaveInput {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const reportText = String(body.report_text ?? "").trim();
  if (reportText.length > COACH_REPORT_MAX_LENGTH) {
    throw new CoachDebriefValidationError("report_too_long", "The session report is too long.");
  }

  const rawScope = String(body.report_scope ?? "collective");
  const reportScope: CoachReportScope = rawScope === "individual" ? "individual" : "collective";
  if (!["collective", "individual", "mixed", ""].includes(rawScope)) {
    throw new CoachDebriefValidationError("invalid_report_scope", "The report scope is invalid.");
  }

  const collectiveSummaryText = String(body.collective_summary_text ?? "").trim();
  if (collectiveSummaryText.length > COACH_REPORT_MAX_LENGTH) {
    throw new CoachDebriefValidationError("collective_summary_too_long", "The collective summary is too long.");
  }

  const allowed = new Set(Array.from(allowedPlayerIds, (id) => String(id)));
  const rawIndividualComments =
    body.individual_comments && typeof body.individual_comments === "object" && !Array.isArray(body.individual_comments)
      ? (body.individual_comments as Record<string, unknown>)
      : {};
  const individualComments: CoachIndividualComments = {};
  for (const [rawPlayerId, rawComment] of Object.entries(rawIndividualComments)) {
    const playerId = requiredUuid(rawPlayerId, "individual_comments.player_id");
    if (!allowed.has(playerId)) {
      throw new CoachDebriefValidationError("invalid_player", "An individual comment targets a player outside the session.");
    }
    const comment = String(rawComment ?? "").trim();
    if (comment.length > COACH_PRIVATE_NOTE_MAX_LENGTH) {
      throw new CoachDebriefValidationError("individual_comment_too_long", "An individual comment is too long.");
    }
    if (comment) individualComments[playerId] = comment;
  }

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
    collective_summary_text: collectiveSummaryText || null,
    individual_comments: individualComments,
    reviews,
  };
}

export function hasAnalyzableDebriefSource(
  scope: CoachReportScope,
  reportText: string | null,
  individualComments: CoachIndividualComments,
  presentPlayerIds: Iterable<string>
) {
  if (scope === "collective") return String(reportText ?? "").trim().length > 0;
  return Array.from(presentPlayerIds).some((playerId) => String(individualComments[playerId] ?? "").trim().length > 0);
}

export function normalizeCoachDebriefAnalysis(
  input: unknown,
  scope: CoachReportScope,
  presentPlayerIds: Iterable<string>
): { collectiveSummary: string; proposals: CoachAiPrivateNoteProposal[] } {
  const parsed = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const present = new Set(Array.from(presentPlayerIds, (id) => String(id)));
  const rawProposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  const proposals = rawProposals
    .map((raw) => {
      const proposal = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        player_id: String(proposal.player_id ?? "").trim(),
        text: String(proposal.text ?? "").trim(),
        rationale: String(proposal.rationale ?? "").trim(),
        confidence: proposal.confidence === "high" ? ("high" as const) : ("medium" as const),
      };
    })
    .filter(
      (proposal) =>
        present.has(proposal.player_id) &&
        proposal.text.length > 0 &&
        proposal.text.length <= COACH_PRIVATE_NOTE_MAX_LENGTH
    );

  return {
    collectiveSummary:
      scope === "collective"
        ? String(parsed.collective_summary ?? "").trim().slice(0, COACH_REPORT_MAX_LENGTH)
        : "",
    proposals,
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
