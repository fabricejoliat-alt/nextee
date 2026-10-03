import { Suspense } from "react";
import ManagerPageLoading from "@/components/manager/ManagerPageLoading";
import ManagerCoachPerformancePage from "@/components/manager/ManagerCoachPerformancePage";

export default function ManagerPerformanceCoachesPage() {
  return <Suspense fallback={<ManagerPageLoading />}><ManagerCoachPerformancePage /></Suspense>;
}
