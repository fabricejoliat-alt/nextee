import { Suspense } from "react";
import ManagerPageLoading from "@/components/manager/ManagerPageLoading";
import ManagerJuniorPerformancePage from "@/components/manager/ManagerJuniorPerformancePage";
export default function Page() { return <Suspense fallback={<ManagerPageLoading />}><ManagerJuniorPerformancePage /></Suspense>; }
