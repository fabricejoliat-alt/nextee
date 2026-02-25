import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import OrganizationsAdmin from "@/components/admin/organizations/OrganizationsAdmin";

export default function AdminOrganizationsPage() {
  return (
    <SuperAdminGuard>
      <OrganizationsAdmin />
    </SuperAdminGuard>
  );
}
