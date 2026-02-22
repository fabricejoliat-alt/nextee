import { Suspense } from "react";
import PlayerTrainingNewClient from "./PlayerTrainingNewClient";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Chargement…</div>}>
      <PlayerTrainingNewClient />
    </Suspense>
  );
}