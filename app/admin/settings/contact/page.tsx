import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import ContactSettingsAdmin from "@/components/admin/ContactSettingsAdmin";

export default function Page() { return <SuperAdminGuard><ContactSettingsAdmin /></SuperAdminGuard>; }
