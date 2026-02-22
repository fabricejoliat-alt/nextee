// lib/supabaseClient.ts
import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
console.log("SUPABASE CLIENT LOADED", process.env.NEXT_PUBLIC_SUPABASE_URL);