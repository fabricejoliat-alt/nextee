import NotificationsCenter from "@/components/notifications/NotificationsCenter";

export default function CoachNotificationsPage() {
  return (
    <NotificationsCenter
      homeHref="/manager"
      settingsHref="/manager/notifications/settings"
      titleFr="Notifications manager"
      titleEn="Manager notifications"
      titleDe="Manager-Benachrichtigungen"
      titleIt="Notifiche manager"
    />
  );
}
