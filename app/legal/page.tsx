import Link from "next/link";
import { legalDb } from "@/lib/server/legalAccess";
export const dynamic = "force-dynamic";
export default async function LegalLanding() {
  let documents: Array<{ document_key: string; kind: string }> = [];
  try { const result = await legalDb().from("legal_documents").select("document_key,kind").eq("active", true)
    .in("kind", ["terms","privacy"]).eq("scope", "platform"); documents = result.data ?? []; } catch { /* Migration pending. */ }
  return <main style={{ maxWidth: 760, margin: "auto", padding: "32px 20px 100px" }}><h1>Documents juridiques</h1>
    {documents.length ? documents.map((d) => <p key={d.document_key}><Link href={`/legal/${d.document_key}`}>{d.kind === "terms" ? "Conditions d’utilisation" : "Confidentialité"}</Link></p>)
      : <p>Les documents publics seront disponibles après validation et activation. Pour toute question, contactez l’assistance.</p>}
    <p><Link href="/legal/request">Demander l’accès, la rectification ou la suppression de mes données</Link></p>
    <p><Link href="/login">Connexion</Link></p></main>;
}
