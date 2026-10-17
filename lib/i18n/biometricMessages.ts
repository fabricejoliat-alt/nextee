import type { AppLocale } from "./messages";

type BiometricCopy = {
  title: string; description: string; privacy: string; enabled: string; disabled: string;
  enable: string; disable: string; checking: string; unavailable: string; error: string; cancelled: string;
};

export const biometricMessages: Record<AppLocale, BiometricCopy> = {
  fr: {
    title: "Déverrouillage de l’app", description: "Utilisez {method} à l’ouverture de l’app et après un passage en arrière-plan. Le code de l’appareil peut servir de secours.",
    privacy: "Option propre à votre compte sur cet appareil, désactivée à la déconnexion. ActiviTee ne reçoit aucune donnée biométrique.",
    enabled: "Activé sur cet appareil", disabled: "Désactivé", enable: "Activer {method}", disable: "Désactiver", checking: "Vérification…",
    unavailable: "Configurez ou autorisez Face ID ou Touch ID dans les réglages de l’appareil, puis réessayez.",
    error: "Impossible de modifier cette option. Réessayez.", cancelled: "Vérification annulée. Votre réglage est conservé.",
  },
  en: {
    title: "App unlock", description: "Use {method} when opening the app and after returning from the background. Your device passcode is available as a fallback.",
    privacy: "This option applies to your account on this device and turns off when you sign out. ActiviTee receives no biometric data.",
    enabled: "Enabled on this device", disabled: "Disabled", enable: "Enable {method}", disable: "Disable", checking: "Verifying…",
    unavailable: "Set up or allow Face ID or Touch ID in your device settings, then try again.",
    error: "Unable to change this option. Try again.", cancelled: "Verification cancelled. Your setting is unchanged.",
  },
  de: {
    title: "App entsperren", description: "Verwende {method} beim Öffnen der App und nach der Rückkehr aus dem Hintergrund. Alternativ kannst du den Gerätecode verwenden.",
    privacy: "Diese Option gilt für dein Konto auf diesem Gerät und wird beim Abmelden deaktiviert. ActiviTee erhält keine biometrischen Daten.",
    enabled: "Auf diesem Gerät aktiviert", disabled: "Deaktiviert", enable: "{method} aktivieren", disable: "Deaktivieren", checking: "Wird überprüft…",
    unavailable: "Richte Face ID oder Touch ID in den Geräteeinstellungen ein oder erlaube den Zugriff und versuche es erneut.",
    error: "Diese Einstellung konnte nicht geändert werden. Versuche es erneut.", cancelled: "Überprüfung abgebrochen. Deine Einstellung bleibt erhalten.",
  },
  it: {
    title: "Sblocco dell’app", description: "Usa {method} all’apertura dell’app e quando torni dall’esecuzione in background. In alternativa puoi usare il codice del dispositivo.",
    privacy: "Questa opzione riguarda il tuo account su questo dispositivo e si disattiva alla disconnessione. ActiviTee non riceve dati biometrici.",
    enabled: "Attivato su questo dispositivo", disabled: "Disattivato", enable: "Attiva {method}", disable: "Disattiva", checking: "Verifica…",
    unavailable: "Configura o autorizza Face ID o Touch ID nelle impostazioni del dispositivo, poi riprova.",
    error: "Impossibile modificare questa opzione. Riprova.", cancelled: "Verifica annullata. La tua impostazione è stata conservata.",
  },
};
