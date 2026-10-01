import type { NextRequest } from "next/server";
import { deleteCoachPlanning } from "@/lib/server/coachPlanningDeletion";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await ctx.params;
  return deleteCoachPlanning(req, { seriesId });
}
