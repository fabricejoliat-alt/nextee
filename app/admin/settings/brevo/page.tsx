import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import BrevoContactsAdmin from "@/components/admin/BrevoContactsAdmin";

export default function Page() { return <SuperAdminGuard><BrevoContactsAdmin /></SuperAdminGuard>; }
