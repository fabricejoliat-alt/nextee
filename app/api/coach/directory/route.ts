import { NextResponse, type NextRequest } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { uuidPattern } from "@/lib/server/organizationAccess";
import { loadCoachDirectory } from "@/lib/server/coachDirectory";

export async function GET(req: NextRequest) {
  const started = performance.now();
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: {
    ...legalNoStore, "Server-Timing": `directory;dur=${(performance.now() - started).toFixed(1)}`,
  } });
  try {
    if (!req.headers.get("authorization")?.match(/^Bearer\s+\S+/i)) return reply({ code: "unauthorized" }, 401);
    const view = req.nextUrl.searchParams.get("view");
    const organizationId = requestedOrganizationId(req.url);
    if ((view !== "groups" && view !== "players") || (organizationId && !uuidPattern.test(organizationId))) return reply({ code: "invalid_request" }, 400);
    const db = legalDb();
    const actor = await legalActor(req, db);
    if (!actor) return reply({ code: "unauthorized" }, 401);
    return reply(await loadCoachDirectory(db, actor.id, view, organizationId));
  } catch {
    return reply({ code: "directory_load_failed" }, 500);
  }
}
