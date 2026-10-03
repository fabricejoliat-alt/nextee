import type { NextRequest } from "next/server";
import { deleteManagerPlanning } from "@/lib/server/managerPlanningDeletion";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ seriesId: string }> }) {
  return deleteManagerPlanning(req, { seriesId: (await ctx.params).seriesId });
}
