import RoleGuard from "@/components/auth/RoleGuard";
import AdminShell from "@/components/admin/AdminShell";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-page admin-page-root">
      <AppI18nProvider><RoleGuard allow="admin">
        <AdminShell>{children}</AdminShell>
      </RoleGuard></AppI18nProvider>
    </div>
  );
}
