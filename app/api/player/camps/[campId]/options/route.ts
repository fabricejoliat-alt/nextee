import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess } from "@/app/api/camps/_lib";
import { mapPlayerTransactionError } from "@/lib/playerTransactionErrors";

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

    const optionRes = await supabaseAdmin
      .from("club_camp_options")
      .select("id,camp_id,is_active,allows_quantity,input_type,choices")
      .eq("id", optionId)
      .eq("camp_id", campId)
      .maybeSingle();
    if (optionRes.error) return NextResponse.json({ error: optionRes.error.message }, { status: 400 });
    if (!optionRes.data?.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!optionRes.data.is_active) {
      return NextResponse.json({ error: "Cette option n’est plus disponible." }, { status: 409 });
    }

    if (!selected) {
      const result = await supabaseAdmin.rpc("set_player_camp_option_transactional", {
        p_camp_id: campId,
        p_option_id: optionId,
        p_player_id: access.effectiveUserId,
        p_actor_id: access.viewerUserId,
        p_selected: false,
        p_quantity: 1,
        p_selected_value: null,
      });
      if (result.error) {
        const mapped = mapPlayerTransactionError(result.error, "Mise à jour de l’option impossible.");
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      return NextResponse.json(result.data ?? { ok: true });
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

    const result = await supabaseAdmin.rpc("set_player_camp_option_transactional", {
      p_camp_id: campId,
      p_option_id: optionId,
      p_player_id: access.effectiveUserId,
      p_actor_id: access.viewerUserId,
      p_selected: true,
      p_quantity: quantity,
      p_selected_value: inputType === "checkbox" && choices.length === 0 ? null : selectedValue,
    });
    if (result.error) {
      const mapped = mapPlayerTransactionError(result.error, "Mise à jour de l’option impossible.");
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    return NextResponse.json(result.data ?? { ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
