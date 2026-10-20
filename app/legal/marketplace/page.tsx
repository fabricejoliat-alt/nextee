import Link from "next/link";
import { publicContactEmail } from "@/lib/server/publicContact";
import styles from "../LegalPublic.module.css";

export const dynamic = "force-dynamic";
const content = {
  fr: ["Règles de la Marketplace", "La Marketplace permet de vendre ou donner du matériel de golf entre membres des clubs. Les paiements et la remise du matériel s’organisent entre les personnes concernées.",
    "Publiez uniquement des annonces honnêtes et des photos que vous avez le droit d’utiliser. Les contenus violents, sexuels, discriminatoires, les menaces, le harcèlement, les arnaques, les contrefaçons et les articles illégaux sont interdits. Ne publiez pas de données ou d’images d’autres personnes sans leur accord.",
    "Les annonces et leurs photos sont vérifiées par le Manager du club ou l’Admin ActiviTee avant publication. Toute modification nécessite une nouvelle validation. Un contenu peut être refusé ou retiré et l’accès à la Marketplace peut être suspendu en cas d’abus.",
    "Sur chaque annonce, « Signaler l’annonce » permet de demander un examen. « Bloquer ce vendeur » masque ses annonces et bloque les contacts via la Marketplace dans les deux sens. Les blocages se gèrent dans « Membres bloqués ». Un parent peut agir pour l’enfant sélectionné.",
    "Contactez ActiviTee pour toute question ou tout comportement préoccupant. Les signalements sont examinés par l’équipe de modération. Le blocage dans l’application ne peut pas empêcher un contact extérieur utilisant des coordonnées déjà reçues.",
    "Si vous êtes mineur, organisez l’échange et le paiement avec votre parent ou représentant légal."],
  en: ["Marketplace rules", "The Marketplace lets club members sell or give away golf equipment. Payment and handover are arranged directly between the people involved.",
    "Only post honest listings and photos you have permission to use. Violence, sexual content, discrimination, threats, harassment, scams, counterfeit goods and illegal items are prohibited. Do not publish other people's data or images without permission.",
    "Listings and photos are reviewed by the club Manager or ActiviTee Admin before publication. Changes require a new review. Content may be declined or removed and Marketplace access may be suspended for abuse.",
    "Use “Report listing” to request a review. “Block this seller” hides their listings and blocks Marketplace contact in both directions. Manage blocks in “Blocked members”. Parents can act for the selected child.",
    "Contact ActiviTee with questions or concerns. Reports are reviewed by the moderation team. In-app blocking cannot prevent contact outside the app using details already received.",
    "If you are a minor, arrange the exchange and payment with your parent or legal guardian."],
  de: ["Marktplatzregeln", "Clubmitglieder können Golfausrüstung verkaufen oder verschenken. Zahlung und Übergabe vereinbaren die beteiligten Personen direkt.",
    "Veröffentlichen Sie nur wahrheitsgemässe Anzeigen und Fotos, die Sie verwenden dürfen. Gewalt, sexuelle Inhalte, Diskriminierung, Drohungen, Belästigung, Betrug, Fälschungen und illegale Artikel sind verboten. Veröffentlichen Sie keine Daten oder Bilder anderer ohne deren Zustimmung.",
    "Anzeigen und Fotos werden vor Veröffentlichung vom Club-Manager oder ActiviTee-Admin geprüft. Änderungen erfordern eine erneute Prüfung. Inhalte können abgelehnt oder entfernt und der Marktplatzzugang bei Missbrauch gesperrt werden.",
    "Mit „Anzeige melden“ beantragen Sie eine Prüfung. „Verkäufer blockieren“ blendet dessen Anzeigen aus und sperrt Marktplatzkontakte in beide Richtungen. Verwalten Sie Sperren unter „Blockierte Mitglieder“. Eltern können für das ausgewählte Kind handeln.",
    "Kontaktieren Sie ActiviTee bei Fragen oder bedenklichem Verhalten. Das Moderationsteam prüft Meldungen. Die Sperre verhindert keine Kontakte ausserhalb der App über bereits erhaltene Kontaktdaten.",
    "Minderjährige organisieren Austausch und Zahlung mit einem Elternteil oder gesetzlichen Vertreter."],
  it: ["Regole del Marketplace", "I membri dei club possono vendere o regalare attrezzatura da golf. Pagamento e consegna sono concordati direttamente tra le persone coinvolte.",
    "Pubblicate solo annunci veritieri e foto che avete il diritto di utilizzare. Sono vietati violenza, contenuti sessuali, discriminazione, minacce, molestie, truffe, contraffazioni e articoli illegali. Non pubblicate dati o immagini altrui senza consenso.",
    "Annunci e foto vengono verificati dal Manager del club o dall’Admin ActiviTee prima della pubblicazione. Le modifiche richiedono una nuova verifica. I contenuti possono essere rifiutati o rimossi e l’accesso al Marketplace sospeso in caso di abuso.",
    "Usate « Segnala annuncio » per richiedere una verifica. « Blocca venditore » nasconde i suoi annunci e blocca i contatti nel Marketplace in entrambe le direzioni. Gestite i blocchi in « Membri bloccati ». I genitori possono agire per il figlio selezionato.",
    "Contattate ActiviTee per domande o comportamenti preoccupanti. Il team di moderazione esamina le segnalazioni. Il blocco nell’app non impedisce contatti esterni tramite recapiti già ricevuti.",
    "Se siete minorenni, organizzate scambio e pagamento con un genitore o rappresentante legale."],
};
export default async function MarketplaceRules({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const locale = lang === "en" || lang === "de" || lang === "it" ? lang : "fr";
  const [title, ...paragraphs] = content[locale];
  const email = await publicContactEmail();
  return <main className={styles.page}>
    <nav className={styles.breadcrumb}><Link href="/player/marketplace">Marketplace</Link>
      {(["fr", "en", "de", "it"] as const).map(value => <Link key={value} href={`/legal/marketplace?lang=${value}`} lang={value} aria-current={locale === value ? "page" : undefined}>{value.toUpperCase()}</Link>)}</nav>
    <h1 className={styles.heading}>{title}</h1>
    <article className={styles.card}>{paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <a href={`mailto:${email}`}>{email}</a><Link href="/contact">Contact ActiviTee</Link>
    </article>
  </main>;
}
