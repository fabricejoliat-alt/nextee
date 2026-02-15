import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import ClubMembersAdmin from "@/components/admin/clubs/ClubMembersAdmin";

export default function ClubPage() {
  return (
    <SuperAdminGuard>
      <ClubMembersAdmin />
    </SuperAdminGuard>
  );
}
