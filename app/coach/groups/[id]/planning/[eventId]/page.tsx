import { Suspense } from "react";
import CoachEventDetail from "./CoachEventDetail";
import CoachEventDetailLoading from "./CoachEventDetailLoading";

type RouteParams = { id: string; eventId: string };

async function ResolvedDetail({ params }: { params: Promise<RouteParams> }) {
  const routeParams = await params;
  return <CoachEventDetail routeParams={routeParams} />;
}

export default function CoachEventDetailPage({ params }: { params: Promise<RouteParams> }) {
  return (
    <Suspense fallback={<CoachEventDetailLoading />}>
      <ResolvedDetail params={params} />
    </Suspense>
  );
}
