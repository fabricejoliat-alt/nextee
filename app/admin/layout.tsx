import RoleGuard from "@/components/auth/RoleGuard";
import AdminShell from "@/components/admin/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-page admin-page-root">
      <RoleGuard allow="admin">
        <AdminShell>{children}</AdminShell>
      </RoleGuard>
    </div>
  );
}
