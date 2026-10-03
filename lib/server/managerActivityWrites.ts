import { createClient } from "@supabase/supabase-js";

/** Use the caller JWT: the SQL functions authorize auth.uid() inside the transaction. */
export function managerActivityClient(request: Request) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function managerActivityError(cause: { code?: string; message?: string }) {
  const key = cause.message ?? "";
  const known: Record<string, number> = {
    forbidden: 403, event_not_found: 404, competition_conflict: 409, creation_request_conflict: 409,
    evaluated_attendee_removal: 409, event_cancelled: 409,
    invalid_request: 400, invalid_event: 400, invalid_assignments: 400, invalid_competition: 400,
    invalid_competition_dates: 400, invalid_reminder: 400, invalid_criteria: 400, title_required: 400,
    invalid_recurrence: 400, no_occurrence: 400, too_many_occurrences: 400, too_many_groups: 400,
  };
  if (known[key]) return { status: known[key], error: key, outcome: "rejected" };
  if (cause.code?.startsWith("22")) return { status: 400, error: "invalid_event", outcome: "rejected" };
  if (cause.code === "42501") return { status: 403, error: "forbidden", outcome: "rejected" };
  // PostgREST can report transport failures after a commit: retain the retry key.
  if (["PGRST202", "42883"].includes(cause.code ?? "")) return { status: 503, error: "unavailable", outcome: "rejected" };
  return { status: 503, error: "unconfirmed", outcome: "unknown" };
}
