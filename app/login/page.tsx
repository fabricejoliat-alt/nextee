import { redirect } from "next/navigation";

type LoginAliasProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginAliasPage({ searchParams }: LoginAliasProps) {
  const params = (await searchParams) ?? {};
  const next = params.next;
  const nextValue = Array.isArray(next) ? next[0] : next;

  if (nextValue) {
    redirect(`/?next=${encodeURIComponent(nextValue)}`);
  }

  redirect("/");
}

