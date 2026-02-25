import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import TranslationsAdmin from "@/components/admin/translations/TranslationsAdmin";

export default function AdminTranslationsPage() {
  return (
    <SuperAdminGuard>
      <TranslationsAdmin />
    </SuperAdminGuard>
  );
}

