import { redirect } from "next/navigation";

/** Participants are managed in the activity detail; this URL has no playerId. */
export default async function ManagerActivityParticipants({ params, searchParams }: {
  params: Promise<{ id: string; eventId: string }>; searchParams: Promise<{ season?: string }>;
}) {
  const { id, eventId } = await params;
  const { season } = await searchParams;
  redirect(`/manager/groups/${encodeURIComponent(id)}/planning/${encodeURIComponent(eventId)}${season ? `?season=${encodeURIComponent(season)}` : ""}`);
}
