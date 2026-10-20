import type { AppLocale } from "@/lib/i18n/messages";
const labels = {
  received: ["Reçus", "Received", "Empfangen", "Ricevuti"],
  sent: ["Envoyés", "Sent", "Gesendet", "Inviati"],
  reply: ["Répondre", "Reply", "Antworten", "Rispondi"],
  response: ["Ta réponse", "Your reply", "Deine Antwort", "La tua risposta"],
  send: ["Envoyer la réponse", "Send reply", "Antwort senden", "Invia risposta"],
  sending: ["Envoi…", "Sending…", "Wird gesendet…", "Invio…"],
  cancel: ["Annuler", "Cancel", "Abbrechen", "Annulla"],
  delete: ["Supprimer", "Delete", "Löschen", "Elimina"],
  deleted: ["Message supprimé de ta boîte.", "Message removed from your inbox.", "Nachricht aus deinem Postfach entfernt.", "Messaggio eliminato dalla tua casella."],
  deleteHint: ["La copie de ton correspondant est conservée.", "Your correspondent keeps their copy.", "Die Kopie deines Gesprächspartners bleibt erhalten.", "Il destinatario conserva la propria copia."],
  undo: ["Annuler la suppression", "Undo deletion", "Löschen rückgängig machen", "Annulla eliminazione"],
  replied: ["Réponse envoyée dans le Marketplace.", "Reply sent in the Marketplace.", "Antwort im Marketplace gesendet.", "Risposta inviata nel Marketplace."],
  all: ["Voir tous les messages", "View all messages", "Alle Nachrichten anzeigen", "Vedi tutti i messaggi"],
  more: ["Charger la suite", "Load more", "Mehr laden", "Carica altri"],
  settings: ["Paramètres de notification", "Notification settings", "Benachrichtigungseinstellungen", "Impostazioni notifiche"],
  noSent: ["Aucun message envoyé pour ce compte.", "No messages sent from this account.", "Keine gesendeten Nachrichten für dieses Konto.", "Nessun messaggio inviato da questo account."],
  member: ["Membre", "Member", "Mitglied", "Membro"],
  to: ["À", "To", "An", "A"],
  listing: ["Voir l’annonce", "View listing", "Anzeige ansehen", "Vedi annuncio"],
  readOnly: ["Tu peux consulter les messages de cet enfant. La réponse et la suppression nécessitent le droit de modification.", "You can view this child’s messages. Replying and deleting require edit permission.", "Du kannst die Nachrichten dieses Kindes ansehen. Antworten und Löschen erfordern Bearbeitungsrechte.", "Puoi leggere i messaggi di questo figlio. Per rispondere o eliminare occorre il permesso di modifica."],
  reply_unavailable: ["La réponse n’est plus possible : un membre est bloqué, suspendu ou n’a plus accès au club.", "Reply unavailable: a member is blocked, suspended or no longer has club access.", "Antwort nicht möglich: Ein Mitglied ist gesperrt oder hat keinen Clubzugang mehr.", "Risposta non disponibile: un membro è bloccato, sospeso o non ha più accesso al club."],
  rate_limited: ["Trop de messages envoyés. Réessaie dans quelques minutes.", "Too many messages. Try again in a few minutes.", "Zu viele Nachrichten. Versuche es in einigen Minuten erneut.", "Troppi messaggi. Riprova tra qualche minuto."],
  content_not_allowed: ["Reformule le message sans contenu inapproprié, lien externe ou code HTML.", "Rephrase without inappropriate content, external links or HTML.", "Formuliere die Nachricht ohne unangemessene Inhalte, externe Links oder HTML neu.", "Riformula senza contenuti inappropriati, link esterni o HTML."],
  invalid_message: ["Saisis un message de 1 à 4 000 caractères.", "Enter a message of 1 to 4,000 characters.", "Gib eine Nachricht mit 1 bis 4.000 Zeichen ein.", "Inserisci un messaggio da 1 a 4.000 caratteri."],
  unauthorized: ["Ta session a expiré. Reconnecte-toi.", "Your session expired. Sign in again.", "Deine Sitzung ist abgelaufen. Melde dich erneut an.", "La sessione è scaduta. Accedi di nuovo."],
  forbidden: ["Tu n’as plus accès à ce message ou à sa modification.", "You no longer have access to this message or permission to edit it.", "Du hast keinen Zugriff oder keine Bearbeitungsrechte mehr.", "Non hai più accesso al messaggio o il permesso di modificarlo."],
  unavailable: ["Action non confirmée. Réessaie dans quelques instants.", "Action not confirmed. Try again shortly.", "Aktion nicht bestätigt. Versuche es gleich erneut.", "Azione non confermata. Riprova tra poco."],
} as const;
export function marketplaceMessageText(locale: AppLocale, key: keyof typeof labels) {
  return labels[key][locale === "fr" ? 0 : locale === "en" ? 1 : locale === "de" ? 2 : 3];
}
export function marketplaceMessageError(locale: AppLocale, code: string) {
  return marketplaceMessageText(locale, Object.hasOwn(labels, code) ? code as keyof typeof labels : "unavailable");
}
