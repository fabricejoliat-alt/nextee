"use client";

import { useId, useRef, useState } from "react";
import { Mail, Send } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { marketplaceContactEmail } from "@/lib/marketplaceContact";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { organizationFetch } from "@/lib/organizationFetch";
import styles from "@/app/player/marketplace/Marketplace.module.css";

export default function MarketplaceContactForm({ itemId, title, recipient }: { itemId: string; title: string; recipient: string | null }) {
  const { locale } = useI18n();
  const id = useId();
  const sending = useRef(false), requestId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const text = (fr: string, en: string, de: string, it: string) => pickLocaleText(locale, fr, en, de, it);
  if (!marketplaceContactEmail(recipient)) return null;

  async function toggle() {
    if (open) { setOpen(false); return; }
    setSubject(value => value || text(`À propos de votre annonce « ${title} »`, `About your listing “${title}”`, `Zu Ihrer Anzeige „${title}“`, `A proposito del suo annuncio « ${title} »`).slice(0, 160));
    setMessage(value => value || text(`Bonjour,\n\nJe suis intéressé(e) par votre annonce « ${title} ». Est-elle toujours disponible ?\n\nMerci !`, `Hello,\n\nI am interested in your listing “${title}”. Is it still available?\n\nThank you!`, `Guten Tag,\n\nich interessiere mich für Ihre Anzeige „${title}“. Ist der Artikel noch verfügbar?\n\nVielen Dank!`, `Buongiorno,\n\nSono interessato/a al suo annuncio « ${title} ». È ancora disponibile?\n\nGrazie!`));
    setOpen(true);
    try {
      const { data } = await supabase.auth.getSession();
      setEmail(value => value || marketplaceContactEmail(data.session?.user.email));
    } catch { /* Keep the editable reply address empty when the session cannot be read. */ }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true; requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const context = await resolveEffectivePlayerContext();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("unauthorized");
      const response = await organizationFetch(`/api/player/marketplace/${encodeURIComponent(itemId)}/contact`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId.current, reply_email: email, subject, message, child_id: context.role === "parent" ? context.effectiveUserId : null }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error ?? "send_failed"));
      setSent(true);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "send_failed";
      const errors: Record<string, string> = {
        unauthorized: text("Ta session a expiré. Reconnecte-toi.", "Your session has expired. Sign in again.", "Deine Sitzung ist abgelaufen. Melde dich erneut an.", "La sessione è scaduta. Accedi di nuovo."),
        no_email: text("Aucune adresse e-mail de contact n’est disponible pour cette annonce.", "No contact email is available for this listing.", "Für diese Anzeige ist keine Kontakt-E-Mail verfügbar.", "Nessuna e-mail di contatto disponibile per questo annuncio."),
        rate_limited: text("Trop de messages envoyés. Réessaie dans quelques minutes.", "Too many messages. Try again in a few minutes.", "Zu viele Nachrichten. Versuche es in einigen Minuten erneut.", "Troppi messaggi. Riprova tra qualche minuto."),
        invalid_message: text("Vérifie ton adresse e-mail, l’objet et le message.", "Check your email address, subject and message.", "Prüfe E-Mail-Adresse, Betreff und Nachricht.", "Controlla indirizzo e-mail, oggetto e messaggio."),
        content_not_allowed: text("Reformule le message sans contenu inapproprié, lien externe ou code HTML.", "Rephrase the message without inappropriate content, external links or HTML.", "Formuliere die Nachricht ohne unangemessene Inhalte, externe Links oder HTML neu.", "Riformula il messaggio senza contenuti inappropriati, link esterni o HTML."),
        inactive: text("Cette annonce n’est plus disponible.", "This listing is no longer available.", "Diese Anzeige ist nicht mehr verfügbar.", "Questo annuncio non è più disponibile."),
        unavailable: text("Le service d’envoi est temporairement indisponible.", "Email service is temporarily unavailable.", "Der E-Mail-Dienst ist vorübergehend nicht verfügbar.", "Il servizio e-mail non è temporaneamente disponibile."),
      };
      setError(errors[code] || text("Envoi non confirmé. Vérifie ta connexion avant de réessayer.", "Sending could not be confirmed. Check your connection before trying again.", "Der Versand konnte nicht bestätigt werden. Prüfe deine Verbindung.", "Invio non confermato. Controlla la connessione prima di riprovare."));
    } finally { sending.current = false; setBusy(false); }
  }

  return <div className={styles.contact}>
    <button className="btn btn-primary" type="button" onClick={() => void toggle()} aria-expanded={open} aria-controls={id} disabled={busy}>
      <Mail size={16} aria-hidden="true" />{text("Contacter", "Contact", "Kontaktieren", "Contatta")}
    </button>
    {open ? <div id={id} className={styles.contactPanel}>
      {sent ? <p role="status" className={styles.contactSuccess}>{text("Ton message a été envoyé. Retrouve tes échanges dans les messages du Marketplace.", "Your message has been sent. Find your exchanges in Marketplace messages.", "Deine Nachricht wurde gesendet. Du findest den Austausch in den Marketplace-Nachrichten.", "Il messaggio è stato inviato. Ritrova gli scambi nei messaggi del Marketplace.")}</p> : <form onSubmit={event => void send(event)} className={styles.contactForm}>
        <label>{text("Ton adresse e-mail de réponse", "Your reply email", "Deine Antwort-E-Mail-Adresse", "La tua e-mail per la risposta")}<input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); requestId.current = null; }} maxLength={254} required disabled={busy} /></label>
        <label>{text("Objet", "Subject", "Betreff", "Oggetto")}<input value={subject} onChange={event => { setSubject(event.target.value); requestId.current = null; }} minLength={3} maxLength={160} required disabled={busy} /></label>
        <label>{text("Message", "Message", "Nachricht", "Messaggio")}<textarea value={message} onChange={event => { setMessage(event.target.value); requestId.current = null; }} minLength={10} maxLength={4000} rows={7} required disabled={busy} /></label>
        {error ? <p role="alert" className={styles.contactError}>{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !marketplaceContactEmail(email) || subject.trim().length < 3 || message.trim().length < 10}><Send size={15} aria-hidden="true" />{busy ? text("Envoi en cours…", "Sending…", "Wird gesendet…", "Invio in corso…") : text("Envoyer", "Send", "Senden", "Invia")}</button>
      </form>}
    </div> : null}
  </div>;
}
