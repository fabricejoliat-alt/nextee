import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

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

    const docs = (docsRes.data ?? []).map((d: any) => ({
      ...d,
      public_url: supabaseAdmin.storage.from("marketplace").getPublicUrl(String(d.storage_path ?? "")).data.publicUrl,
    }));

    return NextResponse.json({ documents: docs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
