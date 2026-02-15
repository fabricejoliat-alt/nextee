"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/utils/supabase/client";

type Club = {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
};

export default function ClubsPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const load = async () => {
      setMsg("Chargement...");
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setMsg("❌ Pas connecté. Va sur /auth-test et connecte-toi.");
        return;
      }

      const { data, error } = await supabase
        .from("clubs")
        .select("id,name,slug,created_at")
        .order("created_at", { ascending: false });

      if (error) {
        setMsg(`❌ ${error.message}`);
        return;
      }

      setClubs(data ?? []);
      setMsg(`✅ ${data?.length ?? 0} club(s)`);
    };

    load();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Clubs</h1>
      <p>{msg}</p>

      <ul style={{ display: "grid", gap: 10, padding: 0, listStyle: "none" }}>
        {clubs.map((c) => (
          <li
            key={c.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 12,
              background: "white",
            }}
          >
            <div style={{ fontWeight: 700 }}>{c.name}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{c.slug}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{c.id}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
