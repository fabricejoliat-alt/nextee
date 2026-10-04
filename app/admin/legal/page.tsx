import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import LegalAdminWorkspace from "@/components/legal/LegalAdminWorkspace";
export default function Page() { return <SuperAdminGuard><LegalAdminWorkspace /></SuperAdminGuard>; }
