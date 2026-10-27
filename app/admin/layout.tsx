import { connection } from "next/server";
import RoleGuard from "@/components/auth/RoleGuard";
import AdminShell from "@/components/admin/AdminShell";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import AdminMfaGuard from "@/components/admin/AdminMfaGuard";


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <div className="admin-page admin-page-root">
      <AppI18nProvider><RoleGuard allow="admin">
        <AdminMfaGuard><AdminShell>{children}</AdminShell></AdminMfaGuard>
      </RoleGuard></AppI18nProvider>
    </div>
  );
}
