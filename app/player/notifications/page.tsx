import NotificationsCenter from "@/components/notifications/NotificationsCenter";

export default function PlayerNotificationsPage() {
  return (
    <NotificationsCenter
      homeHref="/player"
      settingsHref="/player/notifications/settings"
      designVariant="management"
      titleFr="Notifications"
      titleEn="Notifications"
      titleDe="Benachrichtigungen"
      titleIt="Notifiche"
    />
  );
}
