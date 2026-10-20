"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { accountDeletionMessages } from "@/lib/i18n/accountDeletionMessages";

export default function DeleteAccountLink() {
  const { locale } = useI18n();
  return <Link href="/legal/delete-account" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "8px 12px",
    border: "1px solid #dfb9b1", borderRadius: 9, background: "#fff6f4", color: "#8e2d2d", fontWeight: 650 }}>{accountDeletionMessages[locale].title}</Link>;
}
