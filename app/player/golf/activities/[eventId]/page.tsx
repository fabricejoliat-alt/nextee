import { connection } from "next/server";
import { Suspense } from "react";
import PlayerTrainingNewClient from "../../trainings/new/PlayerTrainingNewClient";

export default async function ActivityDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  await connection();
  const { eventId } = await params;
  return <Suspense fallback={null}><PlayerTrainingNewClient viewEventId={eventId} /></Suspense>;
}
