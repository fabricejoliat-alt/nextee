import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AdminHomeStats from "@/components/admin/AdminHomeStats";

export default function AdminHome() {
  return (
    <SuperAdminGuard>
      <AdminHomeStats />
    </SuperAdminGuard>
  );
}
