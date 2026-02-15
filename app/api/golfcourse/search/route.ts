import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const key = mustEnv("GOLFCOURSEAPI_KEY");
    const base = process.env.GOLFCOURSEAPI_BASE_URL || "https://api.golfcourseapi.com";

    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

    const url = `${base}/v1/search?search_query=${encodeURIComponent(q)}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Key ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await r.text();
    if (!r.ok) return NextResponse.json({ error: text }, { status: r.status });

    return new NextResponse(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
