import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import AdminEtiquetteManagement from "@/components/etiquette/AdminEtiquetteManagement";

export default function AdminEtiquettePage() { return <AppI18nProvider><SuperAdminGuard><AdminEtiquetteManagement/></SuperAdminGuard></AppI18nProvider>; }
