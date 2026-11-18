import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import CoachAiSettingsAdmin from "@/components/admin/CoachAiSettingsAdmin";

export default function Page() { return <SuperAdminGuard><CoachAiSettingsAdmin /></SuperAdminGuard>; }
