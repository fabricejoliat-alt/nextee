import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import ClubsAdmin from "@/components/admin/clubs/ClubsAdmin";

export default function AdminClubsPage() {
  return (
    <SuperAdminGuard>
      <ClubsAdmin />
    </SuperAdminGuard>
  );
}
