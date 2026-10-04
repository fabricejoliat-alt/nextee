import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import AdminEtiquetteCardEditor from "@/components/etiquette/AdminEtiquetteCardEditor";

export default async function AdminEtiquetteCardPage({ params }: { params: Promise<{ cardVersionId: string }> }) {
  const { cardVersionId } = await params;
  return <AppI18nProvider><SuperAdminGuard><AdminEtiquetteCardEditor cardVersionId={cardVersionId}/></SuperAdminGuard></AppI18nProvider>;
}
