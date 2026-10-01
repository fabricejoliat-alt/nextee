import { NextResponse } from "next/server";

/** No legacy AI entry point: the guided endpoint enforces club/coach opt-in. */
export async function POST() {
  return NextResponse.json(
    { error: "Use the guided debrief assistant.", code: "guided_evaluation_required" },
    { status: 410 }
  );
}
