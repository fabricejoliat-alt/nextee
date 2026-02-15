import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(_req: NextRequest, ctx: any) {
  try {
    const key = mustEnv("GOLFCOURSEAPI_KEY");
    const base = process.env.GOLFCOURSEAPI_BASE_URL || "https://api.golfcourseapi.com";

    // ✅ Next peut fournir ctx.params comme Promise
    const params = await Promise.resolve(ctx?.params);
    const courseId = params?.courseId;

    if (!courseId) {
      return NextResponse.json({ error: "Missing courseId" }, { status: 400 });
    }

    const url = `${base}/v1/courses/${encodeURIComponent(String(courseId))}`;

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
