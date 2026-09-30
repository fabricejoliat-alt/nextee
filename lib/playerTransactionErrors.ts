export type PlayerTransactionError = {
  error: string;
  status: number;
};

const TRANSACTION_ERRORS: Record<string, PlayerTransactionError> = {
  FORBIDDEN: { error: "Forbidden", status: 403 },
  PLAYER_MEMBERSHIP_REQUIRED: { error: "Aucune adhésion joueur active n’a été trouvée.", status: 409 },
  PLAYER_CONSENT_REQUIRED: { error: "Le consentement du joueur doit être validé avant cette action.", status: 403 },
  ROUND_NOT_FOUND: { error: "Cette partie n’existe plus ou n’est plus accessible.", status: 404 },
  CAMP_NOT_FOUND: { error: "Stage introuvable.", status: 404 },
  CAMP_NOT_AVAILABLE: { error: "Ce stage n’est pas disponible pour une inscription.", status: 409 },
  CAMP_PLAYER_NOT_FOUND: { error: "Le joueur ne fait pas partie de ce stage.", status: 403 },
  CAMP_CAPACITY_EXCEEDED: { error: "La capacité maximale du stage est atteinte.", status: 409 },
  CAMP_DAY_NOT_FOUND: { error: "Journée de stage introuvable.", status: 404 },
  CAMP_REGISTRATION_REQUIRED: { error: "Inscription au stage requise.", status: 409 },
  CAMP_OPTION_NOT_FOUND: { error: "Option de stage introuvable.", status: 404 },
  CAMP_OPTION_UNAVAILABLE: { error: "Cette option n’est plus disponible.", status: 409 },
  CAMP_OPTION_CAPACITY_EXCEEDED: {
    error: "La capacité disponible pour cette option est dépassée.",
    status: 409,
  },
  INVALID_OPTION_VALUE: { error: "La valeur choisie pour cette option est invalide.", status: 400 },
  INVALID_OPTION_QUANTITY: { error: "La quantité doit être un nombre entier positif.", status: 400 },
  INVALID_ATTENDANCE_STATUS: { error: "Statut de présence invalide.", status: 400 },
  INVALID_ROUND_PAYLOAD: { error: "Les données de la partie sont invalides.", status: 400 },
  INVALID_ROUND_DATES: { error: "Les dates des tours sont invalides.", status: 400 },
  INVALID_TOURNAMENT_ROUND_COUNT: { error: "Le nombre de parties doit être modifié pour toute la compétition.", status: 409 },
  TOURNAMENT_GROUP_IMMUTABLE: { error: "Cette partie ne peut pas être déplacée vers une autre compétition.", status: 409 },
  ROUND_CREATION_FAILED: { error: "La création complète de la compétition a échoué.", status: 409 },
  INVALID_HOLES_PAYLOAD: { error: "Les données des trous sont invalides.", status: 400 },
  INVALID_HOLE_PAYLOAD: { error: "Les données du trou sont invalides.", status: 400 },
};

export function mapPlayerTransactionError(
  cause: unknown,
  fallback = "La mise à jour a échoué.",
): PlayerTransactionError {
  const rawMessage =
    typeof cause === "string"
      ? cause
      : cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message?: unknown }).message ?? "")
        : "";

  for (const [code, mapped] of Object.entries(TRANSACTION_ERRORS)) {
    if (rawMessage.includes(code)) return mapped;
  }

  return { error: rawMessage.trim() || fallback, status: 400 };
}
