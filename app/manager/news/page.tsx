import { Suspense } from "react";
import ManagerNewsWorkspace from "@/components/manager/ManagerNewsWorkspace";
import ManagerPageLoading from "@/components/manager/ManagerPageLoading";

export default function ManagerNewsPage() {
  return <Suspense fallback={<ManagerPageLoading />}><ManagerNewsWorkspace /></Suspense>;
}
