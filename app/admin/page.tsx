import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AdminHomeStats from "@/components/admin/AdminHomeStats";
import MarketplaceModerationAlert from "@/components/marketplace/MarketplaceModerationAlert";

export default function AdminHome() {
  return (
    <SuperAdminGuard>
      <MarketplaceModerationAlert role="admin" />
      <AdminHomeStats />
    </SuperAdminGuard>
  );
}
