// lib/supabaseClient.ts
import { organizationFetch } from "@/lib/organizationFetch";
import { createBrowserClient } from "@supabase/ssr";
import { capturePasswordRecoveryUrl } from "@/lib/passwordRecovery";

export const passwordRecoveryUrl = capturePasswordRecoveryUrl(typeof window === "undefined" ? undefined : window);

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: { fetch: organizationFetch },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    cookieOptions: {
      path: "/",
      sameSite: "lax",
    },
  }
);
