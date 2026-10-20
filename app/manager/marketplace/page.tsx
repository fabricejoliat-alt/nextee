import { Suspense } from "react";
import MarketplaceModerationWorkspace from "@/components/marketplace/MarketplaceModerationWorkspace";
import ManagerPageLoading from "@/components/manager/ManagerPageLoading";
export default function Page() {
  return <Suspense fallback={<ManagerPageLoading />}><MarketplaceModerationWorkspace audience="manager" /></Suspense>;
}
