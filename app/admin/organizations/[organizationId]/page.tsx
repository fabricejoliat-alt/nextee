import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import OrganizationMembersAdmin from "@/components/admin/organizations/OrganizationMembersAdmin";

export default function OrganizationPage() {
  return (
    <SuperAdminGuard>
      <OrganizationMembersAdmin />
    </SuperAdminGuard>
  );
}
