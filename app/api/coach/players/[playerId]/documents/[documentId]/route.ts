import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string; documentId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId, documentId } = await ctx.params;
    if (!playerId || !documentId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (access.sharedClubIds.length === 0 || !access.canAccessSensitiveSections) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const docRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,storage_path,uploaded_by")
      .eq("id", documentId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (docRes.error) return NextResponse.json({ error: docRes.error.message }, { status: 400 });
    if (!docRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!access.sharedClubIds.includes(String(docRes.data.organization_id ?? ""))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String((docRes.data as any).uploaded_by ?? "") !== callerId) {
      return NextResponse.json({ error: "Only uploader can delete this document" }, { status: 403 });
    }

    await supabaseAdmin.storage.from("marketplace").remove([String(docRes.data.storage_path ?? "")]);
    const delRes = await supabaseAdmin.from("player_dashboard_documents").delete().eq("id", documentId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string; documentId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId, documentId } = await ctx.params;
    if (!playerId || !documentId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (access.sharedClubIds.length === 0 || !access.canAccessSensitiveSections) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      file_name?: string | null;
      coach_only?: boolean | null;
      club_event_id?: string | null;
    };
    const nextName = String(body?.file_name ?? "").trim();
    const hasFileName = Object.prototype.hasOwnProperty.call(body, "file_name");
    const hasCoachOnly = Object.prototype.hasOwnProperty.call(body, "coach_only");
    const hasClubEventId = Object.prototype.hasOwnProperty.call(body, "club_event_id");
    if (!hasFileName && !hasCoachOnly && !hasClubEventId) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (hasFileName && !nextName) return NextResponse.json({ error: "Missing file_name" }, { status: 400 });

    const docRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,uploaded_by")
      .eq("id", documentId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (docRes.error) return NextResponse.json({ error: docRes.error.message }, { status: 400 });
    if (!docRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!access.sharedClubIds.includes(String(docRes.data.organization_id ?? ""))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String((docRes.data as any).uploaded_by ?? "") !== callerId) {
      return NextResponse.json({ error: "Only uploader can rename this document" }, { status: 403 });
    }

    const patch: Record<string, unknown> = {};
    if (hasFileName) patch.file_name = nextName;
    if (hasCoachOnly) patch.coach_only = !!body.coach_only;
    if (hasClubEventId) {
      const nextClubEventId = String(body?.club_event_id ?? "").trim();
      patch.club_event_id = nextClubEventId || null;
    }

    const updRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .update(patch)
      .eq("id", documentId)
      .select("id,organization_id,player_id,uploaded_by,file_name,storage_path,mime_type,size_bytes,coach_only,club_event_id,created_at")
      .single();
    if (updRes.error) return NextResponse.json({ error: updRes.error.message }, { status: 400 });

    return NextResponse.json({ document: updRes.data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
