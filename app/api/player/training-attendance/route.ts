import { notifyPlayerAttendance } from "@/lib/server/playerAttendanceNotifications";
import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { changePastTrainingAttendance, readPastTrainingAttendanceState } from "@/lib/server/playerTrainingAttendance";
import { legalNoStore } from "@/lib/server/legalAccess";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = String(body?.eventId ?? "").trim();
    const nextStatus = body?.status;
    if (!eventId || (nextStatus !== "present" && nextStatus !== "absent"))
      return NextResponse.json({ error: "Invalid attendance change" }, { status: 400, headers: legalNoStore });
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: new URL(req.url).searchParams.get("child_id"),
      requestedOrganizationId: requestedOrganizationId(req.url),
      mode: "edit",
    });
    const state = await readPastTrainingAttendanceState(access, eventId, { allowUpcoming: true });
    if (!state) return NextResponse.json({ error: "Not found" }, { status: 404, headers: legalNoStore });
    if (!state.canChange) return NextResponse.json({ error: "Attendance can no longer be changed" }, { status: 409, headers: legalNoStore });
    const status = await changePastTrainingAttendance(access, state, nextStatus);
    if (status == null) return NextResponse.json({ error: "Attendance changed in the meantime" }, { status: 409, headers: legalNoStore });
    let notificationWarning = false;
    if (state.status !== status) {
      try {
        const result = await notifyPlayerAttendance(access.supabaseAdmin, { actorId: access.actorUserId,
          playerId: access.subjectPlayerId, eventId: state.eventId, status });
        notificationWarning = Boolean(result?.failed);
      } catch { notificationWarning = true; }
    }
    return NextResponse.json({ status, canChange: true, notificationWarning }, { headers: legalNoStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update attendance" },
      { status: playerAccessErrorStatus(error), headers: legalNoStore });
  }
}
