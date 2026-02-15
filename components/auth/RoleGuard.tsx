"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Allowed = "admin" | "player" | "coach" | "manager";

export default function RoleGuard({
  allow,
  children,
}: {
  allow: Allowed | Allowed[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      const allowed = Array.isArray(allow) ? allow : [allow];

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        router.replace("/");
        return;
      }

      const res = await fetch("/api/auth/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json();

      if (!res.ok) {
        router.replace("/");
        return;
      }

      // Superadmin
      if (json.isSuperAdmin) {
        if (allowed.includes("admin")) {
          setOk(true);
          return;
        }
        // superadmin qui va sur player/coach/manager → on le renvoie admin
        router.replace("/admin");
        return;
      }

      const membership = json.membership;
      if (!membership) {
        router.replace("/no-access");
        return;
      }

      const role = membership.role as "player" | "coach" | "manager";

      if (allowed.includes(role)) {
        setOk(true);
        return;
      }

      // mauvais espace → redirection vers le bon
      if (role === "manager") router.replace("/manager");
      else if (role === "coach") router.replace("/coach");
      else router.replace("/player");
    })();
  }, [allow, router]);

  if (!ok) {
    return (
      <main style={{ padding: 24 }}>
        <div className="card" style={{ maxWidth: 520, margin: "40px auto" }}>
          Vérification…
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
