import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
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
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,created_at")
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

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    const originalName = safeFileName(file.name || "document");
    const objectPath = `player-documents/${organizationId}/${playerId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${originalName}`;
    const arrayBuffer = await file.arrayBuffer();
    const uploadRes = await supabaseAdmin.storage.from("marketplace").upload(objectPath, Buffer.from(arrayBuffer), {
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
        file_name: file.name || originalName,
        storage_path: objectPath,
        mime_type: file.type || null,
        size_bytes: file.size ?? null,
        coach_only: false,
      })
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,created_at")
      .single();
    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

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

    const publicUrl = supabaseAdmin.storage.from("marketplace").getPublicUrl(objectPath).data.publicUrl;
    return NextResponse.json({ document: { ...insRes.data, uploaded_by_name: uploadedByName, public_url: publicUrl } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
