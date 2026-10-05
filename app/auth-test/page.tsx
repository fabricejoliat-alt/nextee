import { redirect } from "next/navigation";

// Accounts are provisioned by authorized club staff. Retire the old public
// authentication sandbox and reuse the normal sign-in entry point.
export default function AuthTest() {
  redirect("/");
}
