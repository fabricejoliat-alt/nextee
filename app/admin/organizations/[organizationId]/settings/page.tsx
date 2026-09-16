import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import OrganizationSettingsAdmin from "@/components/admin/organizations/OrganizationSettingsAdmin";

export default function OrganizationSettingsPage() {
  return <SuperAdminGuard><OrganizationSettingsAdmin /></SuperAdminGuard>;
}
