import { NextResponse } from "next/server";

/** Retired collective workflow. The guided assistant uses /debrief/analyze-player. */
export async function POST() {
  return NextResponse.json({ error: "Use the guided per-player evaluation.", code: "guided_evaluation_required" }, { status: 410 });
}
