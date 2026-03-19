import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

const DOCUMENTS_BUCKET = "marketplace";
const MAX_DOCUMENT_SIZE_BYTES = 500 * 1024 * 1024;

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildObjectPath(organizationId: string, playerId: string, originalName: string) {
  return `player-documents/${organizationId}/${playerId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName(originalName || "document")}`;
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

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const url = new URL(req.url);
    const requestedPlayerId = String(url.searchParams.get("player_id") ?? "").trim();
    const playerId = requestedPlayerId || callerId;
    if (!playerId) return NextResponse.json({ error: "Missing player_id" }, { status: 400 });

    if (callerId !== playerId) {
      const parentLinkRes = await supabaseAdmin
        .from("player_guardians")
        .select("id")
        .eq("player_id", playerId)
        .eq("guardian_user_id", callerId)
        .or("can_view.is.null,can_view.eq.true")
        .limit(1)
        .maybeSingle();
      if (parentLinkRes.error) return NextResponse.json({ error: parentLinkRes.error.message }, { status: 400 });
      if (!parentLinkRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const docsRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
      .eq("player_id", playerId)
      .eq("coach_only", false)
      .order("created_at", { ascending: false })
      .limit(200);
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

    const docs = (docsRes.data ?? []).map((d: any) => ({
      ...d,
      uploaded_by_name: uploaderNameById.get(String(d.uploaded_by ?? "")) ?? String(d.uploaded_by ?? "").slice(0, 8),
      public_url: supabaseAdmin.storage.from("marketplace").getPublicUrl(String(d.storage_path ?? "")).data.publicUrl,
    }));

    return NextResponse.json({ documents: docs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
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
      };

      const action = String(body?.action ?? "").trim();
      const sizeBytes = Number(body?.size_bytes ?? 0);
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return NextResponse.json({ error: "Invalid size_bytes" }, { status: 400 });
      }
      if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
        return NextResponse.json(
          { error: `Fichier trop volumineux. Limite ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB.` },
          { status: 400 }
        );
      }

      if (action === "prepare") {
        const originalName = String(body?.original_name ?? "").trim();
        if (!originalName) return NextResponse.json({ error: "Missing original_name" }, { status: 400 });
        const objectPath = buildObjectPath(organizationId, playerId, originalName);
        const signedRes = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(objectPath);
        if (signedRes.error) return NextResponse.json({ error: signedRes.error.message }, { status: 400 });
        return NextResponse.json({
          path: objectPath,
          token: String((signedRes.data as any)?.token ?? ""),
          max_bytes: MAX_DOCUMENT_SIZE_BYTES,
        });
      }

      if (action === "finalize") {
        const storagePath = String(body?.storage_path ?? "").trim();
        const providedName = String(body?.file_name ?? "").trim();
        const originalName = String(body?.original_name ?? "").trim();
        const mimeType = String(body?.mime_type ?? "").trim() || null;
        const clubEventId = String(body?.club_event_id ?? "").trim() || null;
        if (!storagePath) return NextResponse.json({ error: "Missing storage_path" }, { status: 400 });

        const insRes = await supabaseAdmin
          .from("player_dashboard_documents")
          .insert({
            organization_id: organizationId,
            player_id: playerId,
            uploaded_by: callerId,
            file_name: providedName || originalName || "document",
            storage_path: storagePath,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            coach_only: false,
            club_event_id: clubEventId,
          })
          .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
          .single();
        if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

        const uploadedByName = await resolveUploaderName(supabaseAdmin, callerId);
        const publicUrl = supabaseAdmin.storage.from(DOCUMENTS_BUCKET).getPublicUrl(storagePath).data.publicUrl;
        return NextResponse.json({ document: { ...insRes.data, uploaded_by_name: uploadedByName, public_url: publicUrl } });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const providedName = String(form.get("file_name") ?? "").trim();
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
    if ((file.size ?? 0) > MAX_DOCUMENT_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Fichier trop volumineux. Limite ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB.` },
        { status: 400 }
      );
    }

    const originalName = safeFileName(file.name || "document");
    const objectPath = buildObjectPath(organizationId, playerId, originalName);
    const arrayBuffer = await file.arrayBuffer();
    const uploadRes = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).upload(objectPath, Buffer.from(arrayBuffer), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadRes.error) return NextResponse.json({ error: uploadRes.error.message }, { status: 400 });

    const insRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .insert({
        organization_id: organizationId,
        player_id: playerId,
        uploaded_by: callerId,
        file_name: providedName || file.name || originalName,
        storage_path: objectPath,
        mime_type: file.type || null,
        size_bytes: file.size ?? null,
        coach_only: false,
      })
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
      .single();
    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

    const uploadedByName = await resolveUploaderName(supabaseAdmin, callerId);
    const publicUrl = supabaseAdmin.storage.from(DOCUMENTS_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    return NextResponse.json({ document: { ...insRes.data, uploaded_by_name: uploadedByName, public_url: publicUrl } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
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

    if (String((docRes.data as any).player_id ?? "") !== playerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String((docRes.data as any).uploaded_by ?? "") !== callerId) {
      return NextResponse.json({ error: "Only uploader can rename this document" }, { status: 403 });
    }

    const updRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .update({ file_name: nextName })
      .eq("id", documentId)
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,created_at")
      .single();
    if (updRes.error) return NextResponse.json({ error: updRes.error.message }, { status: 400 });

    return NextResponse.json({ document: updRes.data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
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
      .select("id,player_id,uploaded_by,storage_path")
      .eq("id", documentId)
      .maybeSingle();
    if (docRes.error) return NextResponse.json({ error: docRes.error.message }, { status: 400 });
    if (!docRes.data) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    if (String((docRes.data as any).player_id ?? "") !== playerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String((docRes.data as any).uploaded_by ?? "") !== callerId) {
      return NextResponse.json({ error: "Only uploader can delete this document" }, { status: 403 });
    }

    const path = String((docRes.data as any).storage_path ?? "").trim();
    if (path) {
      await supabaseAdmin.storage.from("marketplace").remove([path]);
    }

    const delRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .delete()
      .eq("id", documentId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, id: documentId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
