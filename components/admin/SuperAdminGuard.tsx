"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SuperAdminGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);

      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;

      if (!user) {
        if (mounted) {
          setAllowed(false);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (mounted) {
        setAllowed(!error && !!data);
        setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div style={{ padding: 16 }}>Chargement…</div>;

  if (!allowed) {
    return (
      <div style={{ padding: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
          Accès refusé
        </h1>
        <p style={{ color: "var(--muted)" }}>
          Tu dois être superadmin pour accéder à cette page.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
