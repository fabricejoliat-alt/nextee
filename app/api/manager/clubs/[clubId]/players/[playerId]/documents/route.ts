import { NextResponse, type NextRequest } from "next/server";
import { performanceContext } from "@/app/api/manager/clubs/[clubId]/performance/_lib";
import { activeClubMember } from "@/lib/server/managerAccess";
import { canReadPlayerHistory } from "@/lib/server/personalHistoryAccess";
import { readAllRows, readRelatedRows } from "@/lib/server/paginatedRead";
import { signPlayerDocumentRows } from "@/lib/playerDocumentStorage";

type Document = { id: string; organization_id: string; player_id: string; uploaded_by: string | null; file_name: string; storage_bucket: string | null; storage_path: string; mime_type: string | null; size_bytes: number | null; coach_only: boolean; club_event_id: string | null; created_at: string };
type Event = { id: string; title: string | null; starts_at: string };
type Uploader = { id: string; first_name: string | null; last_name: string | null; username: string | null };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

export async function GET(req: NextRequest, context: { params: Promise<{ clubId: string; playerId: string }> }) {
  try {
    const { clubId, playerId } = await context.params;
    const access = await performanceContext(req, clubId);
    if (!access.ok) return reply({ error: access.error }, access.status);
    if (!(await activeClubMember(access.db, clubId, playerId, "player"))) return reply({ error: "manager.junior.documents.unavailable" }, 404);
    if (!(await canReadPlayerHistory(access.db, access.callerId, playerId, clubId))) return reply({ error: "Forbidden" }, 403);

    // Document access remains limited to the selected organization, regardless of the statistics filter.
    const documents = await readAllRows<Document>((from, to) => access.db.from("player_dashboard_documents")
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_bucket,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
      .eq("organization_id", clubId).eq("player_id", playerId).order("created_at", { ascending: false }).order("id").range(from, to));
    const [events, uploaders] = await Promise.all([
      readRelatedRows<Event>(documents.map(row => row.club_event_id).filter((id): id is string => Boolean(id)), (ids, from, to) => access.db.from("club_events")
        .select("id,title,starts_at").eq("club_id", clubId).in("id", ids).order("id").range(from, to)),
      readRelatedRows<Uploader>(documents.map(row => row.uploaded_by).filter((id): id is string => Boolean(id)), (ids, from, to) => access.db.from("profiles")
        .select("id,first_name,last_name,username").in("id", ids).order("id").range(from, to)),
    ]);
    const eventMap = new Map(events.map(event => [event.id, event]));
    const uploaderMap = new Map(uploaders.map(uploader => [uploader.id, `${uploader.first_name ?? ""} ${uploader.last_name ?? ""}`.trim() || uploader.username || null]));
    const signed = await signPlayerDocumentRows(access.db, documents);
    return reply({ documents: signed.map(row => ({
      id: row.id, file_name: row.file_name, mime_type: row.mime_type, size_bytes: row.size_bytes, created_at: row.created_at,
      coach_only: row.coach_only, uploaded_by_name: uploaderMap.get(row.uploaded_by ?? "") ?? null,
      event: eventMap.get(row.club_event_id ?? "") ?? null, url: row.signed_url, url_expires_at: row.url_expires_at,
    })) });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "manager.junior.documents.loadError" }, error instanceof Error && error.message === "Invalid token" ? 401 : 500);
  }
}
