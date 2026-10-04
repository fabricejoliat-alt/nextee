import Link from "next/link";
import { notFound } from "next/navigation";
import { legalDb } from "@/lib/server/legalAccess";
export const dynamic = "force-dynamic";
export default async function LegalText({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { kind } = await params; const { lang } = await searchParams;
  const locale = ["fr","en","de","it"].includes(lang ?? "") ? lang! : "fr";
  const db = legalDb(); const doc = await db.from("legal_documents").select("id,kind").eq("document_key", kind)
    .eq("scope", "platform").eq("active", true).in("kind", ["terms","privacy"]).maybeSingle();
  if (!doc.data) notFound();
  const version = await db.from("legal_versions").select("version_number,published_at,snapshot")
    .eq("document_id", doc.data.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const translations = version.data?.snapshot?.translations as Record<string, { title: string; body: string }> | undefined;
  const translation = translations?.[locale]; if (!translation) notFound();
  return <main style={{ maxWidth: 760, margin: "auto", padding: "32px 20px 100px" }}>
    <nav aria-label="Langue">{["fr","en","de","it"].filter((l) => translations?.[l]).map((l) => <Link key={l} href={`/legal/${kind}?lang=${l}`} style={{ marginRight: 16 }}>{l.toUpperCase()}</Link>)}</nav>
    <h1>{translation.title}</h1><p>Version {version.data?.version_number} · {version.data?.published_at?.slice(0, 10)}</p>
    <article style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{translation.body}</article>
    <p><Link href="/legal">Tous les documents</Link></p></main>;
}
