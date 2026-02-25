import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const locale = (searchParams.get("locale") || "fr").trim().toLowerCase();
    if (!["fr", "en"].includes(locale)) {
      return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
    }

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data, error } = await supabaseAdmin
      .from("app_translations")
      .select("key,value")
      .eq("locale", locale);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const overrides: Record<string, string> = {};
    for (const row of data ?? []) overrides[row.key] = row.value;

    return NextResponse.json({ locale, overrides }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

