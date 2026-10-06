import { redirect } from "next/navigation";

// Les anciens liens mènent désormais au point d'entrée unique des conditions d'accès.
export default function PlayerConsentRequiredPage() {
  redirect("/legal/my");
}
