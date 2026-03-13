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

async function resolveSharedCoachOrManagerOrgs(supabaseAdmin: any, callerId: string, playerId: string) {
  const [coachRes, playerRes] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["manager", "coach"]),
    supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", playerId)
      .eq("is_active", true)
      .eq("role", "player"),
  ]);
  if (coachRes.error) throw new Error(coachRes.error.message);
  if (playerRes.error) throw new Error(playerRes.error.message);

  const coachOrgs = new Set<string>((coachRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
  const shared = Array.from(
    new Set((playerRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter((id: string) => coachOrgs.has(id)))
  );
  return shared;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const sharedOrgIds = await resolveSharedCoachOrManagerOrgs(supabaseAdmin, callerId, playerId);
    if (sharedOrgIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const docsRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,created_at")
      .eq("player_id", playerId)
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const sharedOrgIds = await resolveSharedCoachOrManagerOrgs(supabaseAdmin, callerId, playerId);
    if (sharedOrgIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as {
        action?: string | null;
        organization_id?: string | null;
        coach_only?: boolean | string | null;
        original_name?: string | null;
        file_name?: string | null;
        mime_type?: string | null;
        size_bytes?: number | string | null;
        storage_path?: string | null;
      };

      const action = String(body?.action ?? "").trim();
      const sizeBytes = Number(body?.size_bytes ?? 0);
      const organizationIdFromBody = String(body?.organization_id ?? "").trim();
      const coachOnlyFromBody = String(body?.coach_only ?? "false").trim() === "true";
      if (!organizationIdFromBody || !sharedOrgIds.includes(organizationIdFromBody)) {
        return NextResponse.json({ error: "Invalid organization_id" }, { status: 400 });
      }
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
        const objectPath = buildObjectPath(organizationIdFromBody, playerId, originalName);
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
        if (!storagePath) return NextResponse.json({ error: "Missing storage_path" }, { status: 400 });

        const insRes = await supabaseAdmin
          .from("player_dashboard_documents")
          .insert({
            organization_id: organizationIdFromBody,
            player_id: playerId,
            uploaded_by: callerId,
            file_name: providedName || originalName || "document",
            storage_path: storagePath,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            coach_only: coachOnlyFromBody,
          })
          .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,created_at")
          .single();
        if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

        const uploadedByName = await resolveUploaderName(supabaseAdmin, callerId);
        const publicUrl = supabaseAdmin.storage.from(DOCUMENTS_BUCKET).getPublicUrl(storagePath).data.publicUrl;
        return NextResponse.json({ document: { ...insRes.data, uploaded_by_name: uploadedByName, public_url: publicUrl } });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const form = await req.formData();
    const organizationId = String(form.get("organization_id") ?? "").trim();
    const coachOnly = String(form.get("coach_only") ?? "false").trim() === "true";
    const providedName = String(form.get("file_name") ?? "").trim();
    const file = form.get("file");
    if (!organizationId || !sharedOrgIds.includes(organizationId)) {
      return NextResponse.json({ error: "Invalid organization_id" }, { status: 400 });
    }
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
        coach_only: coachOnly,
      })
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,created_at")
      .single();
    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

    const uploadedByName = await resolveUploaderName(supabaseAdmin, callerId);
    const publicUrl = supabaseAdmin.storage.from(DOCUMENTS_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    return NextResponse.json({ document: { ...insRes.data, uploaded_by_name: uploadedByName, public_url: publicUrl } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
