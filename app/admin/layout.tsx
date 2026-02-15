import RoleGuard from "@/components/auth/RoleGuard";
import AdminShell from "@/components/admin/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="admin">
      <AdminShell>{children}</AdminShell>
    </RoleGuard>
  );
}
