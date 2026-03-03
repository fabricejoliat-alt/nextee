import NotificationsCenter from "@/components/notifications/NotificationsCenter";

export default function CoachNotificationsPage() {
  return (
    <NotificationsCenter
      homeHref="/coach"
      settingsHref="/coach/notifications/settings"
      titleFr="Notifications coach"
      titleEn="Coach notifications"
      titleDe="Trainer-Benachrichtigungen"
      titleIt="Notifiche coach"
    />
  );
}
