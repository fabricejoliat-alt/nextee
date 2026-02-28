"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Allowed = "admin" | "player" | "coach" | "manager" | "parent";

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
    const goLogin = () => {
      if (typeof window !== "undefined") {
        window.location.assign("/");
        return;
      }
      router.replace("/");
    };

    (async () => {
      const allowed = Array.isArray(allow) ? allow : [allow];

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        goLogin();
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
        goLogin();
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

      const role = membership.role as "player" | "coach" | "manager" | "parent";

      if (role === "parent" && json.parentHasChildren === false) {
        router.replace("/no-access");
        return;
      }

      if (allowed.includes(role)) {
        setOk(true);
        return;
      }

      // mauvais espace → redirection vers le bon
      if (role === "manager") router.replace("/manager");
      else if (role === "parent") router.replace("/player");
      else if (role === "coach") router.replace("/coach");
      else router.replace("/player");
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || event === "SIGNED_OUT") {
        goLogin();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
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
