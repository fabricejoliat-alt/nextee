import { redirect } from "next/navigation";

export default async function RetiredCoachEvaluationPage({
  params,
}: {
  params: Promise<{ id: string; eventId: string; playerId: string }>;
}) {
  const { id, eventId, playerId } = await params;
  redirect(`/coach/groups/${encodeURIComponent(id)}/planning/${encodeURIComponent(eventId)}/debrief?playerId=${encodeURIComponent(playerId)}`);
}
