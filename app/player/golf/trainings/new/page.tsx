import { connection } from "next/server";
import { Suspense } from "react";
import PlayerTrainingNewClient from "./PlayerTrainingNewClient";


export default async function Page() {
  await connection();
  return (
    <Suspense fallback={null}>
      <PlayerTrainingNewClient />
    </Suspense>
  );
}
