import NotificationSettings from "@/components/notifications/NotificationSettings";

export default function PlayerNotificationSettingsPage() {
  return (
    <NotificationSettings
      homeHref="/player"
      notificationsHref="/player/notifications"
      titleFr="Paramètres notifications"
      titleEn="Notification settings"
      titleDe="Benachrichtigungseinstellungen"
      titleIt="Impostazioni notifiche"
    />
  );
}
