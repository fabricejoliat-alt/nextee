import { Suspense } from "react";
import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import MarketplaceModerationWorkspace from "@/components/marketplace/MarketplaceModerationWorkspace";
export default function Page() {
  return <SuperAdminGuard><Suspense><MarketplaceModerationWorkspace /></Suspense></SuperAdminGuard>;
}
