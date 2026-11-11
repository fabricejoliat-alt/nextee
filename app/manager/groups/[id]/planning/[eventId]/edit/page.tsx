import { Suspense } from "react";
import ManagerEventEditor, { ManagerEventEditorLoading } from "./ManagerEventEditor";

type RouteParams = { id: string; eventId: string };

// Resolve request-specific parameters before mounting the client editor. With
// Cache Components, useParams can otherwise retain prerender placeholders.
async function ResolvedEditor({ params }: { params: Promise<RouteParams> }) {
  const routeParams = await params;
  return <ManagerEventEditor routeParams={routeParams} />;
}

export default function ManagerEventEditPage({ params }: { params: Promise<RouteParams> }) {
  return (
    <Suspense fallback={<ManagerEventEditorLoading />}>
      <ResolvedEditor params={params} />
    </Suspense>
  );
}
