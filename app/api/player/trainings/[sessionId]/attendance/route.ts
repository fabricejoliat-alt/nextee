import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { changePastTrainingAttendance, readPastTrainingAttendanceState } from "@/lib/server/playerTrainingAttendance";

type Access = Awaited<ReturnType<typeof resolveAuthenticatedPlayerAccess>>;
const noStore = { "Cache-Control": "private, no-store" };

async function readState(access: Access, sessionId: string) {
  const sessionResult = await access.supabaseAdmin.from("training_sessions")
    .select("club_event_id").eq("id", sessionId).eq("user_id", access.subjectPlayerId).maybeSingle();
  if (sessionResult.error) throw sessionResult.error;
  const eventId = sessionResult.data?.club_event_id;
  return eventId ? readPastTrainingAttendanceState(access, eventId) : null;
}

async function authorize(req: NextRequest, mode: "view" | "edit") {
  return resolveAuthenticatedPlayerAccess({
    accessToken: bearerTokenFromRequest(req),
    requestedPlayerId: new URL(req.url).searchParams.get("child_id"),
    requestedOrganizationId: requestedOrganizationId(req.url),
    mode,
  });
}

export async function GET(req: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const access = await authorize(req, "edit");
    const { sessionId } = await context.params;
    const state = await readState(access, sessionId);
    if (!state) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
    return NextResponse.json({ status: state.status, canChange: state.canChange }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load attendance" },
      { status: playerAccessErrorStatus(error), headers: noStore });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const access = await authorize(req, "edit");
    const { sessionId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const nextStatus = body?.status;
    if (nextStatus !== "present" && nextStatus !== "absent")
      return NextResponse.json({ error: "Invalid attendance status" }, { status: 400, headers: noStore });
    const state = await readState(access, sessionId);
    if (!state) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
    if (!state.canChange) return NextResponse.json({ error: "Attendance can no longer be changed" }, { status: 409, headers: noStore });
    const status = await changePastTrainingAttendance(access, state, nextStatus);
    if (status == null) return NextResponse.json({ error: "Attendance changed in the meantime" }, { status: 409, headers: noStore });
    return NextResponse.json({ status: status, canChange: true }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update attendance" },
      { status: playerAccessErrorStatus(error), headers: noStore });
  }
}
