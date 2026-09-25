import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess } from "@/app/api/camps/_lib";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> },
) {
  try {
    const { campId: rawCampId } = await params;
    const campId = String(rawCampId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const optionId = String(body?.option_id ?? "").trim();
    const selected = Boolean(body?.selected);
    if (!optionId) return NextResponse.json({ error: "Missing option_id" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const [campPlayerRes, optionRes] = await Promise.all([
      supabaseAdmin
        .from("club_camp_players")
        .select("camp_id,registration_status")
        .eq("camp_id", campId)
        .eq("player_id", access.effectiveUserId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_camp_options")
        .select("id,camp_id,is_active,capacity,allows_quantity,input_type,choices")
        .eq("id", optionId)
        .eq("camp_id", campId)
        .maybeSingle(),
    ]);
    const lookupError = campPlayerRes.error ?? optionRes.error;
    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 400 });
    if (!campPlayerRes.data?.camp_id || !optionRes.data?.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (campPlayerRes.data.registration_status !== "registered") {
      return NextResponse.json({ error: "Inscription au stage requise." }, { status: 400 });
    }
    if (!optionRes.data.is_active) {
      return NextResponse.json({ error: "Cette option n’est plus disponible." }, { status: 409 });
    }

    if (!selected) {
      const deleteRes = await supabaseAdmin
        .from("club_camp_player_options")
        .delete()
        .eq("option_id", optionId)
        .eq("player_id", access.effectiveUserId);
      if (deleteRes.error) return NextResponse.json({ error: deleteRes.error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    const inputType = String(optionRes.data.input_type ?? "checkbox");
    const choices = Array.isArray(optionRes.data.choices)
      ? optionRes.data.choices.map((choice) => String(choice ?? "").trim()).filter(Boolean)
      : [];
    let selectedValue = String(body?.value ?? "").trim();
    if (inputType === "checkbox" && choices.length > 0) {
      let checkboxValues: string[] = [];
      try {
        const parsed = JSON.parse(selectedValue);
        checkboxValues = Array.isArray(parsed)
          ? Array.from(new Set(parsed.map((value) => String(value ?? "").trim()).filter(Boolean)))
          : [];
      } catch {
        checkboxValues = [];
      }
      if (checkboxValues.length === 0 || checkboxValues.some((value) => !choices.includes(value))) {
        return NextResponse.json({ error: "Sélection de cases invalide." }, { status: 400 });
      }
      selectedValue = JSON.stringify(checkboxValues);
    }
    if (inputType === "yes_no" && !["yes", "no"].includes(selectedValue)) {
      return NextResponse.json({ error: "Choisissez Oui ou Non." }, { status: 400 });
    }
    if ((inputType === "select" || inputType === "radio") && !choices.includes(selectedValue)) {
      return NextResponse.json({ error: "Choix invalide." }, { status: 400 });
    }

    const requestedQuantity = inputType === "checkbox" && choices.length === 0 && optionRes.data.allows_quantity ? Number(body?.quantity ?? 1) : 1;
    const quantity = Math.trunc(requestedQuantity);
    if (!Number.isFinite(requestedQuantity) || quantity < 1 || quantity !== requestedQuantity) {
      return NextResponse.json({ error: "La quantité doit être un nombre entier positif." }, { status: 400 });
    }

    const assignmentsRes = await supabaseAdmin
      .from("club_camp_player_options")
      .select("player_id,quantity")
      .eq("option_id", optionId);
    if (assignmentsRes.error) return NextResponse.json({ error: assignmentsRes.error.message }, { status: 400 });
    const assignedByOthers = (assignmentsRes.data ?? []).reduce((sum, row) => {
      return String(row.player_id) === access.effectiveUserId ? sum : sum + Number(row.quantity ?? 1);
    }, 0);
    const capacity = optionRes.data.capacity == null ? null : Number(optionRes.data.capacity);
    if (capacity != null && assignedByOthers + quantity > capacity) {
      return NextResponse.json({ error: "La capacité disponible pour cette option est dépassée." }, { status: 409 });
    }

    const upsertRes = await supabaseAdmin.from("club_camp_player_options").upsert({
      option_id: optionId,
      player_id: access.effectiveUserId,
      quantity,
      selected_value: inputType === "checkbox" && choices.length === 0 ? null : selectedValue,
      assigned_by: access.viewerUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "option_id,player_id" });
    if (upsertRes.error) return NextResponse.json({ error: upsertRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
