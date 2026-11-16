import { Suspense } from "react";
import TrainingPageSkeleton from "@/components/player/TrainingPageSkeleton";
import PlayerTrainingDetailClient from "./PlayerTrainingDetailClient";

type RouteParams = { sessionId: string };

// Resolve request parameters before mounting the client: Cache Components can
// otherwise expose prerender placeholders through useParams on navigation.
async function ResolvedDetail({ params }: { params: Promise<RouteParams> }) {
  const { sessionId } = await params;
  return <PlayerTrainingDetailClient sessionId={sessionId} />;
}

export default function PlayerTrainingDetailPage({ params }: { params: Promise<RouteParams> }) {
  return (
    <Suspense fallback={<TrainingPageSkeleton variant="detail" label="…" />}>
      <ResolvedDetail params={params} />
    </Suspense>
  );
}
