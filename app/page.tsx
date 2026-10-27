import { connection } from "next/server";

import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default async function Page() {
  await connection();
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}