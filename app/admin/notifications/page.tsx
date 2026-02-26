import SuperAdminGuard from "@/components/admin/SuperAdminGuard";
import NotificationTemplatesAdmin from "@/components/admin/notifications/NotificationTemplatesAdmin";

export default function AdminNotificationsPage() {
  return (
    <SuperAdminGuard>
      <NotificationTemplatesAdmin />
    </SuperAdminGuard>
  );
}
