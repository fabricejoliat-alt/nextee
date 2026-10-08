import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCampCoachPlayerAccess, resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";
import {
  buildPlayerDocumentObjectPath,
  issuePlayerDocumentUploadReservation,
  isOwnedPlayerDocumentPath,
  verifyPlayerDocumentUploadReservation,
} from "@/lib/playerDocumentUpload";
import { PLAYER_DOCUMENT_BUCKET, validatePlayerDocumentFile } from "@/lib/playerDocumentPolicy";
import {
  discardPlayerDocumentUploadReservation,
  finalizePlayerDocumentUploadReservation,
  inspectUploadedPlayerDocument,
  persistPlayerDocumentUploadReservation,
  requirePendingPlayerDocumentUploadReservation,
  signPlayerDocumentRows,
  validatePlayerDocumentEventLink,
  removePlayerDocumentObject,
} from "@/lib/playerDocumentStorage";

function uploadReservationSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return secret;
}

async function resolveUploaderName(supabaseAdmin: any, callerId: string) {
  let uploadedByName = callerId.slice(0, 8);
  const uploaderRes = await supabaseAdmin
    .from("profiles")
    .select("first_name,last_name,username")
    .eq("id", callerId)
    .maybeSingle();
  if (!uploaderRes.error && uploaderRes.data) {
    const full = `${String((uploaderRes.data as any).first_name ?? "").trim()} ${String((uploaderRes.data as any).last_name ?? "").trim()}`.trim();
    uploadedByName = full || String((uploaderRes.data as any).username ?? "").trim() || uploadedByName;
  }
  return uploadedByName;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId,requestedOrganizationId(req.url));
    const url = new URL(req.url);
    const requestedEventId = String(url.searchParams.get("club_event_id") ?? "").trim();
    const campAccess = requestedEventId
      ? await resolveCampCoachPlayerAccess(supabaseAdmin, callerId, playerId, requestedEventId)
      : { allowed: false, clubId: null };
    const allowedSharedClubIds = Array.from(
      new Set([
        ...access.sensitiveClubIds,
        ...(campAccess.allowed && campAccess.clubId ? [campAccess.clubId] : []),
      ])
    );
    const canAccessDocuments = (access.sensitiveClubIds.length > 0 && access.canAccessSensitiveSections) || campAccess.allowed;
    if (allowedSharedClubIds.length === 0 || !canAccessDocuments) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let docsQuery = supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_bucket,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
      .eq("player_id", playerId)
      .in("organization_id", allowedSharedClubIds)
      .order("created_at", { ascending: false });
    if (requestedEventId) docsQuery = docsQuery.eq("club_event_id", requestedEventId);
    const docsRes = await docsQuery.limit(200);
    if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 400 });

    const uploaderIds = Array.from(
      new Set((docsRes.data ?? []).map((d: any) => String(d.uploaded_by ?? "")).filter(Boolean))
    );
    const uploaderNameById = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const profRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", uploaderIds);
      if (!profRes.error) {
        for (const p of profRes.data ?? []) {
          const id = String((p as any).id ?? "");
          const full = `${String((p as any).first_name ?? "").trim()} ${String((p as any).last_name ?? "").trim()}`.trim();
          const fallback = String((p as any).username ?? "").trim();
          uploaderNameById.set(id, full || fallback || id.slice(0, 8));
        }
      }
    }

    const linkedEventIds = Array.from(
      new Set((docsRes.data ?? []).map((d: any) => String(d.club_event_id ?? "")).filter(Boolean))
    );
    const eventMetaById = new Map<string, { group_id: string | null }>();
    if (linkedEventIds.length > 0) {
      const eventRes = await supabaseAdmin.from("club_events").select("id,group_id").in("id", linkedEventIds);
      if (!eventRes.error) {
        for (const ev of eventRes.data ?? []) {
          eventMetaById.set(String((ev as any).id ?? ""), {
            group_id: String((ev as any).group_id ?? "").trim() || null,
          });
        }
      }
    }

    const docsWithNames = (docsRes.data ?? []).map((d: any) => ({
      ...d,
      uploaded_by_name: uploaderNameById.get(String(d.uploaded_by ?? "")) ?? String(d.uploaded_by ?? "").slice(0, 8),
      linked_event_group_id: eventMetaById.get(String(d.club_event_id ?? ""))?.group_id ?? null,
    }));
    const docs = await signPlayerDocumentRows(supabaseAdmin, docsWithNames);
    return NextResponse.json({ documents: docs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId,requestedOrganizationId(req.url));

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as {
        action?: string | null;
        organization_id?: string | null;
        coach_only?: boolean | string | null;
        club_event_id?: string | null;
        original_name?: string | null;
        file_name?: string | null;
        mime_type?: string | null;
        size_bytes?: number | string | null;
        storage_path?: string | null;
        reservation_token?: string | null;
      };

      const action = String(body?.action ?? "").trim();
      const sizeBytes = Number(body?.size_bytes ?? 0);
      const originalName = String(body?.original_name ?? "").trim();
      const requestedMimeType = String(body?.mime_type ?? "").trim();
      const organizationIdFromBody = String(body?.organization_id ?? "").trim();
      const coachOnlyFromBody = String(body?.coach_only ?? "false").trim() === "true";
      const clubEventIdFromBody = String(body?.club_event_id ?? "").trim() || null;
      const campAccess = clubEventIdFromBody
        ? await resolveCampCoachPlayerAccess(supabaseAdmin, callerId, playerId, clubEventIdFromBody)
        : { allowed: false, clubId: null };
      const allowedSharedClubIds = Array.from(
        new Set([
          ...access.sensitiveClubIds,
          ...(campAccess.allowed && campAccess.clubId ? [campAccess.clubId] : []),
        ])
      );
      const canAccessDocuments = (access.sensitiveClubIds.length > 0 && access.canAccessSensitiveSections) || campAccess.allowed;
      if (!canAccessDocuments) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!organizationIdFromBody || !allowedSharedClubIds.includes(organizationIdFromBody)) {
        return NextResponse.json({ error: "Invalid organization_id" }, { status: 400 });
      }
      if (!originalName) return NextResponse.json({ error: "Missing original_name" }, { status: 400 });
      const fileValidation = validatePlayerDocumentFile({
        fileName: originalName,
        mimeType: requestedMimeType,
        sizeBytes,
      });
      if (fileValidation.ok === false) return NextResponse.json({ error: fileValidation.error }, { status: 400 });
      const mimeType = fileValidation.mimeType;

      if (action === "prepare") {
        const eventError = await validatePlayerDocumentEventLink(
          supabaseAdmin,
          organizationIdFromBody,
          playerId,
          clubEventIdFromBody
        );
        if (eventError) return NextResponse.json({ error: eventError }, { status: 400 });
        const objectPath = buildPlayerDocumentObjectPath(
          organizationIdFromBody,
          playerId,
          originalName
        );
        const signedRes = await supabaseAdmin.storage.from(PLAYER_DOCUMENT_BUCKET).createSignedUploadUrl(objectPath);
        if (signedRes.error) return NextResponse.json({ error: signedRes.error.message }, { status: 400 });
        const issuedReservation = issuePlayerDocumentUploadReservation(
          {
            bucket: PLAYER_DOCUMENT_BUCKET,
            storagePath: objectPath,
            organizationId: organizationIdFromBody,
            playerId,
            uploadedBy: callerId,
            originalName,
            mimeType,
            sizeBytes,
            clubEventId: clubEventIdFromBody,
            coachOnly: coachOnlyFromBody,
          },
          uploadReservationSecret()
        );
        await persistPlayerDocumentUploadReservation(supabaseAdmin, issuedReservation.reservation);
        return NextResponse.json({
          bucket: PLAYER_DOCUMENT_BUCKET,
          path: objectPath,
          token: String((signedRes.data as any)?.token ?? ""),
          reservation_token: issuedReservation.token,
          mime_type: mimeType,
          max_bytes: fileValidation.maxBytes,
        });
      }

      if (action === "finalize") {
        const storagePath = String(body?.storage_path ?? "").trim();
        const providedName = String(body?.file_name ?? "").trim();
        const reservationToken = String(body?.reservation_token ?? "").trim();
        if (!storagePath) return NextResponse.json({ error: "Missing storage_path" }, { status: 400 });
        if (!reservationToken) return NextResponse.json({ error: "Missing reservation_token" }, { status: 400 });
        if (!isOwnedPlayerDocumentPath(storagePath, organizationIdFromBody, playerId)) {
          return NextResponse.json({ error: "Invalid storage_path" }, { status: 403 });
        }

        const reservation = verifyPlayerDocumentUploadReservation(
          reservationToken,
          {
            bucket: PLAYER_DOCUMENT_BUCKET,
            storagePath,
            organizationId: organizationIdFromBody,
            playerId,
            uploadedBy: callerId,
            originalName,
            mimeType,
            sizeBytes,
            clubEventId: clubEventIdFromBody,
            coachOnly: coachOnlyFromBody,
          },
          uploadReservationSecret()
        );
        if (reservation.ok === false) {
          return NextResponse.json({ error: reservation.error }, { status: 403 });
        }
        const persistedReservationError = await requirePendingPlayerDocumentUploadReservation(
          supabaseAdmin,
          reservation.reservation
        );
        if (persistedReservationError) {
          return NextResponse.json({ error: persistedReservationError }, { status: 409 });
        }
        const eventError = await validatePlayerDocumentEventLink(
          supabaseAdmin,
          organizationIdFromBody,
          playerId,
          clubEventIdFromBody
        );
        if (eventError) return NextResponse.json({ error: eventError }, { status: 400 });

        const inspection = await inspectUploadedPlayerDocument(supabaseAdmin, {
          bucket: PLAYER_DOCUMENT_BUCKET,
          storagePath,
          originalName,
          mimeType,
          sizeBytes,
        });
        if (inspection.ok === false) {
          if (inspection.cleanup) {
            const cleanupError = await removePlayerDocumentObject(
              supabaseAdmin,
              PLAYER_DOCUMENT_BUCKET,
              storagePath
            );
            if (!cleanupError) {
              await discardPlayerDocumentUploadReservation(
                supabaseAdmin,
                reservation.reservation.reservationId
              ).catch(() => undefined);
            }
          }
          return NextResponse.json({ error: inspection.error }, { status: 400 });
        }

        const duplicateRes = await supabaseAdmin
          .from("player_dashboard_documents")
          .select("id")
          .eq("storage_bucket", PLAYER_DOCUMENT_BUCKET)
          .eq("storage_path", storagePath)
          .limit(1)
          .maybeSingle();
        if (duplicateRes.error) return NextResponse.json({ error: duplicateRes.error.message }, { status: 400 });
        if (duplicateRes.data?.id) {
          return NextResponse.json({ error: "Upload already finalized" }, { status: 409 });
        }

        const insRes = await supabaseAdmin
          .from("player_dashboard_documents")
          .insert({
            organization_id: organizationIdFromBody,
            player_id: playerId,
            uploaded_by: callerId,
            file_name: providedName || originalName || "document",
            storage_bucket: PLAYER_DOCUMENT_BUCKET,
            storage_path: storagePath,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            coach_only: coachOnlyFromBody,
            club_event_id: clubEventIdFromBody,
          })
          .select("id,organization_id,player_id,uploaded_by,file_name,storage_bucket,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
          .single();
        if (insRes.error) {
          if (String(insRes.error.code ?? "") === "23505") {
            return NextResponse.json({ error: "Upload already finalized" }, { status: 409 });
          }
          const cleanupError = await removePlayerDocumentObject(
            supabaseAdmin,
            PLAYER_DOCUMENT_BUCKET,
            storagePath
          );
          if (!cleanupError) {
            await discardPlayerDocumentUploadReservation(
              supabaseAdmin,
              reservation.reservation.reservationId
            ).catch(() => undefined);
          }
          return NextResponse.json({ error: insRes.error.message }, { status: 400 });
        }

        await finalizePlayerDocumentUploadReservation(
          supabaseAdmin,
          reservation.reservation.reservationId
        ).catch(() => undefined);
        const uploadedByName = await resolveUploaderName(supabaseAdmin, callerId);
        const [document] = await signPlayerDocumentRows(supabaseAdmin, [
          { ...insRes.data, uploaded_by_name: uploadedByName },
        ]);
        return NextResponse.json({ document });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Multipart uploads are disabled. Use the prepare/finalize flow." },
      { status: 415 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
