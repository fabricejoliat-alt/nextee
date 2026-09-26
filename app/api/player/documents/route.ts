import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCaller } from "@/app/api/messages/_lib";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";
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
  playerDocumentStorageBucket,
  removePlayerDocumentObject,
  requirePendingPlayerDocumentUploadReservation,
  signPlayerDocumentRows,
  validatePlayerDocumentEventLink,
} from "@/lib/playerDocumentStorage";

type ListedPlayerDocument = {
  storage_bucket: string | null;
  storage_path: string;
  uploaded_by: string | null;
  [key: string]: unknown;
};

type UploaderProfileRow = {
  id?: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
};

type DocumentOwnerRow = {
  player_id: string | null;
  uploaded_by: string | null;
};

type StoredDocumentRow = DocumentOwnerRow & {
  organization_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

function uploadReservationSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return secret;
}

async function resolveUploaderName(supabaseAdmin: SupabaseClient, callerId: string) {
  let uploadedByName = callerId.slice(0, 8);
  const uploaderRes = await supabaseAdmin
    .from("profiles")
    .select("first_name,last_name,username")
    .eq("id", callerId)
    .maybeSingle();
  if (!uploaderRes.error && uploaderRes.data) {
    const uploader = uploaderRes.data as UploaderProfileRow;
    const full = `${String(uploader.first_name ?? "").trim()} ${String(uploader.last_name ?? "").trim()}`.trim();
    uploadedByName = full || String(uploader.username ?? "").trim() || uploadedByName;
  }
  return uploadedByName;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requestedPlayerId = String(url.searchParams.get("player_id") ?? "").trim();
    const requestedChildId = String(url.searchParams.get("child_id") ?? "").trim();
    const requestedEventId = String(url.searchParams.get("club_event_id") ?? "").trim();
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: requestedPlayerId || requestedChildId,
      mode: "view",
    });
    const { supabaseAdmin } = access;
    const playerId = access.subjectPlayerId;

    let docsQuery = supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_bucket,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
      .eq("player_id", playerId)
      .or("coach_only.is.null,coach_only.eq.false")
      .order("created_at", { ascending: false });
    if (requestedEventId) docsQuery = docsQuery.eq("club_event_id", requestedEventId);
    const docsRes = await docsQuery.limit(200);
    if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 400 });
    const documentRows = (docsRes.data ?? []) as ListedPlayerDocument[];

    const uploaderIds = Array.from(
      new Set(documentRows.map((document) => String(document.uploaded_by ?? "")).filter(Boolean))
    );
    const uploaderNameById = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const profRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", uploaderIds);
      if (!profRes.error) {
        for (const profile of (profRes.data ?? []) as UploaderProfileRow[]) {
          const id = String(profile.id ?? "");
          const full = `${String(profile.first_name ?? "").trim()} ${String(profile.last_name ?? "").trim()}`.trim();
          const fallback = String(profile.username ?? "").trim();
          uploaderNameById.set(id, full || fallback || id.slice(0, 8));
        }
      }
    }

    const docsWithNames = documentRows.map((document) => ({
      ...document,
      uploaded_by_name:
        uploaderNameById.get(String(document.uploaded_by ?? "")) ??
        String(document.uploaded_by ?? "").slice(0, 8),
    }));
    const docs = await signPlayerDocumentRows(supabaseAdmin, docsWithNames);

    return NextResponse.json({ documents: docs });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const url = new URL(req.url);
    const requestedPlayerId = String(url.searchParams.get("player_id") ?? "").trim();
    const playerId = requestedPlayerId || callerId;
    if (!playerId) return NextResponse.json({ error: "Missing player_id" }, { status: 400 });
    if (callerId !== playerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const membershipRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", playerId)
      .eq("is_active", true)
      .eq("role", "player")
      .order("club_id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipRes.error) return NextResponse.json({ error: membershipRes.error.message }, { status: 400 });
    const organizationId = String(membershipRes.data?.club_id ?? "").trim();
    if (!organizationId) return NextResponse.json({ error: "Player has no active organization" }, { status: 400 });

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as {
        action?: string | null;
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
      if (!originalName) return NextResponse.json({ error: "Missing original_name" }, { status: 400 });
      const fileValidation = validatePlayerDocumentFile({
        fileName: originalName,
        mimeType: requestedMimeType,
        sizeBytes,
      });
      if (fileValidation.ok === false) return NextResponse.json({ error: fileValidation.error }, { status: 400 });
      const mimeType = fileValidation.mimeType;

      if (action === "prepare") {
        const clubEventId = String(body?.club_event_id ?? "").trim() || null;
        const eventError = await validatePlayerDocumentEventLink(
          supabaseAdmin,
          organizationId,
          playerId,
          clubEventId
        );
        if (eventError) return NextResponse.json({ error: eventError }, { status: 400 });
        const objectPath = buildPlayerDocumentObjectPath(organizationId, playerId, originalName);
        const signedRes = await supabaseAdmin.storage.from(PLAYER_DOCUMENT_BUCKET).createSignedUploadUrl(objectPath);
        if (signedRes.error) return NextResponse.json({ error: signedRes.error.message }, { status: 400 });
        const issuedReservation = issuePlayerDocumentUploadReservation(
          {
            bucket: PLAYER_DOCUMENT_BUCKET,
            storagePath: objectPath,
            organizationId,
            playerId,
            uploadedBy: callerId,
            originalName,
            mimeType,
            sizeBytes,
            clubEventId,
            coachOnly: false,
          },
          uploadReservationSecret()
        );
        await persistPlayerDocumentUploadReservation(supabaseAdmin, issuedReservation.reservation);
        return NextResponse.json({
          bucket: PLAYER_DOCUMENT_BUCKET,
          path: objectPath,
          token: String(signedRes.data?.token ?? ""),
          reservation_token: issuedReservation.token,
          mime_type: mimeType,
          max_bytes: fileValidation.maxBytes,
        });
      }

      if (action === "finalize") {
        const storagePath = String(body?.storage_path ?? "").trim();
        const providedName = String(body?.file_name ?? "").trim();
        const clubEventId = String(body?.club_event_id ?? "").trim() || null;
        const reservationToken = String(body?.reservation_token ?? "").trim();
        if (!storagePath) return NextResponse.json({ error: "Missing storage_path" }, { status: 400 });
        if (!reservationToken) return NextResponse.json({ error: "Missing reservation_token" }, { status: 400 });
        if (!isOwnedPlayerDocumentPath(storagePath, organizationId, playerId)) {
          return NextResponse.json({ error: "Invalid storage_path" }, { status: 403 });
        }

        const reservation = verifyPlayerDocumentUploadReservation(
          reservationToken,
          {
            bucket: PLAYER_DOCUMENT_BUCKET,
            storagePath,
            organizationId,
            playerId,
            uploadedBy: callerId,
            originalName,
            mimeType,
            sizeBytes,
            clubEventId,
            coachOnly: false,
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
          organizationId,
          playerId,
          clubEventId
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
            organization_id: organizationId,
            player_id: playerId,
            uploaded_by: callerId,
            file_name: providedName || originalName || "document",
            storage_bucket: PLAYER_DOCUMENT_BUCKET,
            storage_path: storagePath,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            coach_only: false,
            club_event_id: clubEventId,
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
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const body = (await req.json().catch(() => ({}))) as {
      document_id?: string | null;
      file_name?: string | null;
      player_id?: string | null;
    };

    const documentId = String(body?.document_id ?? "").trim();
    const nextName = String(body?.file_name ?? "").trim();
    const playerId = String(body?.player_id ?? callerId).trim();
    if (!documentId) return NextResponse.json({ error: "Missing document_id" }, { status: 400 });
    if (!nextName) return NextResponse.json({ error: "Missing file_name" }, { status: 400 });
    if (!playerId) return NextResponse.json({ error: "Missing player_id" }, { status: 400 });

    const docRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,player_id,uploaded_by")
      .eq("id", documentId)
      .maybeSingle();
    if (docRes.error) return NextResponse.json({ error: docRes.error.message }, { status: 400 });
    if (!docRes.data) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const documentOwner = docRes.data as DocumentOwnerRow;
    if (String(documentOwner.player_id ?? "") !== playerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String(documentOwner.uploaded_by ?? "") !== callerId) {
      return NextResponse.json({ error: "Only uploader can rename this document" }, { status: 403 });
    }

    const updRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .update({ file_name: nextName })
      .eq("id", documentId)
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_bucket,storage_path,mime_type,size_bytes,coach_only,created_at")
      .single();
    if (updRes.error) return NextResponse.json({ error: updRes.error.message }, { status: 400 });

    return NextResponse.json({ document: updRes.data });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const body = (await req.json().catch(() => ({}))) as {
      document_id?: string | null;
      player_id?: string | null;
    };

    const documentId = String(body?.document_id ?? "").trim();
    const playerId = String(body?.player_id ?? callerId).trim();
    if (!documentId) return NextResponse.json({ error: "Missing document_id" }, { status: 400 });
    if (!playerId) return NextResponse.json({ error: "Missing player_id" }, { status: 400 });

    const docRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,player_id,uploaded_by,storage_bucket,storage_path")
      .eq("id", documentId)
      .maybeSingle();
    if (docRes.error) return NextResponse.json({ error: docRes.error.message }, { status: 400 });
    if (!docRes.data) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const document = docRes.data as StoredDocumentRow;
    if (String(document.player_id ?? "") !== playerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String(document.uploaded_by ?? "") !== callerId) {
      return NextResponse.json({ error: "Only uploader can delete this document" }, { status: 403 });
    }

    const path = String(document.storage_path ?? "").trim();
    const organizationId = String(document.organization_id ?? "").trim();
    const storageBucket = playerDocumentStorageBucket(document.storage_bucket);
    if (!isOwnedPlayerDocumentPath(path, organizationId, playerId)) {
      return NextResponse.json({ error: "Invalid document storage path" }, { status: 409 });
    }
    const storageError = await removePlayerDocumentObject(supabaseAdmin, storageBucket, path);
    if (storageError) return NextResponse.json({ error: storageError }, { status: 502 });

    const delRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .delete()
      .eq("id", documentId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, id: documentId });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
