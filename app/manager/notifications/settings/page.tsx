import NotificationSettings from "@/components/notifications/NotificationSettings";

export default function ManagerNotificationSettingsPage() {
  return (
    <NotificationSettings
      homeHref="/manager"
      notificationsHref="/manager/notifications"
      titleFr="Paramètres notifications manager"
      titleEn="Manager notification settings"
      titleDe="Manager-Benachrichtigungseinstellungen"
      titleIt="Impostazioni notifiche manager"
    />
  );
}
