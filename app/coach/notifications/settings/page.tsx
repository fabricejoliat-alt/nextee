import NotificationSettings from "@/components/notifications/NotificationSettings";

export default function CoachNotificationSettingsPage() {
  return (
    <NotificationSettings
      homeHref="/coach"
      notificationsHref="/coach/notifications"
      titleFr="Paramètres notifications coach"
      titleEn="Coach notification settings"
      titleDe="Trainer-Benachrichtigungseinstellungen"
      titleIt="Impostazioni notifiche coach"
    />
  );
}
