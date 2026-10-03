import { Suspense } from "react";
import ManagerPageLoading from "@/components/manager/ManagerPageLoading";
import PlayerCustomFieldsPage from "@/components/manager/PlayerCustomFieldsPage";

export default function ManagerUserManagementCustomFieldsPage() {
  return <Suspense fallback={<ManagerPageLoading />}><PlayerCustomFieldsPage /></Suspense>;
}
