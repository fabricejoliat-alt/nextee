import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import PlayerTrainingNewClient from "./PlayerTrainingNewClient";


export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const query = await searchParams;
  const eventId = query.club_event_id ?? query.eventId;
  if (query.mode === "view" && typeof eventId === "string" && eventId.trim()) {
    const context = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (["mode", "club_event_id", "eventId"].includes(key)) continue;
      for (const item of Array.isArray(value) ? value : value ? [value] : []) context.append(key, item);
    }
    redirect(`/player/golf/activities/${encodeURIComponent(eventId.trim())}${context.size ? `?${context}` : ""}`);
  }
  return (
    <Suspense fallback={null}>
      <PlayerTrainingNewClient />
    </Suspense>
  );
}
