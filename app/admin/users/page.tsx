import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import UsersAdmin from "@/components/admin/users/UsersAdmin";

export default function UsersPage() {
  return (
    <SuperAdminGuard>
      <UsersAdmin />
    </SuperAdminGuard>
  );
}
