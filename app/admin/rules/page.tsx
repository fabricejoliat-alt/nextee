import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import AdminRulesManagement from "@/components/admin/rules/AdminRulesManagement";

export default function AdminRulesPage() {
  return (
    <AppI18nProvider>
      <SuperAdminGuard>
        <AdminRulesManagement />
      </SuperAdminGuard>
    </AppI18nProvider>
  );
}
