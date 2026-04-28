export type ValidationBadge = "none" | "bronze" | "silver" | "gold" | "elite";

export type ValidationAttemptItem = {
  id: string;
  attempted_at: string;
  result: "success" | "failure";
  note: string | null;
};

export type ValidationExerciseItem = {
  id: string;
  section_id: string;
  external_code: string | null;
  sequence_no: number;
  level: number | null;
  name: string;
  objective: string | null;
  short_description: string | null;
  detailed_description: string | null;
  equipment: string | null;
  validation_rule_text: string | null;
  illustration_url: string | null;
  is_active: boolean;
  is_validated: boolean;
  is_unlocked: boolean;
  attempts: ValidationAttemptItem[];
};

export type ValidationSectionItem = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  validated_count: number;
  total_count: number;
  badge: ValidationBadge;
  exercises: ValidationExerciseItem[];
};

export type ValidationDashboardPayload = {
  viewer_user_id: string;
  effective_player_id: string;
  can_record_attempts: boolean;
  overall_validated_count: number;
  overall_total_count: number;
  overall_badge: ValidationBadge;
  sections: ValidationSectionItem[];
};

export function getValidationBadge(validatedCount: number, totalCount: number): ValidationBadge {
  if (totalCount > 0 && validatedCount >= totalCount) return "elite";
  if (validatedCount >= 13) return "gold";
  if (validatedCount >= 10) return "silver";
  if (validatedCount >= 5) return "bronze";
  return "none";
}

export function getValidationBadgeLabel(locale: string, badge: ValidationBadge) {
  if (badge === "elite") return locale === "fr" ? "Elite" : "Elite";
  if (badge === "gold") return locale === "fr" ? "Or" : "Gold";
  if (badge === "silver") return locale === "fr" ? "Argent" : "Silver";
  if (badge === "bronze") return locale === "fr" ? "Bronze" : "Bronze";
  return locale === "fr" ? "Aucun badge" : "No badge";
}

export function getValidationBadgeColors(badge: ValidationBadge) {
  if (badge === "elite") {
    return {
      background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(45,212,191,0.88))",
      color: "#ffffff",
    };
  }
  if (badge === "gold") {
    return {
      background: "linear-gradient(135deg, rgba(217,119,6,0.94), rgba(251,191,36,0.88))",
      color: "#ffffff",
    };
  }
  if (badge === "silver") {
    return {
      background: "linear-gradient(135deg, rgba(71,85,105,0.94), rgba(203,213,225,0.92))",
      color: "#ffffff",
    };
  }
  if (badge === "bronze") {
    return {
      background: "linear-gradient(135deg, rgba(146,64,14,0.94), rgba(251,146,60,0.9))",
      color: "#ffffff",
    };
  }
  return {
    background: "rgba(255,255,255,0.86)",
    color: "rgba(15,23,42,0.72)",
  };
}
