import { redirect } from "next/navigation";

export default function LegacyManagerInformationCollectionPage() {
  redirect("/manager/user-management/players");
}
