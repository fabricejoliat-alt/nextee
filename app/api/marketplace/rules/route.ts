import { NextResponse } from "next/server";
import { publicContactEmail } from "@/lib/server/publicContact";

export async function GET() {
  return NextResponse.json({ email: await publicContactEmail() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
