/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { removePlayerDocumentObject } from "@/lib/playerDocumentStorage";
import { DOCUMENT_UPLOAD_CLEANUP_GRACE_MS } from "@/lib/playerDocumentUpload";

export const runtime = "nodejs";

function authorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && req.headers.get("authorization") === `Bearer ${expected}`);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase environment missing" }, { status: 500 });

  const db = createClient(url, key, { auth: { persistSession: false } });
  const expiredRes = await db
    .from("player_document_upload_reservations")
    .select("id,storage_bucket,storage_path")
    .lt("expires_at", new Date(Date.now() - DOCUMENT_UPLOAD_CLEANUP_GRACE_MS).toISOString())
    .order("expires_at", { ascending: true })
    .limit(200);
  if (expiredRes.error) return NextResponse.json({ error: expiredRes.error.message }, { status: 500 });

  let removedObjects = 0;
  let reconciledReservations = 0;
  let processedDeletionQueue = 0;
  let reconciledDeletionQueue = 0;
  const failures: Array<{ scope: "reservation" | "deletion"; id: string; error: string }> = [];

  for (const reservation of expiredRes.data ?? []) {
    const reservationId = String((reservation as any).id ?? "");
    const bucket = String((reservation as any).storage_bucket ?? "");
    const storagePath = String((reservation as any).storage_path ?? "");
    try {
      const documentRes = await db
        .from("player_dashboard_documents")
        .select("id")
        .eq("storage_bucket", bucket)
        .eq("storage_path", storagePath)
        .limit(1)
        .maybeSingle();
      if (documentRes.error) throw new Error(documentRes.error.message);

      if (documentRes.data?.id) {
        const deleteRes = await db
          .from("player_document_upload_reservations")
          .delete()
          .eq("id", reservationId);
        if (deleteRes.error) throw new Error(deleteRes.error.message);
        reconciledReservations += 1;
        continue;
      }

      const storageError = await removePlayerDocumentObject(db, bucket, storagePath);
      if (storageError) throw new Error(storageError);
      const deleteRes = await db.from("player_document_upload_reservations").delete().eq("id", reservationId);
      if (deleteRes.error) throw new Error(deleteRes.error.message);
      removedObjects += 1;
    } catch (error) {
      failures.push({
        scope: "reservation",
        id: reservationId,
        error: error instanceof Error ? error.message : "Cleanup failed",
      });
    }
  }

  const deletionQueueRes = await db
    .from("player_document_storage_deletions")
    .select("id,storage_bucket,storage_path,attempts")
    .order("created_at", { ascending: true })
    .limit(200);
  if (deletionQueueRes.error) {
    failures.push({ scope: "deletion", id: "queue", error: deletionQueueRes.error.message });
  } else {
    for (const queued of deletionQueueRes.data ?? []) {
      const queueId = String((queued as any).id ?? "");
      const bucket = String((queued as any).storage_bucket ?? "");
      const storagePath = String((queued as any).storage_path ?? "");
      processedDeletionQueue += 1;
      try {
        const referencedRes = await db
          .from("player_dashboard_documents")
          .select("id")
          .eq("storage_bucket", bucket)
          .eq("storage_path", storagePath)
          .limit(1)
          .maybeSingle();
        if (referencedRes.error) throw new Error(referencedRes.error.message);

        if (!referencedRes.data?.id) {
          const storageError = await removePlayerDocumentObject(db, bucket, storagePath);
          if (storageError) throw new Error(storageError);
          removedObjects += 1;
        } else {
          reconciledDeletionQueue += 1;
        }

        const deleteQueueRes = await db
          .from("player_document_storage_deletions")
          .delete()
          .eq("id", queueId);
        if (deleteQueueRes.error) throw new Error(deleteQueueRes.error.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Queued deletion failed";
        failures.push({ scope: "deletion", id: queueId, error: message });
        await db
          .from("player_document_storage_deletions")
          .update({ attempts: Number((queued as any).attempts ?? 0) + 1, last_error: message })
          .eq("id", queueId);
      }
    }
  }

  return NextResponse.json({
    processed: (expiredRes.data ?? []).length,
    removedObjects,
    reconciledReservations,
    processedDeletionQueue,
    reconciledDeletionQueue,
    failures,
  });
}
