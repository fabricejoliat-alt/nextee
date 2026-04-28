import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import ValidationsAdmin from "@/components/admin/validations/ValidationsAdmin";

export default function AdminValidationsPage() {
  return (
    <SuperAdminGuard>
      <ValidationsAdmin />
    </SuperAdminGuard>
  );
}
